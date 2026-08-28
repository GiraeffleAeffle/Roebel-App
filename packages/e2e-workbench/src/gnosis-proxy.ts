import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from "node:http";
import type { Socket } from "node:net";

const UPSTREAM_URL = "https://rpc.gnosischain.com";
const EXPECTED_CHAIN_ID = "0x64";
const ALLOWED_METHODS = [
  "eth_blockNumber",
  "eth_call",
  "eth_chainId",
  "eth_getCode",
] as const;
const ALLOWED_METHODS_VALUE = ALLOWED_METHODS.join(",");
const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const HEX_DATA = /^0x(?:[0-9a-fA-F]{2})*$/;
const BLOCK_TAG = /^(?:latest|safe|finalized|pending|earliest|0x[0-9a-fA-F]+)$/;
const MAX_UPSTREAM_RESPONSE_BYTES = 256 * 1024;
const MAX_DEPLOYLESS_SIGNATURE_BYTES = 8 * 1024;
const ABI_WORD_HEX_LENGTH = 64;
const DEPLOYLESS_ARGUMENT_HEAD_HEX_LENGTH = 3 * ABI_WORD_HEX_LENGTH;
const DEPLOYLESS_SIGNATURE_LENGTH_HEX_LENGTH = ABI_WORD_HEX_LENGTH;
const DEPLOYLESS_SIGNATURE_OFFSET_WORD = `${"0".repeat(62)}60`;

// viem@2.53.1's immutable erc6492SignatureValidatorByteCode. relay-sync's
// lockfile pins the package integrity recorded in pnpm-lock.yaml.
// Bytecode: 1,684 bytes, sha256
// d46b6085a6558eb925573e4e395ccbc669a1db1b7aa49196cbb1a7540db6a470.
export const VIEM_2_53_1_ERC6492_VALIDATOR_BYTECODE =
  "0x608060405234801561001057600080fd5b5060405161069438038061069483398101604081905261002f9161051e565b60" +
  "0061003c848484610048565b9050806000526001601ff35b60007f6492649264926492649264926492649264926492649264" +
  "9264926492649264926100748361040c565b036101e7576000606080848060200190518101906100929190610577565b6040" +
  "5192955090935091506000906001600160a01b038516906100b69085906105dd565b6000604051808303816000865af19150" +
  "503d80600081146100f3576040519150601f19603f3d011682016040523d82523d6000602084013e6100f8565b606091505b" +
  "50509050876001600160a01b03163b60000361016057806101605760405162461bcd60e51b815260206004820152601e6024" +
  "8201527f5369676e617475726556616c696461746f723a206465706c6f796d656e74000060448201526064015b6040518091" +
  "0390fd5b604051630b135d3f60e11b808252906001600160a01b038a1690631626ba7e90610190908b9087906004016105f9" +
  "565b602060405180830381865afa1580156101ad573d6000803e3d6000fd5b505050506040513d601f19601f820116820180" +
  "604052508101906101d19190610633565b6001600160e01b03191614945050505050610405565b6001600160a01b0384163b" +
  "1561027a57604051630b135d3f60e11b808252906001600160a01b03861690631626ba7e9061022790879087906004016105" +
  "f9565b602060405180830381865afa158015610244573d6000803e3d6000fd5b505050506040513d601f19601f8201168201" +
  "80604052508101906102689190610633565b6001600160e01b031916149050610405565b81516041146102df576040516246" +
  "1bcd60e51b815260206004820152603a602482015260008051602061067483398151915260448201527f3a20696e76616c69" +
  "64207369676e6174757265206c656e6774680000000000006064820152608401610157565b6102e7610425565b5060208201" +
  "516040808401518451859392600091859190811061030c5761030c61065d565b016020015160f81c9050601b811480159061" +
  "032b57508060ff16601c14155b1561038c5760405162461bcd60e51b815260206004820152603b6024820152600080516020" +
  "61067483398151915260448201527f3a20696e76616c6964207369676e617475726520762076616c75650000000000606482" +
  "0152608401610157565b60408051600081526020810180835289905260ff8316918101919091526060810184905260808101" +
  "8390526001600160a01b0389169060019060a0016020604051602081039080840390855afa1580156103ea573d6000803e3d" +
  "6000fd5b505050602060405103516001600160a01b0316149450505050505b9392505050565b600060208251101561041d57" +
  "600080fd5b508051015190565b60405180606001604052806003906020820280368337509192915050565b6001600160a01b" +
  "038116811461045857600080fd5b50565b634e487b7160e01b600052604160045260246000fd5b60005b8381101561048c57" +
  "8181015183820152602001610474565b50506000910152565b600082601f8301126104a657600080fd5b8151600160016040" +
  "1b038111156104bf576104bf61045b565b604051601f8201601f19908116603f011681016001600160401b03811182821017" +
  "156104ed576104ed61045b565b60405281815283820160200185101561050557600080fd5b61051682602083016020870161" +
  "0471565b949350505050565b60008060006060848603121561053357600080fd5b835161053e81610443565b602085015160" +
  "4086015191945092506001600160401b0381111561056157600080fd5b61056d86828701610495565b915050925092509256" +
  "5b60008060006060848603121561058c57600080fd5b835161059781610443565b60208501519093506001600160401b0381" +
  "11156105b357600080fd5b6105bf86828701610495565b604086015190935090506001600160401b03811115610561576000" +
  "80fd5b600082516105ef818460208701610471565b9190910192915050565b82815260406020820152600082518060408401" +
  "5261061e816060850160208701610471565b601f01601f1916919091016060019392505050565b6000602082840312156106" +
  "4557600080fd5b81516001600160e01b03198116811461040557600080fd5b634e487b7160e01b6000526032600452602460" +
  "00fdfe5369676e617475726556616c696461746f72237265636f7665725369676e6572";
