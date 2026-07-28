# State of the Netizen Stack

**Last verified: 2026-07-28.** Companion documents:
[State of the Netizen Node](STATE_OF_THE_NETIZEN_NODE.md) (what runs on the box) and
[State of Nostr](STATE_OF_NOSTR.md) (identity, relay, federation, index, agents), and
[Roadmap and deferred work](ROADMAP_AND_DEFERRED.md) (what is deliberately not built).

Netizen is an open, forkable stack for running a **sovereign community node**: identity,
governance, treasury, workspace, money and AI, owned by the community that runs it.
**Röbel/Müritz is Genesis Node #1 — the proof of concept where the whole stack runs in
production, for a real town, with real money and real democracy.**

That is the method, not an accident. A town demands the highest bar on every primitive at
once: real people you cannot fake, a democracy whose legitimacy is non-negotiable, real
funds, real neutrality. Building the tool against a live town first is the forcing function.

---

## 1. What is live today

| Layer | Primitive | Status |
|---|---|---|
| **Identity** | CitizenNFTv2 / AttesterNFTv2 on Gnosis, soulbound, percentage-band thresholds | live |
| | Röbel ID — own OIDC IdP (wallet → SSO) | live, fronts Nextcloud + Matrix |
| | Nostr identity bridge — wallet-derived npub, portable across nodes | **live 2026-07-27** |
| **Governance** | MACI private voting + 3-of-5 Shamir coordinator federation | live |
| **Treasury** | Gnosis Safe multisig (Gemeinschaftskasse) | live |
| **Value** | Circles v2 group currency ("Röbel Münzen") | live |
| **Workspace** | Nextcloud + Collabora, Matrix/Synapse + MAS + Element | live on the node |
| | **Sovereign Arbeitsbereich** — native file browser + in-app Collabora editing, citizen and org scope | **merged 2026-07-28, gated off** ([state](SOVEREIGN_ARBEITSBEREICH_STATE.md)) |
| **Comms** | XMTP v3 DMs (dual-rail with Supabase), Nostr relay | live |
| **Federation** | NSP-9 peer mirroring over NIP-77 negentropy | **live 2026-07-28** |
| **Query** | NSP-10 cross-node index (search + provenance), public read | **live 2026-07-28** |
| **Agents** | labelled, first-class members of the public record | **live 2026-07-28** |
| **AI** | Mecky (Claude), MCP tool bus, content + outreach agents | live |
| **Node installer** | `netizen render \| doctor \| up` from one manifest | render + up working |

**Chain: Gnosis (100).** The app's primary wallet moved off Base on 2026-07-28, so identity,
governance, treasury, currency **and signing** are finally on one chain. See
[the migration](superpowers/specs/) and §4 below for why that was not cosmetic.

## 2. The shape

- **Protocol** — thin versioned specs (NSP-0…10) as zod schemas. NSP-0 is the **Node
  Manifest**: one JSON document describes an entire node. NSP-9 is **federation**, NSP-10 the
  **cross-node index**.
- **Node** — the self-hostable backend and workspace services.
- **Installer** — `netizen` renders a manifest into a deployable bundle and applies it.
- **Apps** — the Expo app and Next.js site a community's members actually touch.

The manifest is the centre of gravity. If something is configured on a node but not
declared in a manifest, that is drift, and it will not survive a rebuild or a fork.

## 3. Which repo does what

**Netizen gets its own repo. Röbel is the proof of concept.** Today the Netizen packages
still live inside the Röbel monorepo — deliberately, as a strangler fig, so the tooling was
built against a real town rather than a whiteboard.

| Belongs to **Netizen** (generic, forkable) | Belongs to **Röbel** (this repo) |
|---|---|
| `packages/protocol` — NSP schemas | `apps/expo`, `apps/web` — the town's apps |
| `packages/cli` — the installer | `apps/roebel-id` — Röbel's IdP deployment |
| `packages/nostr` — identity + events + relay client | `contracts/` — Röbel's deployed contracts |
| `packages/relay-sync` — membership → relay access | `roebel.netizen.json` — one node's manifest |
| `packages/miniapp-sdk` | Röbel's runbooks and subsystem state |

**The extraction trigger has fired.** The orientation doc in the Netizen project says the
packages extract "once a second node exists". A second node now exists (2026-07-28, see
[State of Nostr](STATE_OF_NOSTR.md) §5), and an outside contributor is expected to run an
independent one. Extraction is therefore the next structural piece of work, not a someday.

What makes it tractable: every `@netizen-labs/*` package is already node-agnostic. None of
them import Röbel constants; they take a manifest or explicit arguments. The Röbel-specific
parts are the manifest instance and the apps.

## 4. Hard-won facts a newcomer would otherwise rediscover

These cost real debugging time. They are documented because the failure modes all looked
like something else.

- **A smart account stamps its EIP-712 domain with its wallet's chain id.** For months the
  app signed with Base while servers verified on Gnosis, and every ERC-1271 check failed with
  a revert that read like a bad signature. Fixed at the root by the chain migration.
- **`lib/encryption.ts` keeps `chainId: 8453` deliberately.** It is a derivation constant
  hashed into the evidence encryption key, never verified onchain. "Migrating" it would
  silently make existing encrypted evidence undecryptable.
- **`strfry sync` enforces the destination's write policy**, and cannot distinguish a peer
  from a stranger. This is why federated events land in a separate mirror
  ([State of Nostr](STATE_OF_NOSTR.md) §5).
- **Workspace packages consumed by Metro must use extensionless imports.** `.js` extensions
  are correct for Node and break `eas update`, while tests and typecheck both still pass.

## 5. Honest limits

- **n=2, and both nodes are on one box.** Federation is proven as a protocol, not as a
  network. The concentration ratio is 1 until an independent operator runs a node.
- **The relay has no NIP-42 and no NIP-29** — no gated reads, no relay-enforced groups.
  Everything published to it is world-readable. This constrains what may ever be published.
- **Relay-enforced groups need NIP-29**, which this strfry build lacks, so agent *channels*
  are not reachable yet.
- **x402 metered data access is not built.** Gnosis is absent from Coinbase's facilitator
  list and EURe lacks EIP-3009 (verified onchain), so it needs a self-run facilitator on the
  Permit2 path. See [the marketplace research](future-research/2026-07-27_DATA_SOVEREIGNTY_AND_MARKETPLACE.md).
- **You cannot sell personal data in the EU.** Consent is revocable, so the marketplace
  thesis works for non-personal, business, aggregate and compute-to-data — not for
  "citizens sell their data".
