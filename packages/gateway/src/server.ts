import { createServer, type Server } from "node:http";
import { randomBytes } from "node:crypto";
import { queryFromUrl } from "@netizen-labs/indexer";
import type { PaymentRequirements, SettleResult } from "@netizen-labs/facilitator";
import type { MeteringConfig } from "./config.js";
import { body402, encodePaymentResponse, parsePayment, requirementsFor, type FacilitatorClient } from "./x402.js";
import { buildBulkQuery, decodeCursor, nextCursor, BULK_MAX_LIMIT } from "./bulk.js";
import { streamExport } from "./exportStream.js";
import { firehoseBatchQuery, mintPassSql, passLookupSql } from "./firehose.js";
import {
  STATS_ENDPOINTS_SQL, STATS_TOTALS_SQL, TOP_ACCRUALS_SQL,
  countByAuthor, insertLedgerSql, insertServingSql,
} from "./ledger.js";
import { payPageHtml } from "./pay.js";

export interface GatewayDeps {
  cfg: MeteringConfig;
  query: (sql: string, values: unknown[]) => Promise<Record<string, unknown>[]>;
  facilitator: Pick<FacilitatorClient, "verify" | "settle">;
  excluded: () => ReadonlySet<string>;
  mintToken?: () => string;
}

interface Paid { payer: string; settle: SettleResult; requirements: PaymentRequirements; nonce: string }

