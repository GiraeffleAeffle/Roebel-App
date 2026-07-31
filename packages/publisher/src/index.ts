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
export { articleToSpec, berlinToUnix, businessToSpec, dealToSpec, eventToSpec, listingToSpec, menuToSpec, movieToSpec, newsToSpec, noticeToSpec, orgPostToSpec, orgToSpec, proposalToSpec, CINEMA_SCOPE, MARKET_SCOPE, TOWN_SCOPE, KIND_CALENDAR_TIME, KIND_CIVIC_NOTICE, KIND_LONG_FORM, KIND_MENU, KIND_PRODUCT, KIND_PROPOSAL_META } from "./mappers.js";
export type { MenuInput } from "./mappers.js";
export { htmlToMarkdown } from "./html-to-md.js";
export type { PublishSpec } from "./mappers.js";
export { buildSpecs, mirrorSpecMedia, publishOnce, signSpec } from "./sync.js";
export type { DatasetName, PublisherDeps, PublishSummary } from "./sync.js";
export { backfeedOnce, classify } from "./backfeed.js";
export type { BackfeedDeps, BackfeedSummary } from "./backfeed.js";
