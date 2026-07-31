import {
  RelayClient,
  buildEvent,
  deriveOrgIdentity,
  type NostrEvent,
  type OrgIdentity,
} from "@netizen-labs/nostr";
import { htmlToMarkdown } from "./html-to-md.js";
import {
  articleToSpec,
  businessToSpec,
  dealToSpec,
  eventToSpec,
  listingToSpec,
  movieToSpec,
  newsToSpec,
  noticeToSpec,
  orgPostToSpec,
  orgToSpec,
  type PublishSpec,
} from "./mappers.js";

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

export type DatasetName =
  | "events" | "cinema" | "orgs" | "articles" | "marketplace" | "deals"
  | "news" | "businesses" | "notices" | "menus" | "proposals";

export interface PublisherDeps {
  nodeSecret: string;
  nodeId: string;
  datasets: DatasetName[];
  /** PostgREST read: table + query string (service key held by the caller). */
  fetchRows: (table: string, query: string) => Promise<Record<string, unknown>[]>;
  relayUrl: string;
  makeClient?: (url: string) => Pick<RelayClient, "publish" | "close">;
  /**
   * Mirror an image onto the node, content-addressed. Returns the public URL
   * to substitute, or null to keep the original (a failed mirror must degrade
   * to the centralized URL, not to a broken record).
   */
  mirrorMedia?: (url: string) => Promise<string | null>;
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
      "select=id,account_type,name,bio,avatar_url,cover_url,sub_type,opening_hours,slug,updated_at,created_at&account_type=eq.organisation",
    );
  }
  const orgIds = new Set(orgRows.map((r) => String(r.id)));

  // Consent lookup: wallet -> npub bindings joined with account ownership, so a
  // PERSONAL account's content publishes exactly when its owner accepted the
  // public record. One fetch, shared by events and marketplace.
  const wantsConsented = wantsEvents || deps.datasets.includes("marketplace");
  let optedWallets = new Map<string, string>();
  let ownerPubkeyByAccount = new Map<string, string>();
  if (wantsConsented) {
    const bindings = await deps.fetchRows(
      "nostr_identities",
      "select=wallet_address,pubkey_hex,revoked_at&revoked_at=is.null",
    );
    optedWallets = new Map(
      bindings
        .filter((b) => typeof b.wallet_address === "string" && typeof b.pubkey_hex === "string")
        .map((b) => [String(b.wallet_address).toLowerCase(), String(b.pubkey_hex)]),
    );
    const owners = await deps.fetchRows(
      "account_owners",
      "select=account_id,wallet_address",
    );
    for (const o of owners) {
      const pk = optedWallets.get(String(o.wallet_address ?? "").toLowerCase());
      if (pk && o.account_id) ownerPubkeyByAccount.set(String(o.account_id), pk);
    }
  }

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
      const spec = eventToSpec(row, orgIds, ownerPubkeyByAccount);
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
  if (wantsOrgs && orgIds.size) {
    // Feed posts by organisation accounts, signed by each org's own key. The
    // citizen device never signs these — a person's key on an organisation's
    // words would be false attribution.
    const rows = await deps.fetchRows(
      "posts",
      `select=id,account_id,content,media_urls,status,created_at&feed_type=eq.main&status=eq.published&account_id=in.(${[...orgIds].join(",")})`,
    );
    for (const row of rows) {
      const spec = orgPostToSpec(row, orgIds);
      if (spec) specs.push(spec);
    }
  }
  if (deps.datasets.includes("articles")) {
    const rows = await deps.fetchRows(
      "blog_articles",
      "select=id,account_id,title,excerpt,content,cover_image_url,category,tags,status,published_at,ai_generated,updated_at,created_at&status=eq.published",
    );
    for (const row of rows) {
      const spec = articleToSpec(row, orgIds, htmlToMarkdown);
      if (spec) specs.push(spec);
    }
  }
  if (deps.datasets.includes("news")) {
    const rows = await deps.fetchRows(
      "news_articles",
      "select=id,slug,title,excerpt,content,cover_image_url,category,published_at,status,updated_at,created_at&status=eq.published",
    );
    for (const row of rows) {
      const spec = newsToSpec(row, htmlToMarkdown);
      if (spec) specs.push(spec);
    }
  }
  if (deps.datasets.includes("marketplace")) {
    const rows = await deps.fetchRows(
      "marketplace_listings",
      "select=id,account_id,title,description,price,price_type,category,condition,media_urls,neighborhood,listing_type,seller_wallet_address,status,updated_at,created_at",
    );
    for (const row of rows) {
      const spec = listingToSpec(row, orgIds, optedWallets);
      if (spec) specs.push(spec);
    }
  }
  const wantsDeals = deps.datasets.includes("deals");
  const wantsBusinesses = deps.datasets.includes("businesses");
  if (wantsDeals || wantsBusinesses) {
    const businesses = await deps.fetchRows(
      "businesses",
      "select=id,name,slug,description,category,logo_url,cover_image_url,address,opening_hours,website_url,status,updated_at,created_at&status=eq.published",
    );
    if (wantsBusinesses) {
      for (const row of businesses) {
        const spec = businessToSpec(row, deps.nodeId);
        if (spec) specs.push(spec);
      }
    }
    if (wantsDeals) {
      const nameById = new Map(
        businesses.filter((b) => b.id && typeof b.name === "string").map((b) => [String(b.id), String(b.name)]),
      );
      const rows = await deps.fetchRows(
        "business_deals",
        "select=id,business_id,title,description,deal_type,deal_value,image_url,media_urls,start_date,end_date,status,is_active,updated_at,created_at&status=eq.active&is_active=eq.true",
      );
      for (const row of rows) {
        const spec = dealToSpec(row, nameById);
        if (spec) specs.push(spec);
      }
    }
  }
  if (deps.datasets.includes("notices")) {
    const alerts = await deps.fetchRows(
      "service_alerts",
      "select=id,title,description,severity,status,updated_at,created_at",
    );
    for (const row of alerts) {
      const spec = noticeToSpec(row, "service_alert");
      if (spec) specs.push(spec);
    }
    const announcements = await deps.fetchRows(
      "announcements",
      "select=id,title,content,is_active,updated_at,created_at",
    );
    for (const row of announcements) {
      const spec = noticeToSpec(row, "announcement");
      if (spec) specs.push(spec);
    }
  }
  return specs;
}

