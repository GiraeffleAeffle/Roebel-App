import { test } from "node:test";
import assert from "node:assert/strict";
import {
  businessToSpec, dealToSpec, listingToSpec, menuToSpec, noticeToSpec, orgToSpec, proposalToSpec,
} from "@netizen-labs/publisher";
import { deriveOrgIdentity } from "@netizen-labs/nostr";
import { RecordClient } from "../src/index";
import { getMenu, getMenuBySlug, listDeals, listListings, listNotices, listProposals } from "../src/civic";
import { asRecordEvent } from "./helpers";

const clientFor = (events: unknown[]) =>
  new RecordClient("https://i", (async () => new Response(JSON.stringify({ events }))) as unknown as typeof fetch);

// --- listings (kind 30018, NIP-15) ---

test("withdrawn listings are absent", async () => {
  // listingToSpec fixture with status sold → tombstone → filtered
  const row = {
    id: "l1", account_id: "acc-verein", title: "Fahrrad", description: "Gut erhalten", price: "50",
    status: "sold", updated_at: "2026-07-02T10:00:00Z",
  };
  const spec = listingToSpec(row, new Set(["acc-verein"]), new Map())!;
  // The tombstone still needs a title-less content-free event to exist at all.
  assert.equal(spec.content, "");
  const listings = await listListings(clientFor([asRecordEvent(spec)]));
  assert.equal(listings.length, 0);
});

test("round-trip parity: an org-owned active listing joins back to its org by pubkey", async () => {
  const nodeSecret = "s".repeat(32);
  const nodeId = "roebel";
  const accountId = "acc-verein";
  const orgRow = {
    id: accountId, account_type: "organisation", name: "Kleingartenverein",
    slug: "kgv", updated_at: "2026-07-02T10:00:00Z",
  };
  const listingRow = {
    id: "l2", account_id: accountId, title: "Schubkarre", description: "Kaum genutzt",
    price: "15", category: "garten", condition: "gebraucht", media_urls: ["https://x/1.jpg"],
    neighborhood: "Seeblick", status: "active", listing_type: "service", updated_at: "2026-07-02T10:00:00Z",
  };
  const orgSpec = orgToSpec(orgRow, nodeId)!;
  const listingSpec = listingToSpec(listingRow, new Set([accountId]), new Map())!;
  assert.equal(orgSpec.scope, listingSpec.scope, "an org's listing and its own profile must share a signing scope");
  const identity = deriveOrgIdentity(nodeSecret, nodeId, listingSpec.scope);

  const [listing] = await listListings(clientFor([asRecordEvent(listingSpec, identity.publicKey)]));
  assert.equal(listing.title, "Schubkarre");
  assert.equal(listing.description, "Kaum genutzt");
  assert.equal(listing.price, "15");
  assert.equal(listing.category, "garten");
  assert.equal(listing.condition, "gebraucht");
  // listingToSpec publishes listing_type as content.type, not a tag — on the
  // wire alongside description/price/condition, previously unread.
  assert.equal(listing.listing_type, "service");
  assert.deepEqual(listing.media_urls, ["https://x/1.jpg"]);
  assert.equal(listing.location, "Seeblick");
  assert.equal(listing.status, "active");
  // listingToSpec sets createdAt = unixFromUpdatedAt(row) on the event
  // envelope — recovered here instead of round-tripping to "" (which used
  // to render as "Invalid Date" on the marketplace detail page).
  assert.equal(listing.created_at, new Date(listingSpec.createdAt * 1000).toISOString());
  // Org listings carry no seller "p" tag (listingToSpec only attributes personal sellers) —
  // pubkey is the only join signal for the org case, same rule as events/articles.
  assert.equal(listing.seller_npub, null);
  assert.equal(listing.pubkey, identity.publicKey);
});

// --- deals (kind 30402, NIP-99) ---

