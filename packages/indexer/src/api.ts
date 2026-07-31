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
  /** The node's public manifest as a JSON string, when one is mounted. */
  manifest?: () => string;
  /** Read a content-addressed media file by its sha256 hex, when a media dir is mounted. */
  readMedia?: (sha256: string) => Promise<{ bytes: Uint8Array; contentType: string } | null>;
}

/**
 * Postgres BIGINT arrives as a STRING through `pg` — it can exceed JavaScript's
 * safe integer range, so the driver refuses to guess. Unix seconds never will, so
 * coercing here is safe and stops the same event having two shapes depending on
 * whether it was served from the index or from the relay fallback.
 *
 * A consumer should never have to ask where a row came from to know its types.
 */
function normaliseRow(row: Record<string, unknown>): Record<string, unknown> {
  const out = { ...row };
  for (const field of ["created_at", "kind", "count", "newest"]) {
    const value = out[field];
    if (typeof value === "string" && /^-?\d+$/.test(value)) out[field] = Number(value);
  }
  return out;
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
    eTags: strings(p.get("e")),
    pTags: strings(p.get("p")),
    dTags: strings(p.get("d")),
  };
}

export { normaliseRow };

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

      // The root is the front door of the open-data claim. A browser landing
      // here should learn what this is and how to query it — "not found" reads
      // as a broken service to exactly the person we want to convince.
      if (url.pathname === "/") {
        res.writeHead(200, {
          "Content-Type": "text/html; charset=utf-8",
          "Access-Control-Allow-Origin": "*",
          "Cache-Control": "public, max-age=300",
        });
        res.end(`<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Netizen index — ${deps.nodeId}</title>
<style>body{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;max-width:44rem;margin:3rem auto;padding:0 1rem;line-height:1.6;background:#111;color:#ddd}a{color:#7ABBF2}code{background:#222;padding:.1rem .35rem;border-radius:4px}h1{font-size:1.3rem}</style>
</head><body>
<h1>Public index of the "${deps.nodeId}" Netizen node</h1>
<p>This node's public record — signed Nostr events, queryable by anyone.
No API key, no account. Every event carries its author's signature, so
everything served here is verifiable, not just asserted.</p>
<p>Endpoints:</p>
<ul>
<li><a href="/stats">/stats</a> — what this index holds, by node and kind</li>
<li><a href="/events?limit=10">/events</a> — query by <code>kinds</code>, <code>authors</code>, <code>ids</code>, <code>since</code>, <code>until</code>, <code>node</code>, <code>q</code> (full-text), <code>limit</code></li>
<li><a href="/manifest">/manifest</a> — the node's public manifest: chain id, contract addresses, relays, peers</li>
<li><code>/media/&lt;sha256&gt;</code> — content-addressed images (the hash in the URL is the integrity check)</li>
<li><a href="/health">/health</a></li>
</ul>
<p>The record, by kind:</p>
<ul>
<li><a href="/events?kinds=0&amp;limit=50">0</a> — profiles: citizens, agents (<code>bot:true</code>), organisations (<code>netizen_org</code> tag; name, about, picture, banner, category, opening_hours, slug)</li>
<li><a href="/events?kinds=1&amp;limit=20">1</a> — public feed posts &amp; replies, signed on the citizen's own device</li>
<li><a href="/events?kinds=5&amp;limit=10">5</a> / <a href="/events?kinds=6&amp;limit=10">6</a> / <a href="/events?kinds=7&amp;limit=10">7</a> — deletions (honoured), reposts, reactions</li>
<li><a href="/events?kinds=31923&amp;limit=10">31923</a> — calendar: town events &amp; cinema programme (NIP-52; <code>d</code>=<code>event:&lt;id&gt;</code>/<code>movie:&lt;id&gt;</code>, title/start/end/location/image/status tags)</li>
<li><a href="/events?kinds=30023&amp;limit=10">30023</a> — long-form articles (NIP-23, Markdown; <code>ai_generated</code> tag where it applies)</li>
<li><a href="/events?kinds=30018&amp;limit=10">30018</a> — marketplace listings (NIP-15; withdrawn = content-free tombstone with <code>status:withdrawn</code>)</li>
</ul>
<p>Also: <a href="/events?q=Hafen">full-text search</a>. Editable records are NIP-01
replaceable events — the index serves only the current version, honours NIP-09 deletions,
and re-verifies every signature on ingest. Provenance rides on every row
(<code>node_id</code>, <code>source</code>).</p>
<p>Built on the <a href="https://github.com/Roebel-Labs/Roebel-App">Röbel App</a> / Netizen stack.</p>
</body></html>`);
        return;
      }

      if (url.pathname === "/health") return send(200, { ok: true, node: deps.nodeId });

      // The node's public manifest: chain id, contract addresses, relays, peers.
      // This is how an Atlas discovers the on-chain half of the record —
      // governance and currency are already open on Gnosis, and the manifest is
      // the address book that makes them findable without asking anyone.
      if (url.pathname === "/manifest" && deps.manifest) {
        res.writeHead(200, {
          "Content-Type": "application/json; charset=utf-8",
          "Access-Control-Allow-Origin": "*",
          "Cache-Control": "public, max-age=300",
        });
        res.end(deps.manifest());
        return;
      }

      // Content-addressed media: GET /media/<sha256>[.ext]. The hash IS the
      // authentication — any mirror serving the same bytes serves the same URL
      // path, which is what makes the record's images survivable beyond this
      // node (Blossom-compatible reads, BUD-01 shape).
      const mediaMatch = url.pathname.match(/^\/media\/([0-9a-f]{64})(?:\.[a-z0-9]+)?$/);
      if (mediaMatch && deps.readMedia) {
        const file = await deps.readMedia(mediaMatch[1]);
        if (!file) return send(404, { error: "no such media" });
        res.writeHead(200, {
          "Content-Type": file.contentType,
          "Access-Control-Allow-Origin": "*",
          // Content-addressed => immutable forever.
          "Cache-Control": "public, max-age=31536000, immutable",
        });
        res.end(file.bytes);
        return;
      }

      if (url.pathname === "/stats") {
        const rows = await deps.query(STATS_SQL, []);
        return send(200, { node: deps.nodeId, sources: rows.map(normaliseRow) });
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
          events: rows.map(normaliseRow),
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
