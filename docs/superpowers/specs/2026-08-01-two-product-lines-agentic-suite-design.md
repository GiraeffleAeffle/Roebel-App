# Two Product Lines — openDesk Interop for Institutions, an Agentic Suite for the World (Design)

> **Status:** DRAFT for review · 2026-08-01 · extends
> [netizen-workspace-meetings-ai](2026-07-31-netizen-workspace-meetings-ai-design.md) (the W-track,
> §3b two-plane rule) and the G6
> [sovereign-workplace-suite](2026-07-25-sovereign-workplace-suite-design.md) three-plane synthesis.
> **Revisits (with new evidence, at Max's direction):** the
> [chat protocol decision](../../future-research/2026-07-26_CHAT_PROTOCOL_DECISION.md)'s "Buzz = R&D
> bet, revisit in 2–4 quarters" — the revisit is NOW, because Buzz shipped what was missing.
> **Direction from Max (2026-08-01):** openDesk was built for a world where humans do all the
> digital work; modern work is AI agents doing most of it with humans checking and approving. Focus
> on that, on a native open interoperable protocol (Nostr), serve German institutions openDesk-tool
> interoperability (line A, Röbel first), AND build a credibly-neutral, onchain,
> privacy-preserving full suite (line B — Fileverse-class docs/sheets, Buzz-class human-agent
> collaboration), with ONE agent able to produce documents in both worlds.

## 1. The thesis, in three sentences

openDesk and every M365-generation suite encode the assumption that a human sits in every editor
seat; the AI-era workspace inverts this — **agents produce, humans review and approve** — and needs
agent-native primitives (keypair identity, signed event logs, tool protocols) as the FLOOR, not a
bolt-on. Nostr is the native wire for that floor, and Block's Buzz (Apache-2.0, 20k stars,
self-hostable since v0.4.x) has already built the human-agent workspace shape we predicted in the
G6 spec. Netizen's job is unchanged from G6 but now concretely executable: **supply the identity,
money, governance and compliance layers that Buzz and Fileverse deliberately omit — under BOTH a
German-institutional line and a credibly-neutral global line — with one agent runtime that drives
both.**

## 2. Research digest (verified 2026-08-01)

### Buzz — no longer a bet; a deployable substrate
- **v0.5.3 (2026-07-31)**, ~2,050 commits, 20k stars, Apache-2.0. Desktop (Tauri+React,
  macOS/Win/Linux), mobile (Flutter iOS/Android), `buzz-cli` (agent-first JSON I/O). Release
  cadence: four releases in the last four days of July — fast-moving upstream (a reason to
  fork LAST, §7 B5).
- **Self-hosting is real now**: production compose bundle (`deploy/compose/` — Postgres events +
  FTS, Redis pub/sub, MinIO/Blossom media, own relay on Axum, optional Caddy/TLS, single-node VPS
  target). Multi-tenant capable. *This fits `netizen render` like a glove — it is the same shape as
  every service the installer already renders.*
- **Works today:** channels/threads/DMs, media with frame-anchored comments, **canvases**
  (collaborative editing), search, signed audit log, NIP-34 git (patches, signed commits),
  agent membership via **ACP** with per-agent keypairs — and since v0.5.0 a **generic
  "bring-your-own-harness" ACP runtime** (goose, Codex, Claude Code, or ours). **v0.5.3 shipped
  huddles (voice) with automatic agent transcription**, local TTS voices, and NIP-49 encrypted key
  backups. **Still in progress:** YAML workflow approval gates, push, git hosting backend.
- **The private-channel answer:** Buzz does NOT use NIP-29 or MLS. Its relay is auth'd (NIP-42)
  with Postgres-backed channel membership — **the relay is the boundary**. This resolves our
  "private Nostr groups unreachable" blocker by changing the trust model: privacy = your own
  relay's access control, **not E2EE**. (No message E2EE documented; watch Marmot/NIP-EE.)
- Identity = Schnorr keypairs. **Our wallet→npub derivation (live, `@netizen-labs/nostr`) gives
  every Röbel citizen and every Netizen agent a Buzz identity for free.** Payments, EVM identity,
  governance, cross-org federation: still absent — still our moat.

