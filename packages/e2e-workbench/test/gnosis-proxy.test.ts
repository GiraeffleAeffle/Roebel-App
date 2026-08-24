import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { once } from "node:events";
import { connect } from "node:net";
import { describe, it } from "node:test";
import {
  parseGnosisProxyConfig,
  startGnosisProxy,
  VIEM_2_53_1_ERC6492_VALIDATOR_BYTECODE,
} from "../src/gnosis-proxy.ts";

function environment() {
  return {
    ROEBEL_RUNTIME_ROLE: "gnosis-rpc-proxy",
    GNOSIS_PROXY_BIND_HOST: "127.0.0.1",
    GNOSIS_PROXY_PORT: "0",
    GNOSIS_PROXY_UPSTREAM_URL: "https://rpc.gnosischain.com",
    GNOSIS_PROXY_EXPECTED_CHAIN_ID: "0x64",
    GNOSIS_PROXY_ALLOWED_METHODS:
      "eth_blockNumber,eth_call,eth_chainId,eth_getCode",
    GNOSIS_PROXY_MAX_BODY_BYTES: "131072",
    GNOSIS_PROXY_REQUEST_BODY_TIMEOUT_MS: "2000",
    GNOSIS_PROXY_UPSTREAM_TIMEOUT_MS: "5000",
    GNOSIS_PROXY_MAX_CONCURRENT: "16",
  };
}

function response(id: unknown, result: unknown) {
  return new Response(JSON.stringify({ id, jsonrpc: "2.0", result }), {
    headers: { "content-type": "application/json" },
  });
}

function socketClosed(socket: ReturnType<typeof connect>): Promise<void> {
  return new Promise((resolve) => {
    socket.once("error", () => undefined);
    socket.once("close", () => resolve());
  });
}

async function rawRequest(
  port: number,
  requestTarget: string,
  body = JSON.stringify({
    id: 1,
    jsonrpc: "2.0",
    method: "eth_blockNumber",
    params: [],
  })
): Promise<string> {
  const socket = connect(port, "127.0.0.1");
  await once(socket, "connect");
  socket.end(
    `POST ${requestTarget} HTTP/1.1\r\n` +
      "Host: gnosis-proxy.invalid\r\n" +
      "Content-Type: application/json\r\n" +
      `Content-Length: ${Buffer.byteLength(body)}\r\n` +
      "Connection: close\r\n\r\n" +
      body
  );
  let value = "";
  for await (const chunk of socket) value += chunk.toString("utf8");
  return value;
}

async function within<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error("test_timeout")), timeoutMs);
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

function abiWord(value: bigint | number): string {
  return BigInt(value).toString(16).padStart(64, "0");
}

function addressWord(address: string): string {
  return address.slice(2).padStart(64, "0");
}

function paddedData(data: string): string {
  const value = data.slice(2);
  return value.padEnd(Math.ceil(value.length / 64) * 64, "0");
}

function deterministicErc6492Signature(): string {
  const factory = `0x${"33".repeat(20)}`;
  const factoryData = "0x12345678";
  const innerSignature = `0x${"44".repeat(65)}`;
  const factoryDataBytes = (factoryData.length - 2) / 2;
  const paddedFactoryDataBytes = Math.ceil(factoryDataBytes / 32) * 32;
  const signatureOffset = 3 * 32 + 32 + paddedFactoryDataBytes;
  const encoded =
    addressWord(factory) +
    abiWord(3 * 32) +
    abiWord(signatureOffset) +
    abiWord(factoryDataBytes) +
    paddedData(factoryData) +
    abiWord((innerSignature.length - 2) / 2) +
    paddedData(innerSignature);
  return `0x${encoded}${"6492".repeat(16)}`;
}

