import type { PaymentPayload, PaymentRequirements, SettleResult, VerifyResult } from "@netizen-labs/facilitator";
import type { MeteringConfig } from "./config.js";

export function requirementsFor(
  cfg: MeteringConfig, path: string, price: string, description: string,
): PaymentRequirements {
  return {
    scheme: "exact",
    network: cfg.network,
    maxAmountRequired: price,
    resource: `${cfg.publicBase}${path}`,
    description,
    mimeType: "application/json",
    payTo: cfg.payTo,
    maxTimeoutSeconds: 60,
    asset: cfg.asset,
    extra: { name: cfg.assetName, version: cfg.assetVersion },
  };
}

export function body402(
  cfg: MeteringConfig, path: string, price: string, description: string, error = "payment required",
) {
  return {
    x402Version: 1,
    error,
    accepts: [requirementsFor(cfg, path, price, description)],
    /** Not part of x402 — a human landing here needs a way in too (spec P2). */
    payLink: `${cfg.publicBase}/pay`,
  };
}

export function parsePayment(header: string): PaymentPayload | null {
  try {
    const parsed = JSON.parse(Buffer.from(header, "base64").toString("utf8")) as PaymentPayload;
    if (parsed?.scheme !== "exact" || !parsed.payload?.authorization?.from) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function encodePaymentResponse(result: SettleResult): string {
  return Buffer.from(JSON.stringify(result)).toString("base64");
}

export class FacilitatorClient {
  constructor(
    private readonly baseUrl: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  private async post<T>(path: string, paymentPayload: PaymentPayload, paymentRequirements: PaymentRequirements): Promise<T> {
    const res = await this.fetchImpl(`${this.baseUrl}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ paymentPayload, paymentRequirements }),
    });
    if (!res.ok) throw new Error(`facilitator ${path} -> ${res.status}`);
    return (await res.json()) as T;
  }

  verify(p: PaymentPayload, r: PaymentRequirements): Promise<VerifyResult> {
    return this.post("/verify", p, r);
  }
  settle(p: PaymentPayload, r: PaymentRequirements): Promise<SettleResult> {
    return this.post("/settle", p, r);
  }
}
