/**
 * `@netizen-labs/publisher` — a node's public datasets, mirrored onto its
 * relay as signed replaceable events.
 *
 * This is the half of "the protocol is the source of truth" that CMS-shaped
 * data needs: feed posts are dual-written by the citizen's own device, but
 * events, screenings and organisation profiles are edited server-side, so the
 * node itself publishes them — each under a node-held per-organisation
 * identity, so provenance survives the trip.
 */
export { berlinToUnix, eventToSpec, movieToSpec, orgToSpec, CINEMA_SCOPE, TOWN_SCOPE, KIND_CALENDAR_TIME } from "./mappers.js";
export type { PublishSpec } from "./mappers.js";
export { buildSpecs, publishOnce, signSpec } from "./sync.js";
export type { DatasetName, PublisherDeps, PublishSummary } from "./sync.js";
