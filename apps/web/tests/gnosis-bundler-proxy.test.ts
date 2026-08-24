import assert from "node:assert/strict";
import { test } from "node:test";

import {
  BUNDLER_REQUESTS_PER_MINUTE,
  GOVERNOR_PROPOSE_WITH_PERIOD_SELECTOR,
  REVIEWED_GOVERNOR_ADDRESS,
  SMART_ACCOUNT_EXECUTE_SELECTOR,
  createProposalBundlerBudget,
  hasBoundedJsonShape,
  isSameOrigin,
  parseGnosisBundlerConfig,
  parseProposalBundlerRequest,
  sanitizeBundlerResponse,
} from "../src/lib/server/gnosis-bundler-proxy";

const ENTRY_POINT = "0x0000000071727de22e5e9d8baf0edac6f37da032";
function word(value: bigint): string {
  return value.toString(16).padStart(64, "0");
}

function proposalCallData(period = 604800n): string {
  // Canonical ABI for proposeWithPeriod([], [], [], "x", period).
  return `${GOVERNOR_PROPOSE_WITH_PERIOD_SELECTOR}${word(160n)}${word(192n)}${word(224n)}${word(256n)}${word(period)}${word(0n)}${word(0n)}${word(0n)}${word(1n)}78${"0".repeat(62)}`;
}

function executeProposal(
  target = REVIEWED_GOVERNOR_ADDRESS,
  value = 0n,
  inner = proposalCallData(),
  offset = 96n,
  suffix = ""
): string {
  const innerHex = inner.slice(2);
  const paddedInner = innerHex.padEnd(
    Math.ceil(innerHex.length / 64) * 64,
    "0"
  );
  return `${SMART_ACCOUNT_EXECUTE_SELECTOR}${target.slice(2).padStart(64, "0")}${word(value)}${word(offset)}${word(BigInt(innerHex.length / 2))}${paddedInner}${suffix}`;
}

function userOperation(callData = executeProposal()) {
  return {
    sender: "0x1111111111111111111111111111111111111111",
    nonce: "0x0",
    callData,
    callGasLimit: "0x989680",
    verificationGasLimit: "0x2dc6c0",
    preVerificationGas: "0x186a0",
    maxFeePerGas: "0x59682f00",
    maxPriorityFeePerGas: "0x59682f00",
    signature: "0x",
  };
}

test("accepts only the fixed chain-100 Pimlico endpoint", () => {
  const valid = "https://api.pimlico.io/v2/100/rpc?apikey=abcdefghijklmnop";
  assert.deepEqual(parseGnosisBundlerConfig(valid, REVIEWED_GOVERNOR_ADDRESS), {
    governorAddress: REVIEWED_GOVERNOR_ADDRESS,
    url: valid,
  });
  for (const invalid of [
    "https://api.pimlico.io/v2/1/rpc?apikey=abcdefghijklmnop",
    "https://attacker.invalid/v2/100/rpc?apikey=abcdefghijklmnop",
    "https://api.pimlico.io/v2/100/rpc?apikey=abcdefghijklmnop&url=https://attacker.invalid",
    "https://api.pimlico.io/v2/100/rpc?apikey=short",
  ]) {
    assert.equal(
      parseGnosisBundlerConfig(invalid, REVIEWED_GOVERNOR_ADDRESS),
      null,
      invalid
    );
  }
  assert.equal(
    parseGnosisBundlerConfig(
      valid,
      "0x0000000000000000000000000000000000000000"
    ),
    null
  );
});