### Fileverse — the credibly-neutral docs plane, agent door included
- **dDocs** (E2EE collaborative docs) and **dSheets** (private onchain-data sheets, "decentralized
  Google Sheets") both public beta; **AGPL-3.0** (license-compatible with Röbel App); Ethereum-
  native; "walkaway page" + backup-key recovery = a sovereignty/exit story aligned with ours.
- **The load-bearing fact: Fileverse ships an API + MCP server** — external LLMs/agents can
  programmatically create, edit and manage E2EE documents, explicitly framed as human-agent
  multiplayer. The agent door we would have had to build EXISTS.
- Complementarity is exact: Buzz has signed-but-not-encrypted collaboration; Fileverse has E2EE
  documents with no workspace around them. Together + our rails = the suite.

## 3. The two product lines and the shared core

```
                    ┌── SHARED CORE (build once) ─────────────────────────────┐
                    │ Identity: smart account → OIDC (Röbel ID) → npub (live) │
                    │ Agent runtime: charter · act-delegation · Zodiac budget │
                    │   · audit sink · kill switch · MCP TOOL BUS             │
                    │ Money/governance: Safe · Circles · EURe · MACI          │
                    │ Meetings: MatrixRTC/Element Call + LiveKit (decided)    │
                    │ Installer: everything renders from the manifest         │
                    └───────────────┬─────────────────────┬───────────────────┘
   LINE A — Sovereign Workspace     │                     │   LINE B — Netizen Agentic Suite
   (openDesk-interop · DE/EU inst.) │                     │   (credibly neutral · global)
   Nextcloud + Collabora (live)     │                     │   Buzz fork: channels·agents·
   Matrix/Element (W2)              │                     │     workflows·canvases·git
   MatrixRTC meetings (W3)          │                     │   Fileverse dDocs/dSheets (E2EE)
   WOPI/WebDAV MCP tools (Actor     │                     │   Fileverse MCP + buzz-cli/ACP
     seam — built)                  │                     │   Nostr-native public record (live)
   Compliance story: BSI-adjacent,  │                     │   Privacy story: E2EE docs, key
     E2EE chat via Matrix, GDPR     │                     │     identity, self-hosted relay
   Röbel = Genesis proof            │                     │   (honest: chat relay-gated, not E2EE)
```

- **Line A is NOT paused or demoted** — it is shipping (W1 GA executed; W2 Matrix graduation and
  W3 meetings next) and it is the German/EU institutional wedge: same components openDesk ships,
  behind wallet identity, with the AI layer openDesk lacks. Röbel proves it.
- **Line B is the agent-native suite** for communities, DAOs, startups, and institutions ready to
  migrate: Buzz-model collaboration + Fileverse-model documents + our rails. Credible neutrality =
  open protocols (Nostr, Ethereum, MCP/ACP), open licenses (Apache-2.0/AGPL), forkable manifest,
  verified exit — the properties we already enforce.
- The **§3b two-plane rule generalizes**: line B's workspace channels are the *private* plane
  (own relay, membership-gated); the public record stays on the strfry relay + NSP-9/NSP-10 —
  two relays per node, which is ALREADY the federation-mirror pattern.

## 4. Fork / adopt / build — the discipline table

| Piece | Decision | Why |
|---|---|---|
| Buzz (workspace shell, agents, workflows, canvases, git) | **DEPLOY stock first, FORK only where identity/money demand it** — never clone from scratch | Apache-2.0, 2k commits of momentum, upstream velocity is free R&D; a from-scratch clone re-fights every battle they already won and loses upstream forever |
| Fileverse dDocs/dSheets | **ADOPT + integrate (MCP + embed); contribute upstream; self-host study** | AGPL fits; the agent door exists; docs/sheets remain "far harder than they look" (portfolio rule) |
| Identity binding (wallet→npub→Buzz account; agents via ACP with existing npubs) | **BUILD** (thin) | Our derivation is live; this is the moat seam |
| Money in the workspace (tips, bounties, agent budgets on tasks) | **BUILD** (on Safe/Zodiac/Circles — NSP-3) | Buzz explicitly "not blockchain, no payments" — the whitespace named by G6 |
| Meetings | **MatrixRTC stays the E2EE meetings plane (both lines, external/institutional); line B teams ALSO get Buzz huddles** (shipped v0.5.3, relay-gated voice with native agent transcription) | Huddles arrived mid-design and deliver the "AI transcript" ambition for internal line-B calls for free; E2EE calls remain MatrixRTC per the 07-31 decision |
| Presentations / mail / calendar | Unchanged portfolio decisions (embed later / two-lane mail / CalDAV) | YAGNI |
| E2EE chat (Marmot/NIP-EE/MLS-over-Nostr) | **WATCH, do not build** | Nobody has shipped it production-grade; honest threat-model note in line B marketing until then |

## 5. One agent, two toolsets — the architecture claim that unifies Max's ask

The requirement "the same agent produces documents with openDesk tools AND the native suite" is an
**MCP adapter question, not a second agent**. The agent runtime (identity, charter, delegation,
budget, audit) is toolset-agnostic; it already exists in design (G6 L4) and in seams (workspace
`Actor` + `recordWorkspaceAction`). Two tool adapters hang off the one tool bus:

1. **`workspace-tools` (line A adapter, mostly built):** Nextcloud WebDAV/OCS + our WOPI host →
   `create_doc`, `read_folder`, `write_doc` against Collabora-backed storage — the
   `@netizen-labs/workspace` package IS this adapter minus the MCP wrapper.
2. **`suite-tools` (line B adapter):** Fileverse MCP (E2EE docs/sheets) + `buzz-cli`/ACP
   (channels, workflows, reviews, git).

One Mecky-class agent, chartered once, drafts the Verein's Protokoll into Nextcloud on Monday
(line A) and the DAO's proposal into an E2EE dDoc + Buzz channel on Tuesday (line B) — same
identity, same audit trail, same kill switch. **This is the demo that sells both lines.**

## 6. What changes in existing decisions (and what does not)

- Chat decision: Buzz promoted from R&D to **line B substrate** (new evidence: self-host compose,
  20k stars, mobile, canvases, NIP-42-gated channels). The **no-message-bridge rule stands** —
  unification stays at identity. XMTP stays the in-app DM rail; Matrix stays line A human chat.
- Workspace spec (07-31): W-track (W2 Matrix, W3 meetings, W4 AI plane) **unchanged** — it is
  line A + shared core. N-track (public Nostr) unchanged. Line B adds a **B-track**, parallel,
  buildable by a separate session (Max's intent) because it touches disjoint surfaces.
- G6 three-plane table: now executable — office plane (A: openDesk components / B: Fileverse),
  coordination plane (A: Matrix / B: Buzz), moat plane (ours, shared).
- NSP: `services.buzz` (compose bundle: relay+postgres+redis+minio+app) and `services.fileverse`
  (integration config; self-host TBD by B1 study) become manifest blocks — **everything into the
  installer**, as always.

## 7. B-track build order (for the build session Max wants to spawn)

| Slice | Ships | Exit test |
|---|---|---|
| **B0 — Deploy, don't build (days)** | Stock Buzz on the Röbel node via `services.buzz` in the manifest + `netizen render/up`; behind Caddy; NO fork | a channel with Max + one agent works on `buzz.roebel.app`; `netizen doctor` reports it |
| **B1 — Identity binding** | Wallet→npub login glue (citizens use derived keys); agents join via ACP under their EXISTING npubs (bot-labeled); membership sync from CitizenNFT/org claims (relay-sync pattern) | a citizen and Mecky exchange messages in a members-only channel, both under identities the node can prove |
| **B2 — Fileverse agent door** | Fileverse MCP wired into the agent tool bus; agent drafts an E2EE dDoc from a Buzz channel command; dDocs links unfurl in-app | "@mecky draft the Vereinsantrag" → E2EE dDoc appears, humans co-edit, agent revises |
| **B3 — The two-toolset demo** | `workspace-tools` MCP wrapper over `@netizen-labs/workspace`; ONE agent produces the same document class into Nextcloud (line A) and dDocs (line B) on command | the §5 demo, recorded, becomes the flagship artifact |
| **B4 — Money + moat** | Münzen tips/bounties on Buzz tasks; Zodiac-bounded agent budgets visible in-channel; provenance events to the public relay | an agent completes a bounty, payment settles onchain, audit trail spans both relays |
| **B5 — Fork decision point** | ONLY NOW decide what to fork (branding, EVM identity in-client, governance surfaces) vs upstream vs keep stock | a written fork-scope doc with upstream-first bias |

Gates: B0–B2 are Röbel-dogfoodable alone. B5 is deliberately LAST — fork scope decided from
operating experience, not speculation. German-institution GTM stays on line A throughout.

## 8. Honest limits & risks

- **Buzz channels are not E2EE** — line B's privacy claim must say "your relay, your keys, E2EE
  documents" and not imply E2EE chat. German institutions with E2EE chat requirements = line A
  (Matrix). Watch Marmot/NIP-EE.
- Buzz is v0.4 and moving fast — pin versions in the manifest; expect breaking changes; the
  fork-last rule (B5) exists to avoid stranding on a stale fork.
- Fileverse self-hosting depth (beyond the walkaway page) needs the B1-era study before we promise
  node-local dDocs; until then it is an integration, not a rendered service.
- Two suites is a focus risk for a solo founder — mitigated because B0–B2 are integration slices
  (days-weeks, not months) and line A's W-track continues on its own schedule.
- ACP/Claude-Code harness quality for OUR agents is unproven — B1 validates it early.

## 9. Decisions

> **Settled 2026-08-01** (Max approved the recommendations — "okay good continue"):

1. **Fork-last CONFIRMED.** B0 deploys stock Buzz; no clone, no source patches in B0–B4; fork
   scope decided at B5 from operating experience.
2. **Line B naming: OPEN** — plans use the working name "Netizen Suite" without locking branding
   (copy rules apply when it goes public).
3. **Fileverse: adopt via public API/MCP now; Max reaches out to the Fileverse team in parallel**
   (an upstream relationship beats a cold AGPL fork; nothing in B2 requires waiting for a reply).
4. **B0 target = the Röbel Genesis node** (dogfood-first; 2.1 GiB used of 16 GB, 11 GB disk of
   320 GB — headroom confirmed).
5. **B-track spawns now** as a parallel session against
   [the B0+B1 plan](../plans/2026-08-01-buzz-b0-b1-deploy-and-identity.md); line A's W-track
   continues independently in its own sessions.

---

*Next step after approval: superpowers writing-plans for B0+B1 (deploy + identity binding) as a
standalone plan a parallel session can execute — plus a one-page brief for that session so it
inherits the fork-last rule and the §5 architecture claim.*