const FORBIDDEN_PROXY_INPUTS = [
  "CASE_STEWARD_TOKEN",
  "CITIZEN_RELAY_ADMISSION_TOKEN",
  "MECKY_PUBKEY",
  "GNOSIS_RPC_URL",
  "STADTSTACK_CONTROL_BASE_URL",
  "STADTSTACK_PUBLIC_BASE_URL",
  "SYNTHETIC_CITIZENS_JSON",
] as const;

type AllowedMethod = (typeof ALLOWED_METHODS)[number];

type JsonRpcRequest = {
  id: string | number | null;
  jsonrpc: "2.0";
  method: AllowedMethod;
  params: unknown[];
};

type JsonRpcResponse =
  | { id: string | number | null; jsonrpc: "2.0"; result: unknown }
  | {
      error: { code: number; message: string };
      id: string | number | null;
      jsonrpc: "2.0";
    };

export interface GnosisProxyConfig {
  allowedMethods: typeof ALLOWED_METHODS;
  bindHost: "0.0.0.0" | "127.0.0.1";
  expectedChainId: typeof EXPECTED_CHAIN_ID;
  maxBodyBytes: 131072;
  maxConcurrent: 16;
  port: number;
  requestBodyTimeoutMs: number;
  upstreamTimeoutMs: 5000;
  upstreamUrl: typeof UPSTREAM_URL;
}

export interface GnosisProxyDependencies {
  fetch?: typeof globalThis.fetch;
}

export interface RunningGnosisProxy {
  close(): Promise<void>;
  port: number;
}

function exactObject(
  value: unknown,
  required: readonly string[],
  optional: readonly string[] = []
): value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const keys = Reflect.ownKeys(value);
  if (keys.some((key) => typeof key !== "string")) return false;
  const names = keys as string[];
  return (
    required.every((key) => names.includes(key)) &&
    names.every((key) => required.includes(key) || optional.includes(key))
  );
}

function exactSetting(
  environment: Record<string, string | undefined>,
  name: string,
  expected: string
): string {
  const value = environment[name] ?? expected;
  if (value !== expected) throw new Error(`gnosis_proxy_${name.toLowerCase()}_invalid`);
  return value;
}

