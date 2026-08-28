/**
 * Narrow, server-side validation for the optional high-gas Gnosis proposal
 * path. This is deliberately not a general JSON-RPC gateway.
 *
 * The browser may use this only after dashboard-session authentication. Every
 * submitted UserOperation remains self-paying and requires the caller-held
 * smart-account signature; the Governor remains the final attester/proposal
 * authorization check. No server key can sign, sponsor, or select a chain.
 */

const PIMLICO_ORIGIN = "https://api.pimlico.io";
const PIMLICO_PATH = "/v2/100/rpc";
const GNOSIS_CHAIN_ID = "0x64";
const REVIEWED_GOVERNOR_ADDRESS = "0x5f5e499dc1872c2ce19a4b50cd10f680e78e3ba3";
const SMART_ACCOUNT_EXECUTE_SELECTOR = "0xb61d27f6";
// `cast sig 'proposeWithPeriod(address[],uint256[],bytes[],string,uint32)'`
// against the reviewed local MaciAttesterGovernor source yields this selector.
const GOVERNOR_PROPOSE_WITH_PERIOD_SELECTOR = "0x88c534e8";
const MIN_VOTING_PERIOD_SECONDS = 3_600n;
const MAX_VOTING_PERIOD_SECONDS = 2_592_000n;
const ENTRY_POINTS = new Set([
  // ERC-4337 v0.6 and v0.7 respectively. Both are fixed public contracts.
  "0x5ff137d4b0fdcd49dca30c7cf57e578a026d2789",
  "0x0000000071727de22e5e9d8baf0edac6f37da032",
]);

export const MAX_BUNDLER_BODY_BYTES = 64 * 1024;
export const BUNDLER_REQUEST_TIMEOUT_MS = 5_000;
export const BUNDLER_UPSTREAM_TIMEOUT_MS = 8_000;
export const BUNDLER_REQUESTS_PER_MINUTE = 24;
export const BUNDLER_MAX_ACTIVE_REQUESTS = 8;

const MAX_USER_OPERATION_CALLDATA_BYTES = 64 * 1024;
const MAX_USER_OPERATION_SIGNATURE_BYTES = 16 * 1024;
const MAX_CALL_GAS = 20_000_000n;
const MAX_VERIFICATION_GAS = 3_000_000n;
const MAX_PRE_VERIFICATION_GAS = 1_000_000n;
const MAX_FEE_PER_GAS = 10_000_000_000n;
const ADDRESS = /^0x[0-9a-fA-F]{40}$/u;
const DATA = /^0x(?:[0-9a-fA-F]{2})*$/u;
const QUANTITY = /^0x(?:0|[1-9a-fA-F][0-9a-fA-F]*)$/u;

type JsonObject = Record<string, unknown>;
type BundlerMethod =
  | "eth_chainId"
  | "eth_supportedEntryPoints"
  | "pimlico_getUserOperationGasPrice"
  | "eth_estimateUserOperationGas"
  | "eth_sendUserOperation"
  | "eth_getUserOperationReceipt"
  | "eth_getUserOperationByHash";

export type ProposalBundlerRequest = Readonly<{
  id: string | number | null;
  jsonrpc: "2.0";
  method: BundlerMethod;
  params: unknown[];
}>;

export type GnosisBundlerConfig = Readonly<{
  governorAddress: typeof REVIEWED_GOVERNOR_ADDRESS;
  url: string;
}>;

