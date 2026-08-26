import assert from "node:assert/strict";
import { test } from "node:test";

import {
  openDurableJsonOperation,
  resumeDurableJsonOperation,
  type DurableOperationStorage,
} from "../src/lib/staging-participant/durable-operation.ts";

class MemoryStorage implements DurableOperationStorage {
  readonly values = new Map<string, string>();

  getItem(key: string) {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string) {
    this.values.set(key, value);
  }

  removeItem(key: string) {
    this.values.delete(key);
  }
}

type TestBody = Readonly<{
  schemaVersion: "test_operation_v1";
  requestId: string;
  signedEventId: string;
}>;

const validBody = (value: unknown): value is TestBody => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const body = value as Record<string, unknown>;
  return Object.keys(body).sort().join(",") ===
      "requestId,schemaVersion,signedEventId" &&
    body.schemaVersion === "test_operation_v1" &&
    typeof body.requestId === "string" &&
    typeof body.signedEventId === "string";
};

test("a reload replays the exact signed envelope until durable completion", () => {
  const storage = new MemoryStorage();
  const firstBody: TestBody = {
    schemaVersion: "test_operation_v1",
    requestId: "first-request",
    signedEventId: "first-signed-event",
  };
  const first = openDurableJsonOperation({
    storage,
    key: "promotion:source-1",
    candidate: firstBody,
    validate: validBody,
  });

  // Publication succeeded, but the durable receipt did not. The operation is
  // deliberately left pending and a simulated reload proposes a new envelope.
  const afterReload = openDurableJsonOperation({
    storage,
    key: "promotion:source-1",
    candidate: {
      schemaVersion: "test_operation_v1",
      requestId: "second-request",
      signedEventId: "second-signed-event",
    },
    validate: validBody,
  });

  assert.deepEqual(afterReload.body, firstBody);
  assert.equal(afterReload.serializedBody, first.serializedBody);
  assert.deepEqual(
    resumeDurableJsonOperation({
      storage,
      key: "promotion:source-1",
      validate: validBody,
    })?.body,
    firstBody,
  );

  afterReload.complete();
  assert.equal(
    resumeDurableJsonOperation({
      storage,
      key: "promotion:source-1",
      validate: validBody,
    }),
    null,
  );
});

test("completion is compare-and-delete and cannot erase a replacement", () => {
  const storage = new MemoryStorage();
  const operation = openDurableJsonOperation({
    storage,
    key: "suggestion:root-1",
    candidate: {
      schemaVersion: "test_operation_v1",
      requestId: "first-request",
      signedEventId: "first-signed-event",
    },
    validate: validBody,
  });
  storage.setItem(
    "stadtstack:staging-participant:durable-operation:v1:suggestion:root-1",
    JSON.stringify({
      schemaVersion: "stadtstack_staging_participant_durable_operation_v1",
      operationKey: "suggestion:root-1",
      serializedBody: JSON.stringify({
        schemaVersion: "test_operation_v1",
        requestId: "replacement-request",
        signedEventId: "replacement-signed-event",
      }),
    }),
  );

  assert.throws(
    () => operation.complete(),
    /staging_participant_durable_operation_changed/u,
  );
  assert.equal(storage.values.size, 1);
});

test("a corrupt pending operation fails closed instead of being overwritten", () => {
  const storage = new MemoryStorage();
  storage.setItem(
    "stadtstack:staging-participant:durable-operation:v1:promotion:source-1",
    "{not-json",
  );

  assert.throws(
    () =>
      openDurableJsonOperation({
        storage,
        key: "promotion:source-1",
        candidate: {
          schemaVersion: "test_operation_v1",
          requestId: "new-request",
          signedEventId: "new-signed-event",
        },
        validate: validBody,
      }),
    /staging_participant_durable_operation_invalid/u,
  );
  assert.equal(storage.getItem(
    "stadtstack:staging-participant:durable-operation:v1:promotion:source-1",
  ), "{not-json");
});

test("the exact route byte budget accepts its maximum and rejects one byte over before persistence", () => {
  const maximumBytes = 64 * 1024;
  const base: TestBody = {
    schemaVersion: "test_operation_v1",
    requestId: "request-at-byte-boundary",
    signedEventId: "",
  };
  const baseBytes = new TextEncoder().encode(JSON.stringify(base)).byteLength;
  const candidate: TestBody = {
    ...base,
    signedEventId: "x".repeat(maximumBytes - baseBytes),
  };
  assert.equal(
    new TextEncoder().encode(JSON.stringify(candidate)).byteLength,
    maximumBytes,
  );
  const acceptedStorage = new MemoryStorage();
  const accepted = openDurableJsonOperation({
    storage: acceptedStorage,
    key: "suggestion:maximum",
    candidate,
    validate: validBody,
    maxSerializedBodyBytes: maximumBytes,
  });
  assert.deepEqual(accepted.body, candidate);
  assert.equal(acceptedStorage.values.size, 1);

  const rejectedStorage = new MemoryStorage();
  assert.throws(
    () =>
      openDurableJsonOperation({
        storage: rejectedStorage,
        key: "suggestion:one-byte-over",
        candidate: { ...candidate, signedEventId: `${candidate.signedEventId}x` },
        validate: validBody,
        maxSerializedBodyBytes: maximumBytes,
      }),
    /staging_participant_topic_tracer_request_too_large/u,
  );
  assert.equal(rejectedStorage.values.size, 0);
});
