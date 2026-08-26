const STORAGE_PREFIX =
  "stadtstack:staging-participant:durable-operation:v1:";
const WRAPPER_SCHEMA =
  "stadtstack_staging_participant_durable_operation_v1";
const OPERATION_KEY = /^[a-z][a-z0-9-]{0,31}:[a-z0-9][a-z0-9:-]{0,191}$/u;
const DEFAULT_MAX_SERIALIZED_BODY_BYTES = 128 * 1024;

export type DurableOperationStorage = Pick<
  Storage,
  "getItem" | "setItem" | "removeItem"
>;

export type DurableJsonOperation<T> = Readonly<{
  body: T;
  serializedBody: string;
  complete(): void;
}>;

type DurableWrapper = Readonly<{
  schemaVersion: typeof WRAPPER_SCHEMA;
  operationKey: string;
  serializedBody: string;
}>;

function exactKeys(value: Record<string, unknown>, expected: readonly string[]) {
  const actual = Object.keys(value).sort();
  const sortedExpected = [...expected].sort();
  return actual.length === sortedExpected.length &&
    actual.every((key, index) => key === sortedExpected[index]);
}

function storageKey(operationKey: string) {
  if (!OPERATION_KEY.test(operationKey)) {
    throw new Error("staging_participant_durable_operation_key_invalid");
  }
  return `${STORAGE_PREFIX}${operationKey}`;
}

function maxBodyBytes(value: number | undefined) {
  const selected = value ?? DEFAULT_MAX_SERIALIZED_BODY_BYTES;
  if (!Number.isSafeInteger(selected) || selected < 1 || selected > 128 * 1024) {
    throw new Error("staging_participant_durable_operation_limit_invalid");
  }
  return selected;
}

function bodyBytes(value: string) {
  return new TextEncoder().encode(value).byteLength;
}

function defaultStorage(): DurableOperationStorage {
  try {
    if (!globalThis.localStorage) throw new Error("missing");
    return globalThis.localStorage;
  } catch {
    throw new Error("staging_participant_durable_operation_storage_unavailable");
  }
}

function decode<T>(
  raw: string,
  operationKey: string,
  validate: (value: unknown) => value is T,
  maxSerializedBodyBytes: number,
): { wrapper: DurableWrapper; body: T } {
  try {
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new Error("invalid");
    }
    const wrapper = value as Record<string, unknown>;
    if (
      !exactKeys(wrapper, ["schemaVersion", "operationKey", "serializedBody"]) ||
      wrapper.schemaVersion !== WRAPPER_SCHEMA ||
      wrapper.operationKey !== operationKey ||
      typeof wrapper.serializedBody !== "string" ||
      wrapper.serializedBody.length < 2
    ) {
      throw new Error("invalid");
    }
    if (bodyBytes(wrapper.serializedBody) > maxSerializedBodyBytes) {
      throw new Error("staging_participant_topic_tracer_request_too_large");
    }
    const body: unknown = JSON.parse(wrapper.serializedBody);
    if (!validate(body)) throw new Error("invalid");
    return {
      wrapper: wrapper as DurableWrapper,
      body,
    };
  } catch (cause) {
    if (
      cause instanceof Error &&
      cause.message === "staging_participant_topic_tracer_request_too_large"
    ) {
      throw cause;
    }
    throw new Error("staging_participant_durable_operation_invalid");
  }
}

function operation<T>(input: Readonly<{
  storage: DurableOperationStorage;
  key: string;
  raw: string;
  validate: (value: unknown) => value is T;
  maxSerializedBodyBytes: number;
}>): DurableJsonOperation<T> {
  const decoded = decode(
    input.raw,
    input.key,
    input.validate,
    input.maxSerializedBodyBytes,
  );
  return Object.freeze({
    body: decoded.body,
    serializedBody: decoded.wrapper.serializedBody,
    complete() {
      let current: string | null;
      try {
        current = input.storage.getItem(storageKey(input.key));
      } catch {
        throw new Error(
          "staging_participant_durable_operation_storage_unavailable",
        );
      }
      if (current !== input.raw) {
        throw new Error("staging_participant_durable_operation_changed");
      }
      try {
        input.storage.removeItem(storageKey(input.key));
      } catch {
        throw new Error(
          "staging_participant_durable_operation_storage_unavailable",
        );
      }
    },
  });
}

/**
 * Open a durable public-signed operation. If a previous browser attempt
 * reached publication but not its database receipt, its byte-identical body
 * wins over the new candidate until the caller verifies and completes the
 * durable receipt.
 */
export function openDurableJsonOperation<T>(input: Readonly<{
  key: string;
  candidate: T;
  validate: (value: unknown) => value is T;
  storage?: DurableOperationStorage;
  maxSerializedBodyBytes?: number;
}>): DurableJsonOperation<T> {
  const selectedStorage = input.storage ?? defaultStorage();
  const key = storageKey(input.key);
  const selectedMaxBodyBytes = maxBodyBytes(input.maxSerializedBodyBytes);
  let raw: string | null;
  try {
    raw = selectedStorage.getItem(key);
  } catch {
    throw new Error("staging_participant_durable_operation_storage_unavailable");
  }
  if (raw === null) {
    if (!input.validate(input.candidate)) {
      throw new Error("staging_participant_durable_operation_invalid");
    }
    const serializedBody = JSON.stringify(input.candidate);
    if (bodyBytes(serializedBody) > selectedMaxBodyBytes) {
      throw new Error("staging_participant_topic_tracer_request_too_large");
    }
    raw = JSON.stringify({
      schemaVersion: WRAPPER_SCHEMA,
      operationKey: input.key,
      serializedBody,
    } satisfies DurableWrapper);
    try {
      selectedStorage.setItem(key, raw);
    } catch {
      throw new Error(
        "staging_participant_durable_operation_storage_unavailable",
      );
    }
  }
  return operation({
    storage: selectedStorage,
    key: input.key,
    raw,
    validate: input.validate,
    maxSerializedBodyBytes: selectedMaxBodyBytes,
  });
}

export function resumeDurableJsonOperation<T>(input: Readonly<{
  key: string;
  validate: (value: unknown) => value is T;
  storage?: DurableOperationStorage;
  maxSerializedBodyBytes?: number;
}>): DurableJsonOperation<T> | null {
  const selectedStorage = input.storage ?? defaultStorage();
  const key = storageKey(input.key);
  const selectedMaxBodyBytes = maxBodyBytes(input.maxSerializedBodyBytes);
  let raw: string | null;
  try {
    raw = selectedStorage.getItem(key);
  } catch {
    throw new Error("staging_participant_durable_operation_storage_unavailable");
  }
  return raw === null
    ? null
    : operation({
        storage: selectedStorage,
        key: input.key,
        raw,
        validate: input.validate,
        maxSerializedBodyBytes: selectedMaxBodyBytes,
      });
}