/**
 * Swap image tags for node-mirrored, content-addressed URLs.
 *
 * Applied before signing so the substitution is part of the signed record: a
 * reader verifying the event verifies the mirrored URL. The hash in the URL is
 * the integrity check — any mirror serving those bytes serves that path.
 */
export async function mirrorSpecMedia(
  specs: PublishSpec[],
  mirror: (url: string) => Promise<string | null>,
): Promise<void> {
  const cache = new Map<string, string | null>();
  const mirrorUrl = async (url: string): Promise<string | null> => {
    if (!cache.has(url)) cache.set(url, await mirror(url));
    return cache.get(url) ?? null;
  };
  for (const spec of specs) {
    let rewritten = false;
    for (const tag of spec.tags) {
      if (tag[0] !== "image" || !tag[1]) continue;
      const mirrored = await mirrorUrl(tag[1]);
      if (mirrored && mirrored !== tag[1]) {
        tag[1] = mirrored;
        rewritten = true;
      }
    }
    // Profile images live INSIDE the kind 0 content JSON, not in tags.
    if (spec.kind === 0) {
      try {
        const profile = JSON.parse(spec.content) as Record<string, unknown>;
        for (const field of ["picture", "banner"]) {
          const url = profile[field];
          if (typeof url !== "string" || !url) continue;
          const mirrored = await mirrorUrl(url);
          if (mirrored && mirrored !== url) {
            profile[field] = mirrored;
            rewritten = true;
          }
        }
        if (rewritten) spec.content = JSON.stringify(profile);
      } catch {
        // not JSON — leave it alone
      }
    }
    // A rewritten URL IS a new version of the record. Without this bump the
    // mirrored event ties with the unmirrored one already on the relay at the
    // same created_at, and NIP-01's id tie-break picks a winner at random.
    // +1 is constant, so passes stay idempotent.
    if (rewritten) spec.createdAt += 1;
  }
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
  if (deps.mirrorMedia) await mirrorSpecMedia(specs, deps.mirrorMedia);

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