test("admits only exact, self-paying account-abstraction RPC shapes", () => {
  const accepted = parseProposalBundlerRequest({
    id: 7,
    jsonrpc: "2.0",
    method: "eth_sendUserOperation",
    params: [userOperation(), ENTRY_POINT],
  });
  assert.deepEqual(accepted?.method, "eth_sendUserOperation");
  for (const request of [
    {
      id: 1,
      jsonrpc: "2.0",
      method: "eth_sendRawTransaction",
      params: ["0x00"],
    },
    { id: 1, jsonrpc: "2.0", method: "debug_traceCall", params: [] },
    {
      id: 1,
      jsonrpc: "2.0",
      method: "eth_sendUserOperation",
      params: [userOperation(), "0x0000000000000000000000000000000000000000"],
    },
    {
      id: 1,
      jsonrpc: "2.0",
      method: "eth_sendUserOperation",
      params: [
        {
          ...userOperation(),
          paymaster: "0x2222222222222222222222222222222222222222",
        },
        ENTRY_POINT,
      ],
    },
    {
      id: 1,
      jsonrpc: "2.0",
      method: "eth_sendUserOperation",
      params: [{ ...userOperation(), callGasLimit: "0x1312d01" }, ENTRY_POINT],
    },
    {
      id: 1,
      jsonrpc: "2.0",
      method: "eth_chainId",
      params: [],
      provider: "attacker",
    },
  ]) {
    assert.equal(parseProposalBundlerRequest(request), null);
  }
});

test("binds estimate and send to one canonical Governor.proposeWithPeriod execute payload", () => {
  const accepted = (callData: string) =>
    parseProposalBundlerRequest({
      id: 9,
      jsonrpc: "2.0",
      method: "eth_estimateUserOperationGas",
      params: [userOperation(callData), ENTRY_POINT],
    });
  assert.ok(accepted(executeProposal()));
  assert.equal(
    accepted(executeProposal("0x2222222222222222222222222222222222222222")),
    null
  );
  assert.equal(accepted(executeProposal(REVIEWED_GOVERNOR_ADDRESS, 1n)), null);
  assert.equal(
    accepted(executeProposal(REVIEWED_GOVERNOR_ADDRESS, 0n, "0xdeadbeef")),
    null
  );
  assert.equal(
    accepted(
      executeProposal(REVIEWED_GOVERNOR_ADDRESS, 0n, proposalCallData(), 128n)
    ),
    null
  );
  assert.equal(
    accepted(
      executeProposal(
        REVIEWED_GOVERNOR_ADDRESS,
        0n,
        proposalCallData(),
        96n,
        "00"
      )
    ),
    null
  );
  assert.equal(
    accepted(
      executeProposal(REVIEWED_GOVERNOR_ADDRESS, 0n, proposalCallData(3599n))
    ),
    null
  );
  assert.equal(
    accepted(
      executeProposal(REVIEWED_GOVERNOR_ADDRESS, 0n, proposalCallData(2592001n))
    ),
    null
  );
});

test("does not reflect upstream errors or malformed results", () => {
  const request = parseProposalBundlerRequest({
    id: "request",
    jsonrpc: "2.0",
    method: "eth_chainId",
    params: [],
  });
  assert.ok(request);
  assert.deepEqual(
    sanitizeBundlerResponse(
      { id: "request", jsonrpc: "2.0", result: "0x64" },
      request.id
    ),
    { id: "request", jsonrpc: "2.0", result: "0x64" }
  );
  assert.equal(
    sanitizeBundlerResponse(
      {
        id: "request",
        jsonrpc: "2.0",
        error: { code: -1, message: "apikey=secret" },
      },
      request.id
    ),
    null
  );
  let deeplyNested: unknown = "too deep";
  for (let depth = 0; depth < 13; depth += 1) deeplyNested = [deeplyNested];
  assert.equal(hasBoundedJsonShape(deeplyNested), false);
});

test("requires same-origin requests and applies a bounded per-session budget", () => {
  assert.equal(
    isSameOrigin(
      "https://roebel.example/api/bundler",
      "https://roebel.example"
    ),
    true
  );
  assert.equal(
    isSameOrigin(
      "https://roebel.example/api/bundler",
      "https://attacker.example"
    ),
    false
  );
  let current = 0;
  const budget = createProposalBundlerBudget(() => current);
  for (let index = 0; index < BUNDLER_REQUESTS_PER_MINUTE; index += 1) {
    assert.equal(budget.consume("approved-subject"), true);
  }
  assert.equal(budget.consume("approved-subject"), false);
  current = 60_001;
  assert.equal(budget.consume("approved-subject"), true);
});
