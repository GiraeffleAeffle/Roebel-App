import { createServer, type Server } from "node:http";
import type { PaymentPayload, PaymentRequirements, SettleResult, VerifyResult } from "./types.js";

export interface ServerDeps {
  network: string;
  verify: (p: PaymentPayload, r: PaymentRequirements) => Promise<VerifyResult>;
  settle: (p: PaymentPayload, r: PaymentRequirements) => Promise<SettleResult>;
}

/** Internal-only service: reachable as `facilitator:8402` on the compose
 *  network, never routed by Caddy. No auth by design — the boundary is the
 *  docker network, exactly like postgres. */
export function createFacilitatorServer(deps: ServerDeps): Server {
  return createServer(async (req, res) => {
    const send = (status: number, body: unknown) => {
      res.writeHead(status, { "content-type": "application/json" });
      res.end(JSON.stringify(body));
    };
    try {
      if (req.method === "GET" && req.url === "/supported") {
        return send(200, { kinds: [{ scheme: "exact", network: deps.network }] });
      }
      if (req.method === "POST" && (req.url === "/verify" || req.url === "/settle")) {
        const chunks: Buffer[] = [];
        for await (const chunk of req) chunks.push(chunk as Buffer);
        let body: { paymentPayload: PaymentPayload; paymentRequirements: PaymentRequirements };
        try {
          body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
        } catch {
          return send(400, { error: "malformed JSON body" });
        }
        const handler = req.url === "/verify" ? deps.verify : deps.settle;
        return send(200, await handler(body.paymentPayload, body.paymentRequirements));
      }
      send(404, { error: "not found", endpoints: ["/verify", "/settle", "/supported"] });
    } catch (error) {
      console.error("[facilitator] request failed:", error);
      send(500, { error: "internal" });
    }
  });
}