test("round-trip parity: a deal's pubkey joins to that business's own profile pubkey; business_id itself never round-trips", async () => {
  const nodeSecret = "s".repeat(32);
  const nodeId = "roebel";
  const businessId = "biz-baeckerei";
  const businessRow = {
    id: businessId, name: "Bäckerei Sonnenschein", status: "published", updated_at: "2026-07-02T10:00:00Z",
  };
  const dealRow = {
    id: "d1", business_id: businessId, title: "20% auf Brot", description: "Nur heute",
    deal_type: "rabatt", deal_value: "20%", image_url: "https://x/brot.jpg",
    start_date: "2026-08-01", end_date: "2026-08-31",
    status: "active", is_active: true, updated_at: "2026-07-02T10:00:00Z",
  };
  const businessSpec = businessToSpec(businessRow, nodeId)!;
  const dealSpec = dealToSpec(dealRow, new Map([[businessId, "Bäckerei Sonnenschein"]]), new Set([businessId]))!;
  assert.equal(businessSpec.scope, dealSpec.scope, "a business's deal and its own profile must share a signing scope");
  const identity = deriveOrgIdentity(nodeSecret, nodeId, dealSpec.scope);

  const [deal] = await listDeals(clientFor([asRecordEvent(dealSpec, identity.publicKey)]));
  assert.equal(deal.title, "20% auf Brot");
  assert.equal(deal.description, "Nur heute");
  assert.equal(deal.deal_type, "rabatt");
  assert.equal(deal.deal_value, "20%");
  assert.equal(deal.image_url, "https://x/brot.jpg");
  assert.equal(deal.start_date, "2026-08-01");
  assert.equal(deal.end_date, "2026-08-31");
  assert.equal(deal.business_name, "Bäckerei Sonnenschein");
  // dealToSpec never publishes the raw Supabase business_id anywhere on the
  // wire — only the derived biz-<id> signing scope encodes it, and scope
  // derivation is one-way. pubkey is the recoverable join key instead.
  assert.equal(deal.business_id, null);
  assert.equal(deal.pubkey, identity.publicKey);
});

// --- menus (kind 32101, custom) ---

test("round-trip parity: getMenu and getMenuBySlug resolve the same menu, categories and items intact", async () => {
  const restaurant = {
    id: "r1", name: "Ratskeller", slug: "ratskeller", address: "Marktplatz 1",
    logo_url: "https://x/logo.png", status: "approved", updated_at: "2026-07-02T10:00:00Z",
  };
  const categories = [{ id: "c1", name: "Hauptgerichte", sort_order: 1, is_active: true }];
  const itemsByCategory = new Map([
    ["c1", [{ name: "Schnitzel", description: "mit Pommes", price: "12.50", is_available: true }]],
  ]);
  const spec = menuToSpec({ restaurant, categories, itemsByCategory }, new Set())!;
  const pubkey = "a".repeat(64);
  const record = asRecordEvent(spec, pubkey);

  const byId = await getMenu(clientFor([record]), "r1");
  assert.equal(byId?.restaurantId, "r1");
  assert.equal(byId?.name, "Ratskeller");
  assert.equal(byId?.slug, "ratskeller");
  assert.equal(byId?.location, "Marktplatz 1");
  assert.equal(byId?.image, "https://x/logo.png");
  assert.equal(byId?.categories.length, 1);
  assert.equal(byId?.categories[0].name, "Hauptgerichte");
  assert.equal(byId?.categories[0].items[0].name, "Schnitzel");
  assert.equal(byId?.categories[0].items[0].description, "mit Pommes");
  assert.equal(byId?.categories[0].items[0].price, "12.50");
  assert.equal(byId?.categories[0].items[0].currency, "EUR");
  assert.equal(byId?.pubkey, pubkey);

  const bySlug = await getMenuBySlug(clientFor([record]), "ratskeller");
  assert.equal(bySlug?.restaurantId, "r1");
  assert.equal(await getMenuBySlug(clientFor([record]), "nope"), null);
  assert.equal(await getMenu(clientFor([record]), "no-such-id"), null);
});

test("getMenu returns null for malformed menu content instead of throwing", async () => {
  const restaurant = { id: "r2", name: "Imbiss", status: "approved", updated_at: "2026-07-02T10:00:00Z" };
  const spec = menuToSpec({ restaurant, categories: [], itemsByCategory: new Map() }, new Set())!;
  const broken = { ...asRecordEvent(spec), content: "{not json" };
  assert.equal(await getMenu(clientFor([broken]), "r2"), null);
});

