/**
 * `@netizen-labs/indexer` — the Netizen cross-node query layer.
 *
 * Federation gave a node two stores: its own members-only relay and a mirror of
 * its peers. This indexes both into Postgres and answers the questions that span
 * them — search, time ranges, per-author history, and "which node did this come
 * from" — which relay filters cannot do.
 *
 * See docs/STATE_OF_NOSTR.md and docs/superpowers/specs/.
 */
export { createApi, queryFromUrl } from "./api.js";
export type { ApiDeps } from "./api.js";

export { ingestAll, ingestSource } from "./ingest.js";
export type { IngestDeps, IngestResult, Source } from "./ingest.js";

export { INSERT_SQL, MAX_LIMIT, STATS_SQL, buildEventQuery, toRow } from "./query.js";
export type { BuiltQuery, EventQuery, IndexedEvent } from "./query.js";

export { SCHEMA_SQL } from "./schema.js";
