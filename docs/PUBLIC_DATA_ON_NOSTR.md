# Moving the app's public data onto Nostr

**Date: 2026-07-28.** Part of the [documentation index](README.md). Builds on
[Data placement and CRUD](DATA_PLACEMENT_AND_CRUD.md) and [State of Nostr](STATE_OF_NOSTR.md).

The goal: a town's public record — events, cinema programme, organisations, marketplace —
published as signed events anyone can read and verify. Farcaster-shaped, but richer, because
the record is civic rather than social and the identities are attested.

---

## 1. What is actually published today

**Since 2026-07-30, most of it.** The node runs a **publisher service**
(`@netizen-labs/publisher`, declared as `services.publisher` in the manifest) that mirrors the
public datasets onto the relay every 5 minutes — first live pass: 41 events accepted.

| Published to the relay now | Not yet |
|---|---|
| kind 0 Citizen profiles | events/articles owned by *personal* accounts (needs per-person opt-in) |
| kind 1 public feed posts (dual-written by the citizen's device) | comments, likes, reposts (client-signed — next app-side slice) |
| agent profiles and replies | org avatars inside kind 0 content (still Supabase URLs) |
| the wallet↔npub binding (kind 30078) | |
| **events / Veranstaltungen** — NIP-52 `31923`, signed per owning org | |
| **cinema programme** — NIP-52 `31923`, signed by the cinema's own key | |
| **organisation profiles** — kind 0, each org under its own derived key | |
| **business profiles** — kind 0, each under `biz-<id>` scope (same scope as its deals so profile + offers join by pubkey) | |
| **blog articles** — NIP-23 `30023`, HTML→Markdown, `ai_generated` label carried onto the record | |
| **town news** — NIP-23 `30023`, `d=news:<uuid>`, town-signed, slug tag for routing | |
| **civic notices** — kind `32102` (`alert:<id>` or `announcement:<id>`), town-signed, resolved alerts are edits (never deleted) | |
| **marketplace** — NIP-15 `30018`, seller opt-in gated (unrevoked npub binding), withdrawal-as-edit | |
| **business deals** — NIP-99 `30402`, offers signed under the business's derived key | |
| **images** — mirrored content-addressed at `/media/<sha256>` (Blossom-shaped reads); the hash in the signed event is the integrity check | |
| **the manifest** — `/manifest` on the index: chain id + every contract address, so governance and Münzen are discoverable on-chain without asking anyone | |

**The withdrawal path shipped before the publish path**, exactly as §3.4 demands — and the
first kind-30018 events on the record were four withdrawal tombstones, published before any
active listing (their sellers had not opted in, so the gate held them back). The index honours
NIP-09 kind 5 with a durable hide state: a deletion outlives the row, so a mirror re-serving
the deleted event cannot resurrect it.

The CMS half publishes differently from feed posts, deliberately: posts are signed on the
citizen's device (the key never leaves it), but events and org data are edited server-side, so
the **node** publishes them under node-held per-organisation identities
(`deriveOrgIdentity`). The publisher is stateless — `created_at` is the row's `updated_at`, so
an unchanged row rebuilds the identical event (relay dedups) and an edit becomes a NIP-01
replacement. The mapper is the privacy boundary: organiser email/phone/name are never read,
and a test pins that planted PII cannot appear in a serialized event.

## 2. The rule that decides the order: publish the minimum

GDPR is not a step at the end. It decides **what a published event may contain**.

An event listing needs a title, a time, a place, and *who is behind it*. It does **not** need the
organiser's email, phone number or address. Those stay in the node and the app fetches them for
users who need them. The published event carries the organiser's **npub** — pseudonymous, and
already the identity the relay authenticates.

Two consequences worth stating plainly:

- **Erasure on a relay is advisory** ([CRUD §3](DATA_PLACEMENT_AND_CRUD.md)), so anything that
  might need Article 17 erasure must not be in the published payload in the first place. This is
  not a limitation to engineer around — it is the boundary that makes the rest safe.
- **A pseudonymous npub is still personal data** when it can be linked to a person. The
  wallet↔npub registry is private for exactly this reason. Publishing *more* linkable attributes
  next to an npub weakens that, so each new field is a decision, not a default.

## 3. Order of migration, by GDPR risk ascending

Deliberately not by usefulness. The lowest-risk type goes first so the pattern is proven on
data where a mistake costs nothing.

### 3.1 Cinema programme — first

**No personal data at all.** Screening times for a business. Nothing to erase, nobody to
identify, and a natural fit for a calendar kind. If the pattern is wrong, the blast radius is a
wrong film time.

Also the best demonstration: a neighbouring town's agent answering "what's on this weekend"
across two nodes is exactly the federation payoff, with zero privacy surface.

### 3.2 Events / Veranstaltungen — second

Public by intent; the organiser is usually an organisation. **NIP-52 defines calendar events**,
so a standard Nostr client can render Röbel's calendar with no integration work — which is the
difference between publishing data and publishing it usefully.

Care: a private individual hosting an event is publishing their own name. That is their
decision to make, so it needs the same explicit opt-in the Nostr identity screen already uses,
with the same honest wording about permanence.

### 3.3 Organisations — third

An organisation **is** an identity, so a kind 0 profile signed by the org, not a row owned by
the app. Business data, low risk. Contact *persons* are personal data and stay off the event.

This one has a side benefit: once orgs hold their own keys, they can publish their own events
and listings directly, and the app stops being the authority for their content.

### 3.4 Marketplace — last, and most carefully

**NIP-15 defines a marketplace shape.** Listings change constantly, so they are parameterised
replaceable events from the start — a sold or withdrawn item becomes an edit, never a deletion
request that may not be honoured.

The care is that sellers are often private individuals. The listing is public; the transaction,
the contact route and any address stay in the node. Test the withdrawal path *before* the
publish path: a marketplace where you cannot take something down is worse than no marketplace.

## 4. The mechanics, identical for each type

1. **Choose a standard NIP kind** over a custom one wherever one exists. A custom kind means
   only Röbel's app can render it.
2. **Use parameterised replaceable kinds** (30000–39999) with the record's canonical ID in the
   `d` tag. Then edit is a re-publish and withdrawal is an edit — [CRUD §3](DATA_PLACEMENT_AND_CRUD.md).
3. **Dual-write, exactly as feed posts already do**: write to Supabase first, then publish
   best-effort. A relay failure must never fail the user's action.
4. **Record the publication** in `nostr_publications` so parity is checkable and a hide state
   has somewhere to live.
5. **Index it** — the node's indexer picks it up automatically once the kind is in
   `services.indexer.kinds`, and it becomes queryable at `/events` with search and provenance.

Steps 3–5 are already built and running for feed posts. Each new type is mostly steps 1 and 2.

## 5. Why this is richer than Farcaster

Worth being concrete rather than rhetorical:

- **The identities are attested, not just registered.** A Röbel npub is bound to a wallet that
  holds a CitizenNFT, so "a citizen said this" is verifiable rather than asserted.
- **Agents are labelled members**, not scrapers. Machine-authored content declares itself.
- **The record is federated between sovereign nodes**, not hosted on one company's hubs.
- **It is civic data with provenance**, so an answer can cite which node and which author it
  came from.

The honest limit: none of that matters until more than one community runs a node. Today the
concentration ratio is 1.