function deploylessVerifierData(
  signature = deterministicErc6492Signature()
): string {
  const signatureBytes = (signature.length - 2) / 2;
  return (
    VIEM_2_53_1_ERC6492_VALIDATOR_BYTECODE +
    addressWord(`0x${"11".repeat(20)}`) +
    "22".repeat(32) +
    abiWord(3 * 32) +
    abiWord(signatureBytes) +
    paddedData(signature)
  );
}

async function postRpc(
  origin: string,
  payload: Record<string, unknown>
): Promise<Response> {
  return fetch(origin, {
    body: JSON.stringify(payload),
    headers: { "content-type": "application/json" },
    method: "POST",
  });
}

describe("private Gnosis verification proxy", () => {
  it("accepts only the exact chain-100 upstream and capability-free inputs", () => {
    const config = parseGnosisProxyConfig(environment());
    assert.equal(config.upstreamUrl, "https://rpc.gnosischain.com");
    assert.equal(config.expectedChainId, "0x64");
    assert.deepEqual(config.allowedMethods, [
      "eth_blockNumber",
      "eth_call",
      "eth_chainId",
      "eth_getCode",
    ]);
    for (const [name, value] of [
      ["GNOSIS_PROXY_UPSTREAM_URL", "https://example.invalid"],
      ["GNOSIS_PROXY_EXPECTED_CHAIN_ID", "0x1"],
      ["GNOSIS_PROXY_ALLOWED_METHODS", "eth_sendRawTransaction"],
      ["GNOSIS_PROXY_MAX_BODY_BYTES", "262144"],
      ["GNOSIS_PROXY_REQUEST_BODY_TIMEOUT_MS", "30000"],
      ["GNOSIS_PROXY_UPSTREAM_TIMEOUT_MS", "30000"],
      ["GNOSIS_PROXY_MAX_CONCURRENT", "100"],
    ]) {
      assert.throws(() =>
        parseGnosisProxyConfig({ ...environment(), [name]: value })
      );
    }
    for (const name of [
      "CASE_STEWARD_TOKEN",
      "CITIZEN_RELAY_ADMISSION_TOKEN",
      "MECKY_PUBKEY",
      "GNOSIS_RPC_URL",
      "STADTSTACK_CONTROL_BASE_URL",
      "STADTSTACK_PUBLIC_BASE_URL",
      "SYNTHETIC_CITIZENS_JSON",
    ]) {
      assert.throws(
        () => parseGnosisProxyConfig({ ...environment(), [name]: "present" }),
        /gnosis_proxy_forbidden_authority_input/
      );
    }
  });

  it("forwards only bounded read-only JSON-RPC after an exact chain check", async () => {
    const requests: Array<Record<string, unknown>> = [];
    const fakeFetch: typeof globalThis.fetch = async (input, init) => {
      assert.equal(String(input), "https://rpc.gnosischain.com");
      assert.equal(init?.method, "POST");
      assert.equal(init?.redirect, "error");
      assert.deepEqual(init?.headers, { "content-type": "application/json" });
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      requests.push(body);
      if (body.method === "eth_chainId") return response(body.id, "0x64");
      if (body.method === "eth_blockNumber") return response(body.id, "0x123");
      if (body.method === "eth_getCode") return response(body.id, "0x6000");
      if (body.method === "eth_call") return response(body.id, "0x01");
      throw new Error("unexpected_method");
    };
    const running = await startGnosisProxy(parseGnosisProxyConfig(environment()), {
      fetch: fakeFetch,
    });
    try {
      const origin = `http://127.0.0.1:${running.port}`;
      assert.equal((await fetch(`${origin}/healthz`)).status, 200);
      assert.equal((await fetch(`${origin}/readyz`)).status, 200);
      for (const payload of [
        { id: 1, jsonrpc: "2.0", method: "eth_blockNumber", params: [] },
        {
          id: 2,
          jsonrpc: "2.0",
          method: "eth_getCode",
          params: [`0x${"11".repeat(20)}`, "latest"],
        },
        {
          id: 3,
          jsonrpc: "2.0",
          method: "eth_call",
          params: [
            { data: "0x1234", to: `0x${"22".repeat(20)}` },
            "latest",
          ],
        },
      ]) {
        const result = await fetch(origin, {
          body: JSON.stringify(payload),
          headers: {
            authorization: "Bearer must-not-be-forwarded",
            cookie: "must-not-be-forwarded=1",
            "content-type": "application/json",
            "x-caller-header": "must-not-be-forwarded",
          },
          method: "POST",
        });
        assert.equal(result.status, 200);
        assert.equal((await result.json()).id, payload.id);
      }
      assert.deepEqual(
        new Set(requests.map((request) => request.method)),
        new Set(["eth_chainId", "eth_blockNumber", "eth_getCode", "eth_call"])
      );
      assert.equal(
        requests.every((request) =>
          ["eth_chainId", "eth_blockNumber", "eth_getCode", "eth_call"].includes(
            String(request.method)
          )
        ),
        true
      );
    } finally {
      await running.close();
    }
  });

  it("admits only viem 2.53.1's bounded deployless ERC-6492 verifier shape", async () => {
    assert.equal((VIEM_2_53_1_ERC6492_VALIDATOR_BYTECODE.length - 2) / 2, 1_684);
    assert.equal(
      createHash("sha256")
        .update(
          Buffer.from(VIEM_2_53_1_ERC6492_VALIDATOR_BYTECODE.slice(2), "hex")
        )
        .digest("hex"),
      "d46b6085a6558eb925573e4e395ccbc669a1db1b7aa49196cbb1a7540db6a470"
    );
    const deploylessData = deploylessVerifierData();
    assert.equal(deploylessData.endsWith("6492".repeat(16)), true);

    const requests: Array<Record<string, unknown>> = [];
    const fakeFetch: typeof globalThis.fetch = async (_input, init) => {
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      requests.push(body);
      if (body.method === "eth_chainId") return response(body.id, "0x64");
      return response(body.id, "0x01");
    };
    const running = await startGnosisProxy(parseGnosisProxyConfig(environment()), {
      fetch: fakeFetch,
    });
    try {
      const origin = `http://127.0.0.1:${running.port}`;
      const fixture = {
        id: 6492,
        jsonrpc: "2.0",
        method: "eth_call",
        params: [{ data: deploylessData }, "latest"],
      };
      const accepted = await postRpc(origin, fixture);
      assert.equal(accepted.status, 200);
      assert.deepEqual(await accepted.json(), {
        id: 6492,
        jsonrpc: "2.0",
        result: "0x01",
      });
      assert.deepEqual(requests.at(-1), fixture);
      const callsAfterAccepted = requests.length;

      const mutatedPrefix = `0x${
        deploylessData.slice(2, 4) === "60" ? "61" : "60"
      }${deploylessData.slice(4)}`;
      const oversized = deploylessVerifierData(`0x${"55".repeat(8 * 1024 + 1)}`);
      for (const params of [
        [{ data: "0x60006000" }, "latest"],
        [{ data: mutatedPrefix }, "latest"],
        [{ data: oversized }, "latest"],
        [{ data: deploylessData, gas: "0x1" }, "latest"],
        [{ data: deploylessData }],
        [{ data: deploylessData }, "safe"],
      ]) {
        const rejected = await postRpc(origin, {
          id: 6493,
          jsonrpc: "2.0",
          method: "eth_call",
          params,
        });
        assert.equal(rejected.status, 400);
      }
      assert.equal(requests.length, callsAfterAccepted);
    } finally {
      await running.close();
    }
  });

  it("rejects writes, batches, state overrides, arbitrary paths, and a wrong chain", async () => {
    let chainId = "0x64";
    let unexpectedCalls = 0;
    const fakeFetch: typeof globalThis.fetch = async (_input, init) => {
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      if (body.method === "eth_chainId") return response(body.id, chainId);
      unexpectedCalls += 1;
      return response(body.id, "0x");
    };
    const running = await startGnosisProxy(parseGnosisProxyConfig(environment()), {
      fetch: fakeFetch,
    });
    try {
      const origin = `http://127.0.0.1:${running.port}`;
      const invalid = [
        [{ id: 1, jsonrpc: "2.0", method: "eth_chainId", params: [] }],
        { id: 2, jsonrpc: "2.0", method: "eth_sendRawTransaction", params: ["0x00"] },
        {
          id: 3,
          jsonrpc: "2.0",
          method: "eth_call",
          params: [
            { data: "0x", to: `0x${"11".repeat(20)}`, value: "0x1" },
            "latest",
          ],
        },
      ];
      for (const payload of invalid) {
        const result = await fetch(origin, {
          body: JSON.stringify(payload),
          headers: { "content-type": "application/json" },
          method: "POST",
        });
        assert.equal(result.status, 400);
      }
      assert.equal((await fetch(`${origin}/admin`)).status, 405);
      assert.equal(
        (
          await fetch(`${origin}/other`, {
            body: "{}",
            headers: { "content-type": "application/json" },
            method: "POST",
          })
        ).status,
        404
      );
      chainId = "0x1";
      const wrongChain = await fetch(origin, {
        body: JSON.stringify({
          id: 4,
          jsonrpc: "2.0",
          method: "eth_blockNumber",
          params: [],
        }),
        headers: { "content-type": "application/json" },
        method: "POST",
      });
      assert.equal(wrongChain.status, 502);
      assert.equal(unexpectedCalls, 0);
      assert.deepEqual(await wrongChain.json(), {
        error: { code: -32000, message: "upstream_unavailable" },
        id: 4,
        jsonrpc: "2.0",
      });
    } finally {
      await running.close();
    }
  });

  it("fails closed before buffering an oversized upstream response", async () => {
    const oversized = `\"${"a".repeat(256 * 1024)}\"`;
    const fakeFetch: typeof globalThis.fetch = async (_input, init) => {
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      if (body.method === "eth_chainId") return response(body.id, "0x64");
      return new Response(
        `{"id":${JSON.stringify(body.id)},"jsonrpc":"2.0","result":${oversized}}`,
        { headers: { "content-type": "application/json" } }
      );
    };
    const running = await startGnosisProxy(parseGnosisProxyConfig(environment()), {
      fetch: fakeFetch,
    });
    try {
      const result = await fetch(`http://127.0.0.1:${running.port}`, {
        body: JSON.stringify({
          id: 1,
          jsonrpc: "2.0",
          method: "eth_blockNumber",
          params: [],
        }),
        headers: { "content-type": "application/json" },
        method: "POST",
      });
      assert.equal(result.status, 502);
      assert.deepEqual(await result.json(), {
        error: { code: -32000, message: "upstream_unavailable" },
        id: 1,
        jsonrpc: "2.0",
      });
    } finally {
      await running.close();
    }
  });

  it("applies the global concurrency cap to readiness upstream calls", async () => {
    let active = 0;
    let maximum = 0;
    let release!: () => void;
    let saturated!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const allPermitsUsed = new Promise<void>((resolve) => {
      saturated = resolve;
    });
    const fakeFetch: typeof globalThis.fetch = async (_input, init) => {
      active += 1;
      maximum = Math.max(maximum, active);
      if (active === 16) saturated();
      await gate;
      active -= 1;
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return response(body.id, "0x64");
    };
    const running = await startGnosisProxy(parseGnosisProxyConfig(environment()), {
      fetch: fakeFetch,
    });
    let accepted: Array<Promise<Response>> = [];
    try {
      const origin = `http://127.0.0.1:${running.port}`;
      accepted = Array.from({ length: 16 }, () =>
        fetch(`${origin}/readyz`)
      );
      await within(allPermitsUsed, 1_000);
      const overflow = await within(fetch(`${origin}/readyz`), 1_000);
      assert.equal(overflow.status, 503);
      assert.deepEqual(await overflow.json(), { error: "busy" });
      assert.equal(maximum, 16);
      release();
      assert.deepEqual(
        await Promise.all(accepted.map(async (result) => (await result).status)),
        Array(16).fill(200)
      );
    } finally {
      release();
      await Promise.allSettled(accepted);
      await running.close();
    }
  });

  it("bounds partial request bodies and closes partial sockets during shutdown", async () => {
    const shortTimeout = {
      ...parseGnosisProxyConfig(environment()),
      requestBodyTimeoutMs: 50,
    };
    const timed = await startGnosisProxy(shortTimeout, {
      fetch: async () => {
        throw new Error("unexpected_upstream_call");
      },
    });
    try {
      const timedSocket = connect(timed.port, "127.0.0.1");
      await once(timedSocket, "connect");
      timedSocket.write(
        "POST / HTTP/1.1\r\n" +
          "Host: gnosis-proxy.invalid\r\n" +
          "Content-Type: application/json\r\n" +
          "Content-Length: 100\r\n\r\n{"
      );
      await within(socketClosed(timedSocket), 500);
    } finally {
      await timed.close();
    }

    const closing = await startGnosisProxy(
      {
        ...parseGnosisProxyConfig(environment()),
        requestBodyTimeoutMs: 5_000,
      },
      {
        fetch: async () => {
          throw new Error("unexpected_upstream_call");
        },
      }
    );
    try {
      const closingSocket = connect(closing.port, "127.0.0.1");
      await once(closingSocket, "connect");
      closingSocket.write(
        "POST / HTTP/1.1\r\n" +
          "Host: gnosis-proxy.invalid\r\n" +
          "Content-Type: application/json\r\n" +
          "Content-Length: 100\r\n\r\n{"
      );
      const closed = socketClosed(closingSocket);
      await within(closing.close(), 500);
      await within(closed, 500);
    } finally {
      await closing.close();
    }
  });

  it("aborts an active upstream call during deterministic shutdown", async () => {
    let started!: () => void;
    let upstreamSignal: AbortSignal | null = null;
    const upstreamStarted = new Promise<void>((resolve) => {
      started = resolve;
    });
    const fakeFetch: typeof globalThis.fetch = async (_input, init) =>
      new Promise<Response>((_resolve, reject) => {
        upstreamSignal = init?.signal ?? null;
        started();
        if (upstreamSignal?.aborted) {
          reject(new Error("aborted"));
          return;
        }
        upstreamSignal?.addEventListener(
          "abort",
          () => reject(new Error("aborted")),
          { once: true }
        );
      });
    const running = await startGnosisProxy(parseGnosisProxyConfig(environment()), {
      fetch: fakeFetch,
    });
    const client = fetch(`http://127.0.0.1:${running.port}/readyz`).catch(
      () => null
    );
    await within(upstreamStarted, 500);
    await within(running.close(), 500);
    assert.equal(upstreamSignal?.aborted, true);
    await client;
  });

  it("rejects every non-exact raw request target before URL normalization", async () => {
    let upstreamCalls = 0;
    const running = await startGnosisProxy(parseGnosisProxyConfig(environment()), {
      fetch: async () => {
        upstreamCalls += 1;
        throw new Error("unexpected_upstream_call");
      },
    });
    try {
      for (const target of [
        "http://attacker.invalid/",
        "//attacker.invalid/",
        "/?query=1",
        "/%2e%2e/",
        "/other",
      ]) {
        const result = await rawRequest(running.port, target);
        assert.match(result, /^HTTP\/1\.1 404 Not Found\r\n/u, target);
      }
      assert.equal(upstreamCalls, 0);
    } finally {
      await running.close();
    }
  });
});
