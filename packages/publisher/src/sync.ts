import {
  RelayClient,
  buildEvent,
  deriveOrgIdentity,
  type NostrEvent,
  type OrgIdentity,
} from "@netizen-labs/nostr";
import { eventToSpec, movieToSpec, orgToSpec, type PublishSpec } from "./mappers.js";

/**
 * One publish pass: public datasets → signed replaceable events on the relay.
 *
 * Stateless by design. Every pass rebuilds every publishable record; because
 * `created_at` is the row's `updated_at`, an unchanged row produces the exact
 * same event id and the relay counts it as a duplicate. No watermark to lose,
 * no publication table to drift — the relay's own replacement semantics are the
 * state. That is affordable because a town's public record is hundreds of rows,
 * not millions, and it means a wiped relay repopulates in one pass.
 *
 * Records sign under node-held organisation identities (deriveOrgIdentity), so
 * provenance is per-organisation from day one: the cinema's screenings are
 * signed by the cinema's key, an org's events by that org's key. The roster —
 * not the key — is the authority over who may cause such a publish; this
 * service only mirrors what the app already accepted as public.
 */

export type DatasetName = "events" | "cinema" | "orgs";

export interface PublisherDeps {
  nodeSecret: string;
  nodeId: string;
  datasets: DatasetName[];
  /** PostgREST read: table + query string (service key held by the caller). */
  fetchRows: (table: string, query: string) => Promise<Record<string, unknown>[]>;
  relayUrl: string;
  makeClient?: (url: string) => Pick<RelayClient, "publish" | "close">;
  /**
   * Called with every signing pubkey BEFORE anything is published. The caller
   * announces them to the allow-list here — announcing after publishing would
   * guarantee a fully-rejected first pass on every fresh node.
   */
  onPubkeys?: (pubkeys: string[]) => Promise<void>;
  log?: (message: string) => void;
}

export interface PublishSummary {
  built: number;
  accepted: number;
  duplicates: number;
  rejected: number;
  /** Every pubkey this pass signed with — the allow-list needs each of them. */
  pubkeys: string[];
}

/** Build the full spec list for one pass. Exposed for tests. */
export async function buildSpecs(
  deps: Pick<PublisherDeps, "datasets" | "fetchRows" | "nodeId">,
): Promise<PublishSpec[]> {
  const specs: PublishSpec[] = [];
  const wantsOrgs = deps.datasets.includes("orgs");
  const wantsEvents = deps.datasets.includes("events");

  // Events need the org set even when org profiles are not published: the
  // "personal accounts stay off the record" rule is enforced against it.
  let orgRows: Record<string, unknown>[] = [];
  if (wantsOrgs || wantsEvents) {
    orgRows = await deps.fetchRows(
      "accounts",
      "select=id,account_type,name,bio,avatar_url,slug,updated_at,created_at&account_type=eq.organisation",
    );
  }
  const orgIds = new Set(orgRows.map((r) => String(r.id)));

  if (wantsOrgs) {
    for (const row of orgRows) {
      const spec = orgToSpec(row, deps.nodeId);
      if (spec) specs.push(spec);
    }
  }
  if (wantsEvents) {
    const rows = await deps.fetchRows(
      "events",
      "select=id,account_id,title,description,date,time,end_time,location,formatted_address,category,image_url,website_url,ticket_price,is_cancelled,status,updated_at,created_at&status=eq.approved",
    );
    for (const row of rows) {
      const spec = eventToSpec(row, orgIds);
      if (spec) specs.push(spec);
    }
  }
  if (deps.datasets.includes("cinema")) {
    const rows = await deps.fetchRows(
      "movies",
      "select=id,title,description,date,time,fsk,cover_image_url,trailer_youtube_url,status,updated_at,created_at&status=eq.published",
    );
    for (const row of rows) {
      const spec = movieToSpec(row);
      if (spec) specs.push(spec);
    }
  }
  return specs;
}

/** Deterministically sign a spec under its scope's node-held identity. */
export function signSpec(
  spec: PublishSpec,
  identities: Map<string, OrgIdentity>,
  nodeSecret: string,
  nodeId: string,
): NostrEvent {
  let identity = identities.get(spec.scope);
  if (!identity) {
    identity = deriveOrgIdentity(nodeSecret, nodeId, spec.scope);
    identities.set(spec.scope, identity);
  }
  return buildEvent(identity.secretKey, spec.kind, spec.content, {
    createdAt: spec.createdAt,
    tags: spec.tags,
  });
}

export async function publishOnce(deps: PublisherDeps): Promise<PublishSummary> {
  const log = deps.log ?? (() => {});
  const specs = await buildSpecs(deps);

  const identities = new Map<string, OrgIdentity>();
  const events = specs.map((s) => signSpec(s, identities, deps.nodeSecret, deps.nodeId));
  const pubkeys = [...new Set(events.map((e) => e.pubkey))];
  if (deps.onPubkeys) await deps.onPubkeys(pubkeys);

  const client = deps.makeClient
    ? deps.makeClient(deps.relayUrl)
    : new RelayClient(deps.relayUrl, { timeoutMs: 15_000 });

  let accepted = 0;
  let duplicates = 0;
  let rejected = 0;
  try {
    for (const event of events) {
      const result = await client.publish(event);
      if (result.ok && /duplicate/i.test(result.message)) duplicates += 1;
      else if (result.ok) accepted += 1;
      else {
        rejected += 1;
        log(`relay rejected ${event.kind}/${event.id.slice(0, 12)}…: ${result.message}`);
      }
    }
  } finally {
    client.close();
  }

  log(`built ${specs.length}, accepted ${accepted}, duplicates ${duplicates}, rejected ${rejected}`);
  return { built: specs.length, accepted, duplicates, rejected, pubkeys };
}
