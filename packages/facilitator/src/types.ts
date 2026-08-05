/**
 * Type definitions for x402 exact-scheme payments using EIP-3009 transfer authorizations.
 * These shapes follow the x402 standard so that standard clients can interoperate.
 */

export interface PaymentRequirements {
  scheme: "exact";
  network: string;
  maxAmountRequired: string;
  resource: string;
  description: string;
  mimeType: string;
  payTo: `0x${string}`;
  maxTimeoutSeconds: number;
  asset: `0x${string}`;
  extra: { name: string; version: string };
}

export interface Eip3009Authorization {
  from: `0x${string}`;
  to: `0x${string}`;
  value: string;
  validAfter: string;
  validBefore: string;
  nonce: `0x${string}`;
}

export interface ExactEvmPayload {
  signature: `0x${string}`;
  authorization: Eip3009Authorization;
}

export interface PaymentPayload {
  x402Version: 1;
  scheme: "exact";
  network: string;
  payload: ExactEvmPayload;
}

export interface VerifyResult {
  isValid: boolean;
  invalidReason?: string;
  payer?: `0x${string}`;
}

export interface SettleResult {
  success: boolean;
  errorReason?: "settle_reverted" | "network_error";
  transaction?: `0x${string}`;
  network: string;
}
