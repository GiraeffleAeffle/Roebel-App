import { ed25519 } from "@noble/curves/ed25519";
import { utf8ToBytes, bytesToHex, hexToBytes } from "@noble/hashes/utils";
import { base64urlnopad } from "@scure/base";

import type {
  MunicipalCivicEligibilityReceiptProofInputV1,
  MunicipalCivicEligibilityReceiptV1,
} from "./civic";

const CHECKSUM = /^[0-9a-f]{64}$/u;
const RECEIPT_ID =
  /^urn:stadtstack:municipal-civic-eligibility-receipt:[0-9a-f]{64}$/u;
const KEY_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{2,127}$/u;

function exactKeys(value: Record<string, unknown>, expected: readonly string[]) {
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  return (
    actual.length === wanted.length &&
    actual.every((key, index) => key === wanted[index])
  );
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonical(record[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function validProofInput(
  input: MunicipalCivicEligibilityReceiptProofInputV1,
): boolean {
  if (
    !input ||
    typeof input !== "object" ||
    Array.isArray(input) ||
    Object.getPrototypeOf(input) !== Object.prototype ||
    !exactKeys(input as unknown as Record<string, unknown>, [
      "domain",
      "schemaVersion",
      "receiptId",
      "payloadChecksum",
      "statusRef",
    ]) ||
    input.domain !== "municipal-civic-eligibility-receipt/v1" ||
    input.schemaVersion !== "municipal_civic_eligibility_receipt_v1" ||
    !CHECKSUM.test(input.payloadChecksum) ||
    !RECEIPT_ID.test(input.receiptId) ||
    input.receiptId !==
      `urn:stadtstack:municipal-civic-eligibility-receipt:${input.payloadChecksum}`
  ) {
    return false;
  }
  try {
    const status = new URL(input.statusRef);
    return (
      status.protocol === "https:" &&
      !status.username &&
      !status.password &&
      !status.search &&
      !status.hash &&
      status.pathname.endsWith(`/${input.payloadChecksum}`)
    );
  } catch {
    return false;
  }
}

function proofBytes(input: MunicipalCivicEligibilityReceiptProofInputV1) {
  if (!validProofInput(input)) {
    throw new Error("municipal_civic_eligibility_receipt_proof_input_invalid");
  }
  return utf8ToBytes(canonical(input));
}

export function municipalCivicEligibilityReceiptProofPublicKey(
  privateKey: Uint8Array,
): string {
  if (!(privateKey instanceof Uint8Array) || privateKey.length !== 32) {
    throw new Error("municipal_civic_eligibility_issuer_private_key_invalid");
  }
  return bytesToHex(ed25519.getPublicKey(privateKey));
}

export function signMunicipalCivicEligibilityReceiptProof(
  input: MunicipalCivicEligibilityReceiptProofInputV1,
  issuer: Readonly<{ privateKey: Uint8Array; keyId: string }>,
): MunicipalCivicEligibilityReceiptV1["proof"] {
  if (
    !(issuer.privateKey instanceof Uint8Array) ||
    issuer.privateKey.length !== 32 ||
    !KEY_ID.test(issuer.keyId)
  ) {
    throw new Error("municipal_civic_eligibility_issuer_key_invalid");
  }
  return Object.freeze({
    algorithm: "Ed25519",
    keyId: issuer.keyId,
    signature: base64urlnopad.encode(
      ed25519.sign(proofBytes(input), issuer.privateKey),
    ),
  });
}

export function createMunicipalCivicEligibilityReceiptProofVerifier(
  issuer: Readonly<{ publicKey: string; keyId: string }>,
): (
  input: MunicipalCivicEligibilityReceiptProofInputV1,
  proof: MunicipalCivicEligibilityReceiptV1["proof"],
) => boolean {
  if (!/^[0-9a-f]{64}$/u.test(issuer.publicKey) || !KEY_ID.test(issuer.keyId)) {
    throw new Error("municipal_civic_eligibility_issuer_public_key_invalid");
  }
  const publicKey = hexToBytes(issuer.publicKey);
  return (input, proof) => {
    try {
      if (
        !proof ||
        typeof proof !== "object" ||
        Array.isArray(proof) ||
        Object.getPrototypeOf(proof) !== Object.prototype ||
        !exactKeys(proof as unknown as Record<string, unknown>, [
          "algorithm",
          "keyId",
          "signature",
        ]) ||
        proof.algorithm !== "Ed25519" ||
        proof.keyId !== issuer.keyId ||
        !/^[A-Za-z0-9_-]+$/u.test(proof.signature)
      ) {
        return false;
      }
      return ed25519.verify(
        base64urlnopad.decode(proof.signature),
        proofBytes(input),
        publicKey,
      );
    } catch {
      return false;
    }
  };
}