// --- proposals (kind 32100, custom pointer) ---

test("round-trip parity: proposal_id is the record's own d-tag id, onchain_id is the distinct chain pointer", async () => {
  const row = {
    proposal_id: "p1", title: "Neuer Spielplatz", summary: "Ein Spielplatz für den Hafen.",
    category: "Infrastruktur", blockchain_proposal_id: "42", irys_content_id: "irys-abc",
    state: "active", created_at: "2026-07-01T09:00:00Z", updated_at: "2026-07-02T10:00:00Z",
  };
  const spec = proposalToSpec(row, "100:0x5F5e499Dc1872c2Ce19a4b50cd10f680e78E3Ba3")!;
  const [proposal] = await listProposals(clientFor([asRecordEvent(spec)]));
  // "proposal_id" is genuinely ambiguous on the wire: it is BOTH the row's own
  // d-tag identity (the row's own "proposal_id" DB field) AND, confusingly,
  // the name of a DIFFERENT tag carrying "blockchain_proposal_id". These must
  // resolve to different values here, or the naming collision was missed.
  assert.equal(proposal.proposal_id, "p1");
  assert.equal(proposal.onchain_id, "42");
  assert.notEqual(proposal.proposal_id, proposal.onchain_id);
  assert.equal(proposal.title, "Neuer Spielplatz");
  assert.equal(proposal.summary, "Ein Spielplatz für den Hafen.");
  assert.equal(proposal.category, "Infrastruktur");
  assert.equal(proposal.governor, "100:0x5F5e499Dc1872c2Ce19a4b50cd10f680e78E3Ba3");
  assert.equal(proposal.irys_tx, "irys-abc");
  assert.equal(proposal.status, "active");
  assert.equal(proposal.published_at, new Date("2026-07-01T09:00:00Z").toISOString());
});

test("round-trip parity: a proposal with no formal category reports null, not the 'proposal' marker", async () => {
  const row = {
    proposal_id: "p2", title: "Radweg", summary: "Ein Radweg am Ufer.",
    state: "pending", updated_at: "2026-07-02T10:00:00Z",
  };
  const spec = proposalToSpec(row, "100:0x5F5e499Dc1872c2Ce19a4b50cd10f680e78E3Ba3")!;
  const [proposal] = await listProposals(clientFor([asRecordEvent(spec)]));
  assert.equal(proposal.category, null);
});

// --- notices (kind 32102, custom) ---

test("resolved notices keep their status", async () => {
  // noticeToSpec fixture with is_active:false → status resolved
  const row = {
    id: "n1", title: "Wasserleitung repariert", description: "Die Reparatur ist abgeschlossen.",
    is_active: false, updated_at: "2026-07-02T10:00:00Z",
  };
  const spec = noticeToSpec(row, "announcement")!;
  const [notice] = await listNotices(clientFor([asRecordEvent(spec)]));
  assert.equal(notice.status, "resolved");
  assert.equal(notice.kind, "announcement");
  assert.equal(notice.title, "Wasserleitung repariert");
  assert.equal(notice.message, "Die Reparatur ist abgeschlossen.");
});

test("listNotices: active notices sort before resolved ones, both d prefixes included", async () => {
  const resolvedRow = {
    id: "n1", title: "Alte Störung behoben", is_active: false, updated_at: "2026-07-02T10:00:00Z",
  };
  const activeRow = {
    id: "n2", title: "Wasserrohrbruch Hafenstraße", status: "active", severity: "hoch",
    description: "Bitte meiden.", updated_at: "2026-07-02T10:00:00Z",
  };
  const resolvedSpec = noticeToSpec(resolvedRow, "announcement")!;
  const activeSpec = noticeToSpec(activeRow, "service_alert")!;
  const notices = await listNotices(clientFor([asRecordEvent(resolvedSpec), asRecordEvent(activeSpec)]));
  assert.equal(notices.length, 2);
  assert.equal(notices[0].id, "n2");
  assert.equal(notices[0].kind, "service_alert");
  assert.equal(notices[0].status, "active");
  assert.equal(notices[0].severity, "hoch");
  assert.equal(notices[1].id, "n1");
  assert.equal(notices[1].status, "resolved");
});