function object(value: unknown): value is JsonObject {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function exactKeys(
  value: unknown,
  names: readonly string[]
): value is JsonObject {
  if (!object(value)) return false;
  const keys = Object.keys(value);
  return (
    keys.length === names.length && keys.every((key) => names.includes(key))
  );
}

function validId(value: unknown): value is string | number | null {
  return (
    value === null ||
    (typeof value === "string" && value.length <= 128) ||
    (typeof value === "number" && Number.isSafeInteger(value))
  );
}

function data(value: unknown, maximumBytes: number): value is string {
  return (
    typeof value === "string" &&
    value.length <= maximumBytes * 2 + 2 &&
    DATA.test(value)
  );
}

function quantity(value: unknown, maximum: bigint): value is string {
  if (typeof value !== "string" || !QUANTITY.test(value)) return false;
  try {
    return BigInt(value) <= maximum;
  } catch {
    return false;
  }
}

function address(value: unknown): value is string {
  return typeof value === "string" && ADDRESS.test(value);
}

function entryPoint(value: unknown): value is string {
  return typeof value === "string" && ENTRY_POINTS.has(value.toLowerCase());
}

function abiWord(value: string, offset: number): string {
  return value.slice(offset, offset + 64);
}

/**
 * Decodes only the canonical ABI form of SimpleAccount.execute(address,uint256,bytes).
 * It binds the request to one reviewed Governor and its caller-selected-period
 * proposal entrypoint; arbitrary smart-account calls cannot reach the provider.
 */
function validGovernorProposalCallData(
  value: unknown,
  governorAddress: string
): boolean {
  if (!data(value, MAX_USER_OPERATION_CALLDATA_BYTES)) return false;
  const normalized = value.toLowerCase();
  if (!normalized.startsWith(SMART_ACCOUNT_EXECUTE_SELECTOR)) return false;
  const encoded = normalized.slice(SMART_ACCOUNT_EXECUTE_SELECTOR.length);
  const headLength = 3 * 64;
  if (encoded.length < headLength + 64) return false;
  const targetWord = abiWord(encoded, 0);
  const valueWord = abiWord(encoded, 64);
  const offsetWord = abiWord(encoded, 128);
  if (
    !targetWord.startsWith("0".repeat(24)) ||
    targetWord.slice(24) !== governorAddress.slice(2) ||
    valueWord !== "0".repeat(64) ||
    offsetWord !== `${"0".repeat(62)}60`
  ) {
    return false;
  }
  let innerLength: bigint;
  try {
    innerLength = BigInt(`0x${abiWord(encoded, headLength)}`);
  } catch {
    return false;
  }
  if (
    innerLength < 4n ||
    innerLength > BigInt(MAX_USER_OPERATION_CALLDATA_BYTES)
  ) {
    return false;
  }
  const paddedLength = Number((innerLength + 31n) / 32n) * 64;
  if (encoded.length !== headLength + 64 + paddedLength) return false;
  const inner = encoded.slice(
    headLength + 64,
    headLength + 64 + Number(innerLength) * 2
  );
  const padding = encoded.slice(headLength + 64 + Number(innerLength) * 2);
  if (
    !inner.startsWith(GOVERNOR_PROPOSE_WITH_PERIOD_SELECTOR.slice(2)) ||
    !/^0*$/u.test(padding)
  ) {
    return false;
  }
  // ABI head for (address[],uint256[],bytes[],string,uint32): the final word
  // is static. Require canonical uint32 zero-extension and the exact contract
  // bounds before the Governor decodes the remaining proposal arguments.
  const proposalHeadLength = 5 * 64;
  if (inner.length < 8 + proposalHeadLength) return false;
  const periodWord = inner.slice(8 + 4 * 64, 8 + proposalHeadLength);
  if (!/^0{56}[0-9a-f]{8}$/u.test(periodWord)) return false;
  const period = BigInt(`0x${periodWord}`);
  return (
    period >= MIN_VOTING_PERIOD_SECONDS && period <= MAX_VOTING_PERIOD_SECONDS
  );
}

function validV06UserOperation(
  value: unknown,
  governorAddress: string
): boolean {
  if (
    !exactKeys(value, [
      "sender",
      "nonce",
      "initCode",
      "callData",
      "callGasLimit",
      "verificationGasLimit",
      "preVerificationGas",
      "maxFeePerGas",
      "maxPriorityFeePerGas",
      "paymasterAndData",
      "signature",
    ])
  ) {
    return false;
  }
  return (
    address(value.sender) &&
    quantity(value.nonce, (1n << 256n) - 1n) &&
    value.initCode === "0x" &&
    validGovernorProposalCallData(value.callData, governorAddress) &&
    quantity(value.callGasLimit, MAX_CALL_GAS) &&
    quantity(value.verificationGasLimit, MAX_VERIFICATION_GAS) &&
    quantity(value.preVerificationGas, MAX_PRE_VERIFICATION_GAS) &&
    quantity(value.maxFeePerGas, MAX_FEE_PER_GAS) &&
    quantity(value.maxPriorityFeePerGas, MAX_FEE_PER_GAS) &&
    value.paymasterAndData === "0x" &&
    data(value.signature, MAX_USER_OPERATION_SIGNATURE_BYTES)
  );
}

function validV07UserOperation(
  value: unknown,
  governorAddress: string
): boolean {
  if (
    !exactKeys(value, [
      "sender",
      "nonce",
      "callData",
      "callGasLimit",
      "verificationGasLimit",
      "preVerificationGas",
      "maxFeePerGas",
      "maxPriorityFeePerGas",
      "signature",
    ])
  ) {
    return false;
  }
  return (
    address(value.sender) &&
    quantity(value.nonce, (1n << 256n) - 1n) &&
    validGovernorProposalCallData(value.callData, governorAddress) &&
    quantity(value.callGasLimit, MAX_CALL_GAS) &&
    quantity(value.verificationGasLimit, MAX_VERIFICATION_GAS) &&
    quantity(value.preVerificationGas, MAX_PRE_VERIFICATION_GAS) &&
    quantity(value.maxFeePerGas, MAX_FEE_PER_GAS) &&
    quantity(value.maxPriorityFeePerGas, MAX_FEE_PER_GAS) &&
    data(value.signature, MAX_USER_OPERATION_SIGNATURE_BYTES)
  );
}

function validUserOperation(value: unknown, governorAddress: string): boolean {
  return (
    validV06UserOperation(value, governorAddress) ||
    validV07UserOperation(value, governorAddress)
  );
}

function validHash(value: unknown): value is string {
  return typeof value === "string" && /^0x[0-9a-fA-F]{64}$/u.test(value);
}

function validParams(
  method: BundlerMethod,
  params: unknown[],
  governorAddress: string
): boolean {
  switch (method) {
    case "eth_chainId":
    case "eth_supportedEntryPoints":
    case "pimlico_getUserOperationGasPrice":
      return params.length === 0;
    case "eth_getUserOperationReceipt":
    case "eth_getUserOperationByHash":
      return params.length === 1 && validHash(params[0]);
    case "eth_estimateUserOperationGas":
    case "eth_sendUserOperation":
      return (
        params.length === 2 &&
        validUserOperation(params[0], governorAddress) &&
        entryPoint(params[1])
      );
    default:
      return false;
  }
}

/** Parse exactly one bounded proposal/account-abstraction JSON-RPC request. */
export function parseProposalBundlerRequest(
  value: unknown,
  governorAddress = REVIEWED_GOVERNOR_ADDRESS
): ProposalBundlerRequest | null {
  if (!exactKeys(value, ["jsonrpc", "id", "method", "params"])) return null;
  if (
    value.jsonrpc !== "2.0" ||
    !validId(value.id) ||
    !Array.isArray(value.params)
  ) {
    return null;
  }
  const allowed: readonly BundlerMethod[] = [
    "eth_chainId",
    "eth_supportedEntryPoints",
    "pimlico_getUserOperationGasPrice",
    "eth_estimateUserOperationGas",
    "eth_sendUserOperation",
    "eth_getUserOperationReceipt",
    "eth_getUserOperationByHash",
  ];
  if (
    typeof value.method !== "string" ||
    !allowed.includes(value.method as BundlerMethod)
  ) {
    return null;
  }
  const method = value.method as BundlerMethod;
  if (!validParams(method, value.params, governorAddress)) return null;
  return { id: value.id, jsonrpc: "2.0", method, params: value.params };
}

/**
 * Configuration is deliberately a fixed Pimlico chain-100 URL with one
 * server-side API-key query parameter. The request cannot select any host,
 * provider, chain, or credentials.
 */
export function parseGnosisBundlerConfig(
  value: string | undefined,
  governorAddress: string | undefined
): GnosisBundlerConfig | null {
  if (!value || governorAddress?.toLowerCase() !== REVIEWED_GOVERNOR_ADDRESS)
    return null;
  try {
    const url = new URL(value);
    const key = url.searchParams.get("apikey");
    if (
      url.origin !== PIMLICO_ORIGIN ||
      url.pathname !== PIMLICO_PATH ||
      url.username !== "" ||
      url.password !== "" ||
      url.hash !== "" ||
      url.port !== "" ||
      key === null ||
      key.length < 16 ||
      key.length > 512 ||
      !/^[A-Za-z0-9._-]+$/u.test(key) ||
      [...url.searchParams.keys()].some((name) => name !== "apikey") ||
      [...url.searchParams].length !== 1
    ) {
      return null;
    }
    return { governorAddress: REVIEWED_GOVERNOR_ADDRESS, url: url.toString() };
  } catch {
    return null;
  }
}

export function isSameOrigin(
  requestUrl: string,
  origin: string | null
): boolean {
  if (!origin) return false;
  try {
    return new URL(requestUrl).origin === origin;
  } catch {
    return false;
  }
}

/** Reject deeply nested or oversized response values before reserializing them. */
export function hasBoundedJsonShape(
  value: unknown,
  maximumDepth = 12
): boolean {
  const work: Array<{ depth: number; value: unknown }> = [{ depth: 0, value }];
  let nodes = 0;
  while (work.length > 0) {
    const next = work.pop();
    if (!next) return false;
    nodes += 1;
    if (nodes > 4_000 || next.depth > maximumDepth) return false;
    if (
      next.value === null ||
      ["string", "number", "boolean"].includes(typeof next.value)
    ) {
      continue;
    }
    if (Array.isArray(next.value)) {
      if (next.value.length > 512) return false;
      for (const child of next.value)
        work.push({ depth: next.depth + 1, value: child });
      continue;
    }
    if (!object(next.value)) return false;
    const entries = Object.entries(next.value);
    if (entries.length > 512 || entries.some(([key]) => key.length > 256))
      return false;
    for (const [, child] of entries)
      work.push({ depth: next.depth + 1, value: child });
  }
  return true;
}

export function sanitizeBundlerResponse(
  value: unknown,
  id: ProposalBundlerRequest["id"]
): unknown | null {
  if (!exactKeys(value, ["jsonrpc", "id", "result"])) return null;
  if (
    value.jsonrpc !== "2.0" ||
    value.id !== id ||
    !hasBoundedJsonShape(value.result)
  ) {
    return null;
  }
  return { id, jsonrpc: "2.0", result: value.result };
}

export function rpcError(
  id: ProposalBundlerRequest["id"],
  code: number,
  message: string
) {
  return { error: { code, message }, id, jsonrpc: "2.0" } as const;
}

/** A process-local abuse budget; it complements ingress controls, never grants authority. */
export function createProposalBundlerBudget(now = () => Date.now()) {
  const entries = new Map<string, number[]>();
  return {
    consume(subject: string): boolean {
      const current = now();
      const after = current - 60_000;
      const retained = (entries.get(subject) ?? []).filter(
        (timestamp) => timestamp > after
      );
      if (retained.length >= BUNDLER_REQUESTS_PER_MINUTE) {
        entries.set(subject, retained);
        return false;
      }
      retained.push(current);
      entries.set(subject, retained);
      return true;
    },
  };
}

export {
  GNOSIS_CHAIN_ID,
  GOVERNOR_PROPOSE_WITH_PERIOD_SELECTOR,
  REVIEWED_GOVERNOR_ADDRESS,
  SMART_ACCOUNT_EXECUTE_SELECTOR,
};
