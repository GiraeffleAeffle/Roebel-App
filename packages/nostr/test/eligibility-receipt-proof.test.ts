import assert from "node:assert/strict";
import { test } from "node:test";

import {
  createMunicipalCivicEligibilityReceiptProofVerifier,
  createMunicipalCivicEligibilityStatusProofVerifier,
  municipalCivicEligibilityReceiptProofPublicKey,
  signMunicipalCivicEligibilityReceiptProof,
  signMunicipalCivicEligibilityStatusProof,
  type MunicipalCivicEligibilityReceiptProofInputV1,
  type MunicipalCivicEligibilityStatusProofInputV1,
} from "../src/index";

test("an Ed25519 municipal issuer signs only the canonical closed receipt proof input", () => {
  const privateKey = new Uint8Array(32).fill(7);
  const keyId = "roebel-staging-eligibility-issuer-2026-09";
  const proofInput: MunicipalCivicEligibilityReceiptProofInputV1 = {
    domain: "municipal-civic-eligibility-receipt/v1",
    schemaVersion: "municipal_civic_eligibility_receipt_v1",
    receiptId: `urn:stadtstack:municipal-civic-eligibility-receipt:${"a".repeat(64)}`,
    payloadChecksum: "a".repeat(64),
    statusRef: `https://roebel-web.staging.agentcart.eu/api/civic/v1/eligibility/status/${"a".repeat(64)}`,
  };

  const proof = signMunicipalCivicEligibilityReceiptProof(proofInput, {
    privateKey,
    keyId,
  });
  const verify = createMunicipalCivicEligibilityReceiptProofVerifier({
    publicKey: municipalCivicEligibilityReceiptProofPublicKey(privateKey),
    keyId,
  });

  assert.deepEqual(Object.keys(proof).sort(), ["algorithm", "keyId", "signature"]);
  assert.equal(proof.algorithm, "Ed25519");
  assert.equal(verify(proofInput, proof), true);
  assert.equal(
    verify({ ...proofInput, payloadChecksum: "b".repeat(64) }, proof),
    false,
  );
  assert.equal(verify(proofInput, { ...proof, keyId: `${keyId}-other` }), false);
});

test("status proofs use a separate closed signing domain and reject altered or extended proofs", () => {
  const issuer = { privateKey: new Uint8Array(32).fill(7), keyId: "synthetic-status-issuer" };
  const input: MunicipalCivicEligibilityStatusProofInputV1 = {
    domain: "municipal-civic-eligibility-status/v1",
    schemaVersion: "municipal_civic_eligibility_status_v1",
    statusChecksum: "a".repeat(64),
  };
  const proof = signMunicipalCivicEligibilityStatusProof(input, issuer);
  const verify = createMunicipalCivicEligibilityStatusProofVerifier({
    publicKey: municipalCivicEligibilityReceiptProofPublicKey(issuer.privateKey), keyId: issuer.keyId,
  });
  assert.equal(verify(input, proof), true);
  for (const changed of [
    { ...input, statusChecksum: "b".repeat(64) },
    { ...input, domain: "municipal-civic-eligibility-receipt/v1" },
    { ...input, walletAddress: "private" },
  ]) assert.equal(verify(changed as never, proof), false);
  for (const changed of [
    { ...proof, algorithm: "unknown" },
    { ...proof, keyId: "another-issuer" },
    { ...proof, signature: `${proof.signature}=` },
    { ...proof, signature: "a".repeat(86) },
    { ...proof, extra: true },
  ]) assert.equal(verify(input, changed), false);
  assert.throws(() => signMunicipalCivicEligibilityStatusProof({ ...input, extra: true } as never, issuer));
  const receiptInput: MunicipalCivicEligibilityReceiptProofInputV1 = {
    domain: "municipal-civic-eligibility-receipt/v1",
    schemaVersion: "municipal_civic_eligibility_receipt_v1",
    receiptId: `urn:stadtstack:municipal-civic-eligibility-receipt:${input.statusChecksum}`,
    payloadChecksum: input.statusChecksum,
    statusRef: `https://city.example/eligibility/status/${input.statusChecksum}`,
  };
  assert.equal(verify(input, signMunicipalCivicEligibilityReceiptProof(receiptInput, issuer)), false);
});