export function parseGnosisProxyConfig(
  environment: Record<string, string | undefined>
): GnosisProxyConfig {
  for (const name of FORBIDDEN_PROXY_INPUTS) {
    if (Object.prototype.hasOwnProperty.call(environment, name)) {
      throw new Error("gnosis_proxy_forbidden_authority_input");
    }
  }
  exactSetting(environment, "ROEBEL_RUNTIME_ROLE", "gnosis-rpc-proxy");
  const bindHost = environment.GNOSIS_PROXY_BIND_HOST ?? "0.0.0.0";
  if (bindHost !== "0.0.0.0" && bindHost !== "127.0.0.1") {
    throw new Error("gnosis_proxy_bind_host_invalid");
  }
  const rawPort = environment.GNOSIS_PROXY_PORT ?? "8545";
  const port = Number(rawPort);
  if (!/^\d+$/.test(rawPort) || !Number.isSafeInteger(port) || port < 0 || port > 65535) {
    throw new Error("gnosis_proxy_port_invalid");
  }
  exactSetting(environment, "GNOSIS_PROXY_UPSTREAM_URL", UPSTREAM_URL);
  exactSetting(environment, "GNOSIS_PROXY_EXPECTED_CHAIN_ID", EXPECTED_CHAIN_ID);
  exactSetting(environment, "GNOSIS_PROXY_ALLOWED_METHODS", ALLOWED_METHODS_VALUE);
  exactSetting(environment, "GNOSIS_PROXY_MAX_BODY_BYTES", "131072");
  exactSetting(environment, "GNOSIS_PROXY_REQUEST_BODY_TIMEOUT_MS", "2000");
  exactSetting(environment, "GNOSIS_PROXY_UPSTREAM_TIMEOUT_MS", "5000");
  exactSetting(environment, "GNOSIS_PROXY_MAX_CONCURRENT", "16");
  return {
    allowedMethods: ALLOWED_METHODS,
    bindHost,
    expectedChainId: EXPECTED_CHAIN_ID,
    maxBodyBytes: 131072,
    maxConcurrent: 16,
    port,
    requestBodyTimeoutMs: 2000,
    upstreamTimeoutMs: 5000,
    upstreamUrl: UPSTREAM_URL,
  };
}

function validId(value: unknown): value is string | number | null {
  return (
    value === null ||
    (typeof value === "string" && value.length <= 128) ||
    (typeof value === "number" && Number.isSafeInteger(value))
  );
}

function validBlockTag(value: unknown): value is string {
  return typeof value === "string" && BLOCK_TAG.test(value);
}

function validDeploylessErc6492CallData(value: unknown): value is string {
  if (typeof value !== "string" || !HEX_DATA.test(value)) return false;
  const normalized = value.toLowerCase();
  if (!normalized.startsWith(VIEM_2_53_1_ERC6492_VALIDATOR_BYTECODE)) {
    return false;
  }

  const encoded = normalized.slice(VIEM_2_53_1_ERC6492_VALIDATOR_BYTECODE.length);
  const fixedLength =
    DEPLOYLESS_ARGUMENT_HEAD_HEX_LENGTH +
    DEPLOYLESS_SIGNATURE_LENGTH_HEX_LENGTH;
  if (encoded.length < fixedLength) return false;

  const signerWord = encoded.slice(0, ABI_WORD_HEX_LENGTH);
  const offsetWord = encoded.slice(
    2 * ABI_WORD_HEX_LENGTH,
    DEPLOYLESS_ARGUMENT_HEAD_HEX_LENGTH
  );
  if (
    !signerWord.startsWith("0".repeat(24)) ||
    offsetWord !== DEPLOYLESS_SIGNATURE_OFFSET_WORD
  ) {
    return false;
  }

  const lengthWord = encoded.slice(
    DEPLOYLESS_ARGUMENT_HEAD_HEX_LENGTH,
    fixedLength
  );
  const signatureBytes = BigInt(`0x${lengthWord}`);
  if (
    signatureBytes < 1n ||
    signatureBytes > BigInt(MAX_DEPLOYLESS_SIGNATURE_BYTES)
  ) {
    return false;
  }
  const paddedSignatureBytes = Number((signatureBytes + 31n) / 32n) * 32;
  const expectedLength = fixedLength + paddedSignatureBytes * 2;
  if (encoded.length !== expectedLength) return false;

  const signatureHexLength = Number(signatureBytes) * 2;
  const signatureAndPadding = encoded.slice(fixedLength);
  const padding = signatureAndPadding.slice(signatureHexLength);
  return /^0*$/.test(padding);
}

function validParams(method: AllowedMethod, params: unknown[]): boolean {
  if (method === "eth_chainId" || method === "eth_blockNumber") {
    return params.length === 0;
  }
  if (method === "eth_getCode") {
    return (
      params.length === 2 &&
      typeof params[0] === "string" &&
      ADDRESS.test(params[0]) &&
      validBlockTag(params[1])
    );
  }
  if (params.length < 1 || params.length > 2) return false;
  const call = params[0];
  if (
    exactObject(call, ["data"]) &&
    params.length === 2 &&
    params[1] === "latest"
  ) {
    return validDeploylessErc6492CallData(call.data);
  }
  if (!exactObject(call, ["to", "data"])) return false;
  if (
    typeof call.to !== "string" ||
    !ADDRESS.test(call.to) ||
    typeof call.data !== "string" ||
    call.data.length > 65_538 ||
    !HEX_DATA.test(call.data)
  ) {
    return false;
  }
  return params.length === 1 || validBlockTag(params[1]);
}

