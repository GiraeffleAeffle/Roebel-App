import { createServer, type Server } from "node:http";
import { MAX_LIMIT, STATS_SQL, buildEventQuery, type EventQuery } from "./query.js";

/**
 * The public read API.
 *
 * Read-only and unauthenticated on purpose: everything here came off world-readable
 * relays, so publishing it leaks nothing new — and it is what lets a PEER's agent
 * ask this node a question, which is the entire point of federating. Metering, when
 * it comes, wraps this rather than replacing it.
 */

export interface ApiDeps {
  query: (sql: string, values: unknown[]) => Promise<Record<string, unknown>[]>;
  nodeId: string;
  /**
   * Fetch events straight from the relays when the index has not caught up.
   *
   * The index is a DERIVED view and ingests on a timer, so an event published
   * seconds ago is legitimately absent. For a proof link — "show me exactly this
   * event" — an empty page is the wrong answer: the protocol has it, so a cache
   * miss must fall through to the source rather than deny it exists.
   */
  fetchFromRelay?: (ids: string[]) => Promise<Record<string, unknown>[]>;
}

function numbers(value: string | null): number[] | undefined {
  if (!value) return undefined;
  const parsed = value
    .split(",")
    .map((v) => Number.parseInt(v.trim(), 10))
    .filter((n) => Number.isFinite(n));
  return parsed.length ? parsed : undefined;
}

function strings(value: string | null): string[] | undefined {
  if (!value) return undefined;
  const parsed = value.split(",").map((v) => v.trim()).filter(Boolean);
  return parsed.length ? parsed : undefined;
}

function integer(value: string | null): number | undefined {
  if (!value) return undefined;
  const n = Number.parseInt(value, 10);
  return Number.isFinite(n) ? n : undefined;
}

/** Translate a URL into a query. Unparseable values are ignored rather than 400'd — a
 *  public API that rejects on a stray character is one agents route around. */
export function queryFromUrl(url: URL): EventQuery {
  const p = url.searchParams;
  return {
    ids: strings(p.get("ids")),
    q: p.get("q") ?? undefined,
    kinds: numbers(p.get("kinds")),
    authors: strings(p.get("authors")),
    since: integer(p.get("since")),
    until: integer(p.get("until")),
    node: p.get("node") ?? undefined,
    limit: integer(p.get("limit")),
  };
}

export function createApi(deps: ApiDeps): Server {
  return createServer(async (req, res) => {
    const send = (status: number, body: unknown) => {
      const json = JSON.stringify(body);
      res.writeHead(status, {
        "Content-Type": "application/json; charset=utf-8",
        // Public data, and cross-origin by design: a peer's agent runs elsewhere.
        "Access-Control-Allow-Origin": "*",
        "Cache-Control": "public, max-age=15",
      });
      res.end(json);
    };

    try {
      const url = new URL(req.url ?? "/", "http://localhost");

      if (url.pathname === "/health") return send(200, { ok: true, node: deps.nodeId });

      if (url.pathname === "/stats") {
        const rows = await deps.query(STATS_SQL, []);
        return send(200, { node: deps.nodeId, sources: rows });
      }

      if (url.pathname === "/events") {
        const query = queryFromUrl(url);
        const built = buildEventQuery(query);
        let rows = await deps.query(built.text, built.values);
        let source = "index";

        // Exact-id lookup only: a miss on a SEARCH means "no results", but a miss
        // on "show me this event" may just mean the index has not read it yet.
        if (rows.length === 0 && query.ids?.length && deps.fetchFromRelay) {
          rows = await deps.fetchFromRelay(query.ids);
          if (rows.length) source = "relay (not yet indexed)";
        }

        return send(200, {
          node: deps.nodeId,
          count: rows.length,
          maxLimit: MAX_LIMIT,
          source,
          events: rows,
        });
      }

      send(404, { error: "not found", endpoints: ["/events", "/stats", "/health"] });
    } catch (error) {
      // Never leak SQL or connection details to a public caller.
      console.error("[indexer] request failed:", error);
      send(500, { error: "query failed" });
    }
  });
}