export function createGatewayServer(deps: GatewayDeps): Server {
  const { cfg } = deps;
  const mint = deps.mintToken ?? (() => randomBytes(16).toString("hex"));

  return createServer(async (req, res) => {
    const json = (status: number, body: unknown, headers: Record<string, string> = {}) => {
      res.writeHead(status, {
        "Content-Type": "application/json; charset=utf-8",
        "Access-Control-Allow-Origin": "*",
        "Cache-Control": "no-store",
        ...headers,
      });
      res.end(JSON.stringify(body));
    };

    /**
     * The x402 handshake. Returns payment context, or null after answering
     * the request itself (402). Fail-closed on verification; a settle
     * network_error serves anyway and marks the ledger row for
     * reconciliation (spec §8 — bounded, cent-scale risk).
     */
    const paywall = async (path: string, price: string, description: string): Promise<Paid | null> => {
      const requirements = requirementsFor(cfg, path, price, description);
      const header = req.headers["x-payment"];
      if (typeof header !== "string") {
        json(402, body402(cfg, path, price, description));
        return null;
      }
      const payment = parsePayment(header);
      if (!payment) {
        json(402, body402(cfg, path, price, description, "malformed X-PAYMENT header"));
        return null;
      }
      const verdict = await deps.facilitator.verify(payment, requirements);
      if (!verdict.isValid) {
        json(402, body402(cfg, path, price, description, `payment invalid: ${verdict.invalidReason}`));
        return null;
      }
      const settle = await deps.facilitator.settle(payment, requirements);
      if (!settle.success && settle.errorReason !== "network_error") {
        json(402, body402(cfg, path, price, description, "settlement reverted — payment not accepted"));
        return null;
      }
      if (!settle.success) console.error(`[gateway] RECONCILE: settle network_error for ${path}, payer ${verdict.payer}`);
      return { payer: verdict.payer ?? payment.payload.authorization.from, settle, requirements, nonce: payment.payload.authorization.nonce };
    };

    const recordSale = async (endpoint: string, paid: Paid, price: string, counts: Map<string, number>): Promise<number> => {
      const ledger = insertLedgerSql({
        endpoint, payer: paid.payer, amount: price, asset: cfg.asset, network: cfg.network,
        splitAuthors: cfg.splitAuthors, tx: paid.settle.transaction ?? null, nonce: paid.nonce,
        reconcile: !paid.settle.success,
      });
      const [row] = await deps.query(ledger.text, ledger.values);
      const id = Number(row.id);
      const serving = insertServingSql(id, counts);
      if (serving) await deps.query(serving.text, serving.values);
      return id;
    };

    try {
      const url = new URL(req.url ?? "/", "http://localhost");

      if (url.pathname === "/health") return json(200, { ok: true, node: cfg.nodeId });

      if (url.pathname === "/bulk/events") {
        const paid = await paywall("/bulk/events", cfg.prices.bulk, `bulk event query, up to ${BULK_MAX_LIMIT} events`);
        if (!paid) return;
        const query = queryFromUrl(url);
        const cursor = decodeCursor(url.searchParams.get("cursor"));
        const built = buildBulkQuery(query, cursor, deps.excluded());
        const rows = (await deps.query(built.text, built.values)) as Array<Record<string, unknown> & { pubkey: string; created_at: number; id: string }>;
        await recordSale("/bulk/events", paid, cfg.prices.bulk, countByAuthor(rows));
        const limit = Math.min(Math.max(1, query.limit ?? 1000), BULK_MAX_LIMIT);
        return json(200, { node: cfg.nodeId, count: rows.length, nextCursor: nextCursor(rows, limit), events: rows },
          { "X-PAYMENT-RESPONSE": encodePaymentResponse(paid.settle) });
      }

      if (url.pathname === "/export") {
        const paid = await paywall("/export", cfg.prices.export, "full-history NDJSON export");
        if (!paid) return;
        const kinds = url.searchParams.get("kinds")?.split(",").map(Number).filter(Number.isFinite);
        res.writeHead(200, {
          "Content-Type": "application/x-ndjson; charset=utf-8",
          "Access-Control-Allow-Origin": "*",
          "X-PAYMENT-RESPONSE": encodePaymentResponse(paid.settle),
        });
        const counts = await streamExport({
          query: deps.query,
          write: (line) => res.write(line + "\n"),
          kinds, excluded: deps.excluded(),
        });
        res.end();
        await recordSale("/export", paid, cfg.prices.export, counts);
        return;
      }

      if (url.pathname === "/firehose") {
        const pass = url.searchParams.get("pass");
        if (!pass) {
          const paid = await paywall("/firehose", cfg.prices.firehoseDay, "24h firehose pass (SSE)");
          if (!paid) return;
          const ledgerId = await recordSale("/firehose", paid, cfg.prices.firehoseDay, new Map());
          const token = mint();
          const minted = mintPassSql(token, ledgerId, 24);
          await deps.query(minted.text, minted.values);
          return json(200, { pass: token, connect: `${cfg.publicBase}/firehose?pass=${token}` },
            { "X-PAYMENT-RESPONSE": encodePaymentResponse(paid.settle) });
        }
        const lookup = passLookupSql(pass);
        const found = await deps.query(lookup.text, lookup.values);
        if (!found.length) return json(401, { error: "invalid or expired pass — buy a new one at /firehose" });
        const ledgerId = Number(found[0].ledger_id);
        res.writeHead(200, {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-store",
          "Access-Control-Allow-Origin": "*",
          Connection: "keep-alive",
        });
        let watermark = new Date().toISOString();
        let open = true;
        req.on("close", () => { open = false; });
        while (open) {
          const batch = firehoseBatchQuery(watermark, deps.excluded());
          const rows = (await deps.query(batch.text, batch.values)) as Array<Record<string, unknown> & { pubkey: string; indexed_at: string }>;
          if (rows.length) {
            for (const row of rows) {
              const { indexed_at: _drop, ...event } = row;
              res.write(`data: ${JSON.stringify(event)}\n\n`);
            }
            watermark = String(rows[rows.length - 1].indexed_at);
            const serving = insertServingSql(ledgerId, countByAuthor(rows));
            if (serving) await deps.query(serving.text, serving.values);
          } else {
            res.write(": keepalive\n\n");
          }
          await new Promise((r) => setTimeout(r, 5000));
        }
        return;
      }

      if (url.pathname === "/pay") {
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Access-Control-Allow-Origin": "*", "Cache-Control": "public, max-age=300" });
        res.end(payPageHtml(cfg));
        return;
      }

      if (url.pathname === "/metering/stats") {
        const [totals] = await deps.query(STATS_TOTALS_SQL, []);
        const endpoints = await deps.query(STATS_ENDPOINTS_SQL, []);
        const accruals = await deps.query(TOP_ACCRUALS_SQL, []);
        return json(200, {
          node: cfg.nodeId,
          asset: { address: cfg.asset, name: cfg.assetName, decimals: cfg.assetDecimals, network: cfg.network },
          split: { authors: cfg.splitAuthors, treasury: 100 - cfg.splitAuthors },
          totals: { requests: Number(totals?.requests ?? 0), revenueAtomic: String(totals?.revenue_atomic ?? "0") },
          byEndpoint: endpoints,
          // Authors are hex pubkeys — display-name resolution is slice 2.
          topAccruals: accruals,
        }, { "Cache-Control": "public, max-age=60" });
      }

      json(404, { error: "not found", endpoints: ["/bulk/events", "/export", "/firehose", "/pay", "/metering/stats"] });
    } catch (error) {
      console.error("[gateway] request failed:", error);
      json(500, { error: "request failed" });
    }
  });
}