function parseJsonRpcRequest(value: unknown): JsonRpcRequest | null {
  if (!exactObject(value, ["jsonrpc", "id", "method"], ["params"])) return null;
  if (value.jsonrpc !== "2.0" || !validId(value.id)) return null;
  if (
    typeof value.method !== "string" ||
    !ALLOWED_METHODS.includes(value.method as AllowedMethod)
  ) {
    return null;
  }
  const params = value.params ?? [];
  if (!Array.isArray(params) || !validParams(value.method as AllowedMethod, params)) {
    return null;
  }
  return {
    id: value.id,
    jsonrpc: "2.0",
    method: value.method as AllowedMethod,
    params,
  };
}

function parseUpstreamResponse(
  value: unknown,
  expectedId: string | number | null
): JsonRpcResponse | null {
  if (!exactObject(value, ["jsonrpc", "id"], ["result", "error"])) return null;
  if (value.jsonrpc !== "2.0" || value.id !== expectedId) return null;
  const hasResult = Object.prototype.hasOwnProperty.call(value, "result");
  const hasError = Object.prototype.hasOwnProperty.call(value, "error");
  if (hasResult === hasError) return null;
  if (hasResult) return { id: expectedId, jsonrpc: "2.0", result: value.result };
  if (!exactObject(value.error, ["code", "message"])) return null;
  if (
    typeof value.error.code !== "number" ||
    !Number.isSafeInteger(value.error.code) ||
    typeof value.error.message !== "string" ||
    value.error.message.length > 256
  ) {
    return null;
  }
  return {
    error: { code: value.error.code, message: value.error.message },
    id: expectedId,
    jsonrpc: "2.0",
  };
}

function sendJson(
  response: ServerResponse,
  status: number,
  value: unknown,
  head = false
): void {
  if (response.destroyed || response.writableEnded) return;
  const body = JSON.stringify(value);
  response.writeHead(status, {
    "cache-control": "no-store",
    "content-length": Buffer.byteLength(body),
    "content-type": "application/json; charset=utf-8",
    "x-content-type-options": "nosniff",
    "x-stadtstack-authority": "none",
  });
  response.end(head ? undefined : body);
}

async function readBoundedBody(
  request: IncomingMessage,
  maximum: number,
  timeoutMs: number
): Promise<string> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      reject(new Error("request_body_timeout"));
      request.destroy();
    }, timeoutMs);
  });
  const collect = async () => {
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of request) {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      size += buffer.length;
      if (size > maximum) {
        request.destroy();
        throw new Error("request_too_large");
      }
      chunks.push(buffer);
    }
    return Buffer.concat(chunks).toString("utf8");
  };
  try {
    return await Promise.race([collect(), timeout]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

async function readBoundedUpstreamBody(
  response: Response,
  maximum: number
): Promise<string> {
  if (!response.body) throw new Error("upstream_response_invalid");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      size += next.value.byteLength;
      if (size > maximum) {
        await reader.cancel("upstream_response_too_large");
        throw new Error("upstream_response_too_large");
      }
      chunks.push(next.value);
    }
  } finally {
    reader.releaseLock();
  }
  const body = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder("utf-8", { fatal: true }).decode(body);
}

async function callUpstream(
  config: GnosisProxyConfig,
  fetchFn: typeof globalThis.fetch,
  request: JsonRpcRequest,
  activeControllers: Set<AbortController>,
  shutdownSignal: AbortSignal
): Promise<JsonRpcResponse> {
  const controller = new AbortController();
  const abortForShutdown = () => controller.abort();
  activeControllers.add(controller);
  if (shutdownSignal.aborted) controller.abort();
  else shutdownSignal.addEventListener("abort", abortForShutdown, { once: true });
  const timeout = setTimeout(() => controller.abort(), config.upstreamTimeoutMs);
  try {
    const response = await fetchFn(config.upstreamUrl, {
      body: JSON.stringify(request),
      headers: { "content-type": "application/json" },
      method: "POST",
      redirect: "error",
      signal: controller.signal,
    });
    const contentType = response.headers.get("content-type") ?? "";
    if (!response.ok || !contentType.toLowerCase().startsWith("application/json")) {
      throw new Error("upstream_response_invalid");
    }
    const body = await readBoundedUpstreamBody(
      response,
      MAX_UPSTREAM_RESPONSE_BYTES
    );
    const parsed = parseUpstreamResponse(JSON.parse(body), request.id);
    if (!parsed) throw new Error("upstream_response_invalid");
    return parsed;
  } finally {
    clearTimeout(timeout);
    shutdownSignal.removeEventListener("abort", abortForShutdown);
    activeControllers.delete(controller);
  }
}

