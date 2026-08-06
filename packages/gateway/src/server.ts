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
  /** SSE poll interval override — tests inject a small value; production default 5000ms. */
  pollMs?: number;
}

interface Paid { payer: string; settle: SettleResult; requirements: PaymentRequirements; nonce: string }

export function createGatewayServer(deps: GatewayDeps): Server {
  const { cfg } = deps;
  const mint = deps.mintToken ?? (() => randomBytes(16).toString("hex"));
  const pollMs = deps.pollMs ?? 5000;

  return createServer(async (req, res) => {
    const json = (status: number, body: unknown, headers: Record<string, string> = {}) => {
      // A prior write on this response (e.g. an /export or /firehose stream that
      // already sent headers before failing) means a second writeHead would throw
      // ERR_HTTP_HEADERS_SENT — and since this can be reached from the outer catch,
      // that throw would become an unhandled rejection that kills the process. Fail
      // safe: log and drop the connection instead of trying to reshape a response
      // that has already started.
      if (res.headersSent) {
        console.error(`[gateway] cannot send ${status} JSON — headers already sent; destroying connection`);
        res.destroy();
        return;
      }
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
        // The payer's money has already moved (settle succeeded above). A ledger
        // write failure here is an accounting problem, not a reason to withhold
        // data already paid for — log loudly for manual reconciliation and serve.
        try {
          await recordSale("/bulk/events", paid, cfg.prices.bulk, countByAuthor(rows));
        } catch (error) {
          console.error(`[gateway] RECONCILE: ledger write failed for /bulk/events, payer ${paid.payer}, tx ${paid.settle.transaction}:`, error);
        }
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
          "Cache-Control": "no-store",
          "X-PAYMENT-RESPONSE": encodePaymentResponse(paid.settle),
        });
        let counts: Map<string, number>;
        try {
          counts = await streamExport({
            query: deps.query,
            write: (line) => res.write(line + "\n"),
            kinds, excluded: deps.excluded(),
          });
        } catch (error) {
          // Headers are already sent — a truncated NDJSON body must NOT look like
          // a clean 200 (a resumed / retried read could silently miss rows), so
          // destroy the connection rather than calling res.end().
          console.error(`[gateway] /export mid-stream failure for payer ${paid.payer} — destroying connection:`, error);
          res.destroy();
          return;
        }
        res.end();
        try {
          await recordSale("/export", paid, cfg.prices.export, counts);
        } catch (error) {
          console.error(`[gateway] RECONCILE: ledger write failed for /export, payer ${paid.payer}, tx ${paid.settle.transaction}:`, error);
        }
        return;
      }

      if (url.pathname === "/firehose") {
        const pass = url.searchParams.get("pass");
        if (!pass) {
          const paid = await paywall("/firehose", cfg.prices.firehoseDay, "24h firehose pass (SSE)");
          if (!paid) return;
          try {
            const ledgerId = await recordSale("/firehose", paid, cfg.prices.firehoseDay, new Map());
            const token = mint();
            const minted = mintPassSql(token, ledgerId, 24);
            await deps.query(minted.text, minted.values);
            return json(200, { pass: token, connect: `${cfg.publicBase}/firehose?pass=${token}` },
              { "X-PAYMENT-RESPONSE": encodePaymentResponse(paid.settle) });
          } catch (error) {
            // Settlement already succeeded — the payer has proof (the tx hash) even
            // though we could not mint a durable pass for it. Surface exactly that,
            // nothing more, and log loudly so the sale can be reconciled by hand.
            console.error(`[gateway] RECONCILE: firehose pass mint failed after settle, payer ${paid.payer}, tx ${paid.settle.transaction}:`, error);
            return json(500, {
              error: "payment settled, pass creation failed — retry or contact the node operator",
              transaction: paid.settle.transaction ?? null,
            });
          }
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
          let rows: Array<Record<string, unknown> & { pubkey: string; indexed_at: string | Date }>;
          try {
            const batch = firehoseBatchQuery(watermark, deps.excluded());
            rows = (await deps.query(batch.text, batch.values)) as Array<Record<string, unknown> & { pubkey: string; indexed_at: string | Date }>;
          } catch (error) {
            // A query error mid-stream must not throw out of the handler (that
            // would hit the outer catch after headers are already sent — see the
            // json() guard above). End the stream cleanly instead; the client's
            // pass is still valid and a reconnect resumes from "now".
            console.error("[gateway] /firehose stream query failed — ending stream:", error);
            res.end();
            return;
          }
          if (rows.length) {
            for (const row of rows) {
              const { indexed_at: _drop, ...event } = row;
              res.write(`data: ${JSON.stringify(event)}\n\n`);
            }
            // pg decodes TIMESTAMPTZ to a JS Date; String(date) renders a
            // locale-formatted string ("Thu Aug 06 2026 ...") that Postgres
            // rejects as timestamptz input on the next poll. Normalise through
            // Date -> toISOString() so this works whether the driver handed back
            // a Date object or (as in tests) a plain ISO string.
            const lastIndexedAt = rows[rows.length - 1].indexed_at;
            watermark = (lastIndexedAt instanceof Date ? lastIndexedAt : new Date(lastIndexedAt)).toISOString();
            try {
              const serving = insertServingSql(ledgerId, countByAuthor(rows));
              if (serving) await deps.query(serving.text, serving.values);
            } catch (error) {
              // Accounting must never take the stream down — log and keep serving.
              console.error(`[gateway] /firehose serving_log insert failed for ledger ${ledgerId} — continuing stream:`, error);
            }
          } else {
            res.write(": keepalive\n\n");
          }
          await new Promise((r) => setTimeout(r, pollMs));
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
