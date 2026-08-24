import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { it } from "node:test";
import { createGnosisWalletVerifier } from "@netizen-labs/relay-sync";
import {
  erc6492SignatureValidatorByteCode,
  serializeErc6492Signature,
} from "viem";
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

function lockImporter(lock: string, name: string): string {
  const importerStart = lock.indexOf(`  packages/${name}:`);
  assert.notEqual(importerStart, -1);
  const nextPackageImporter = lock.indexOf("\n  packages/", importerStart + 1);
  const packagesSection = lock.indexOf("\npackages:", importerStart + 1);
  const importerEnd = [nextPackageImporter, packagesSection]
    .filter((offset) => offset !== -1)
    .sort((left, right) => left - right)[0];
  assert.notEqual(importerEnd, -1);
  return lock.slice(importerStart, importerEnd);
}

function assertExactViemPins(): void {
  const relayPackage = JSON.parse(
    readFileSync(
      new URL("../../relay-sync/package.json", import.meta.url),
      "utf8"
    )
  ) as { dependencies?: { viem?: unknown } };
  assert.equal(relayPackage.dependencies?.viem, "2.53.1");
  const workbenchPackage = JSON.parse(
    readFileSync(new URL("../package.json", import.meta.url), "utf8")
  ) as { devDependencies?: { viem?: unknown } };
  assert.equal(workbenchPackage.devDependencies?.viem, "2.53.1");
  const lock = readFileSync(
    new URL("../../../pnpm-lock.yaml", import.meta.url),
    "utf8"
  );
  for (const importer of ["e2e-workbench", "relay-sync"]) {
    assert.match(
      lockImporter(lock, importer),
      /viem:\n\s+specifier: 2\.53\.1\n\s+version: 2\.53\.1\(/
    );
  }
  const expectedResolution =
    "  viem@2.53.1:\n" +
    "    resolution: {integrity: " +
    "sha512-FhfJ/SW73CVosiyVLmIMVgKDRKYV1AGCLzZoHYvmNayyVff63Qi1ocPCk59LqC/" +
    "cNw244RbBJjHnmxqXkE7NpA==}\n";
  assert.equal(lock.includes(expectedResolution), true);
}

it("pins the verifier and transport fixture to exact viem 2.53.1", () => {
  assertExactViemPins();
});

it("reads the final package importer from a pruned lockfile", () => {
  const prunedLock =
    "lockfileVersion: '9.0'\n\n" +
    "importers:\n\n" +
    "  packages/relay-sync:\n" +
    "    dependencies:\n" +
    "      viem:\n" +
    "        specifier: 2.53.1\n" +
    "        version: 2.53.1(zod@3.25.76)\n\n" +
    "packages:\n\n" +
    "  viem@2.53.1:\n" +
    "    resolution: {integrity: pinned}\n";
  assert.match(
    lockImporter(prunedLock, "relay-sync"),
    /specifier: 2\.53\.1\n\s+version: 2\.53\.1\(/u
  );
});

it("drives relay-sync's real viem 2.53.1 ERC-6492 transport through the proxy", async () => {
  assertExactViemPins();
  assert.equal(
    erc6492SignatureValidatorByteCode,
    VIEM_2_53_1_ERC6492_VALIDATOR_BYTECODE
  );
  assert.equal(
    createHash("sha256")
      .update(Buffer.from(erc6492SignatureValidatorByteCode.slice(2), "hex"))
      .digest("hex"),
    "d46b6085a6558eb925573e4e395ccbc669a1db1b7aa49196cbb1a7540db6a470"
  );

  const upstreamRequests: Array<Record<string, unknown>> = [];
  const fakeFetch: typeof globalThis.fetch = async (_input, init) => {
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    upstreamRequests.push(body);
    if (body.method === "eth_chainId") return response(body.id, "0x64");
    if (body.method === "eth_call") return response(body.id, "0x01");
    if (body.method === "eth_blockNumber") return response(body.id, "0x1");
    throw new Error("unexpected_upstream_method");
  };
  const running = await startGnosisProxy(
    parseGnosisProxyConfig(environment()),
    {
      fetch: fakeFetch,
    }
  );
  try {
    const signature = serializeErc6492Signature({
      address: `0x${"33".repeat(20)}` as `0x${string}`,
      data: "0x12345678",
      signature: `0x${"44".repeat(65)}` as `0x${string}`,
    });
    const verifier = createGnosisWalletVerifier({
      rpcUrl: `http://127.0.0.1:${running.port}`,
    });
    assert.equal(
      await verifier.verifyWalletSignature({
        address: `0x${"11".repeat(20)}`,
        message: "stadtstack locked viem transport fixture",
        signature,
      }),
      true
    );

    const forwarded = upstreamRequests.find(
      (request) => request.method === "eth_call"
    );
    assert.ok(forwarded);
    const params = forwarded.params as unknown[];
    assert.equal(params.length, 2);
    assert.equal(params[1], "latest");
    assert.deepEqual(Object.keys(params[0] as object), ["data"]);
    const data = (params[0] as { data: string }).data;
    assert.equal((data.length - 2) / 2, 2_132);
    assert.equal(
      createHash("sha256")
        .update(Buffer.from(data.slice(2), "hex"))
        .digest("hex"),
      "407323307c814f071be3cd064668868adc3d96af5dfba1b42f518a57664b4082"
    );
    assert.equal(data.startsWith(VIEM_2_53_1_ERC6492_VALIDATOR_BYTECODE), true);
    assert.equal(data.endsWith("6492".repeat(16)), true);
  } finally {
    await running.close();
  }
});