async function assertGnosisChain(
  config: GnosisProxyConfig,
  fetchFn: typeof globalThis.fetch,
  activeControllers: Set<AbortController>,
  shutdownSignal: AbortSignal
): Promise<void> {
  const response = await callUpstream(
    config,
    fetchFn,
    {
      id: "stadtstack-chain-check",
      jsonrpc: "2.0",
      method: "eth_chainId",
      params: [],
    },
    activeControllers,
    shutdownSignal
  );
  if (!("result" in response) || response.result !== config.expectedChainId) {
    throw new Error("gnosis_proxy_chain_mismatch");
  }
}

export async function startGnosisProxy(
  config: GnosisProxyConfig,
  dependencies: GnosisProxyDependencies = {}
): Promise<RunningGnosisProxy> {
  const fetchFn = dependencies.fetch ?? globalThis.fetch;
  const activeControllers = new Set<AbortController>();
  const shutdownController = new AbortController();
  const sockets = new Set<Socket>();
  let concurrent = 0;
  let closing = false;
  let closePromise: Promise<void> | null = null;
  const acquire = (): (() => void) | null => {
    if (concurrent >= config.maxConcurrent) return null;
    concurrent += 1;
    let released = false;
    return () => {
      if (released) return;
      released = true;
      concurrent -= 1;
    };
  };
  const server: Server = createServer(async (request, response) => {
    const method = request.method ?? "";
    const target = request.url ?? "";
    const head = method === "HEAD";
    if ((method === "GET" || head) && target === "/healthz") {
      sendJson(response, 200, { authorityBinding: "none", status: "ok" }, head);
      return;
    }
    if ((method === "GET" || head) && target === "/readyz") {
      const release = acquire();
      if (!release) {
        sendJson(response, 503, { error: "busy" }, head);
        return;
      }
      try {
        await assertGnosisChain(
          config,
          fetchFn,
          activeControllers,
          shutdownController.signal
        );
        sendJson(
          response,
          200,
          { chainId: config.expectedChainId, status: "ready" },
          head
        );
      } catch {
        sendJson(response, 503, { error: "upstream_unavailable" }, head);
      } finally {
        release();
      }
      return;
    }
    if (method !== "POST" || target !== "/") {
      sendJson(response, method === "POST" ? 404 : 405, { error: "not_found" });
      return;
    }
    if ((request.headers["content-type"] ?? "").split(";", 1)[0]?.trim().toLowerCase() !== "application/json") {
      sendJson(response, 415, { error: "unsupported_media_type" });
      return;
    }
    const release = acquire();
    if (!release) {
      sendJson(response, 503, { error: "busy" });
      return;
    }
    let rpcId: string | number | null = null;
    try {
      let rpc: JsonRpcRequest | null = null;
      try {
        const raw = await readBoundedBody(
          request,
          config.maxBodyBytes,
          config.requestBodyTimeoutMs
        );
        rpc = parseJsonRpcRequest(JSON.parse(raw));
      } catch {
        if (request.destroyed || response.destroyed) return;
        sendJson(response, 400, { error: "invalid_json_rpc_request" });
        return;
      }
      if (!rpc) {
        sendJson(response, 400, { error: "invalid_json_rpc_request" });
        return;
      }
      rpcId = rpc.id;
      if (closing) return;
      await assertGnosisChain(
        config,
        fetchFn,
        activeControllers,
        shutdownController.signal
      );
      const result = await callUpstream(
        config,
        fetchFn,
        rpc,
        activeControllers,
        shutdownController.signal
      );
      sendJson(response, 200, result);
    } catch {
      sendJson(response, 502, {
        error: { code: -32000, message: "upstream_unavailable" },
        id: rpcId,
        jsonrpc: "2.0",
      });
    } finally {
      release();
    }
  });
  server.on("connection", (socket: Socket) => {
    sockets.add(socket);
    socket.once("close", () => sockets.delete(socket));
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(config.port, config.bindHost, () => {
      server.off("error", reject);
      resolve();
    });
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("gnosis_proxy_listener_invalid");
  return {
    close: () => {
      if (closePromise) return closePromise;
      closing = true;
      shutdownController.abort();
      for (const controller of activeControllers) controller.abort();
      closePromise = new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
        for (const socket of sockets) socket.destroy();
      });
      return closePromise;
    },
    port: address.port,
  };
}
