# Netizen Workspace — the full sovereign suite, E2EE meetings, and AI members (Design)

> **Status:** DRAFT for review · 2026-07-31 · extends **G6**
> ([MISSION_AND_GOALS.md](../../MISSION_AND_GOALS.md)) into a complete workspace *product*.
> **Builds on (does NOT duplicate):**
> [sovereign-workplace-suite](2026-07-25-sovereign-workplace-suite-design.md) (the G6 strategy: three
> planes, L1–L5 layers, reuse-vs-build) ·
> [sovereign-arbeitsbereich-slice1](2026-07-28-sovereign-arbeitsbereich-slice1-design.md) (the shipped
> hybrid files+docs architecture, the `Actor` AI seam) ·
> [chat protocol decision](../../future-research/2026-07-26_CHAT_PROTOCOL_DECISION.md) (poly-protocol
> unified by identity) ·
> [Netizen Accounts v2](2026-07-31-netizen-accounts-service-design.md) (per-node wallet stack; also
> awaiting review) ·
> [Netizen Cloud product spec](../../future-research/2026-07-27_NETIZEN_CLOUD_PRODUCT_SPEC.md)
> (the manifest IS the SKU list).
>
> **What is NEW in this spec:** (1) the **meetings plane decision** — the one workspace pillar with no
> prior decision (Jitsi exists only as a scaffold the installer cannot render); (2) **AI members in
> E2EE meetings** — transcripts and realtime AI characters, with consent-by-membership; (3) the
> **per-node sovereign model registry** (the "Sarvam pattern"); (4) the **productization + Röbel
> dogfood build order** that assembles the already-shipped pieces into one sellable workspace.

## 1. What we're building, in one paragraph

A **sovereign workspace** — the thing a team buys Microsoft 365, Google Workspace or Proton for —
running entirely on a **Netizen Node** the community or business owns: files, live documents, chat,
**end-to-end-encrypted meetings**, calendar, tasks, wiki — all behind the node's **own wallet-identity
keystone** (one OIDC login, `sub` = smart-account address), where **AI agents are first-class members**
— they hold their own identity, join meetings as visible participants, transcribe, draft minutes into
the document store with provenance, and interoperate with other agents natively over **Nostr**. The AI
is **the node's own**: a per-node model registry behind a LiteLLM gateway, so a German node runs Soofi
S, an EU node EuroLLM, an Indian node Sarvam — the community picks its sovereign model the way it picks
its language. Röbel is the Genesis deployment and the proving ground with real citizens, Vereine and
local businesses.

**The one-line pitch:** *openDesk gives institutions a sovereign office. Netizen Workspace gives every
community, business and person a sovereign office where the AI works for them — on keys, hardware and
models they own.*

## 2. Where we actually are (verified 2026-07-31)

Most of this product already exists. The honest inventory:

| Pillar | State |
|---|---|
| Identity (Röbel ID keystone) | **LIVE** on Fly; Nextcloud, Collabora, Matrix/MAS, web app as relying parties; `groups` claim is the one ACL; `roebel:actor_type` agent claim reserved |
| Files + Docs (Arbeitsbereich) | **MERGED + LIVE on the node, flag-gated OFF** — blocked on the two open RLS findings ([SECURITY_FINDINGS_2026-07-28.md](../../SECURITY_FINDINGS_2026-07-28.md)) and nine hand-set env vars |
| Chat (Matrix/Synapse + MAS + Element) | Running on the node but **hand-wired; the installer renders only a scaffold that would crash-loop** — deliberately removed from the manifest |
| Meetings | **Nothing decided.** `services.workspace.video` renders a single-container Jitsi stub that cannot work (no prosody/jicofo/jvb) |
| AI gateway | `ai.gateway: litellm` **declared in the manifest, deployed nowhere**; cognition is rented (Claude direct); `dataEgressPolicy` is a field, not a control |
| Agents on Nostr | **LIVE** — agent npubs, NIP-24 `bot: true` labels, watcher bounds in the manifest, NSP-9 federation, NSP-10 indexer |
| Accounts/custody | Netizen Accounts v2 spec awaiting review (node-held silent signing; per-node product) |
| Installer | `netizen render/doctor/up` proven for relay + workspace + identity + operations; **the meta-rule stands: anything on the node not rendered from the manifest is drift** |

The node has headroom: the whole 18-container stack measured **2.1 GiB RAM / ~0% CPU** (2026-07-30).
Meetings and on-node AI fit on the same box class; only local *inference* sizes a bigger box.

## 3. The meetings plane — the load-bearing new decision

### 3.1 Options considered

**(a) Jitsi** (the openDesk component; current scaffold). Mature, but: real deployment is 4+ services
(prosody/jicofo/jvb, UDP 10000), its E2EE is a bolt-on that degrades features, it has no
agent-as-participant story, and its identity integration is plain OIDC with none of our room/membership
semantics. We would be maintaining a second, disconnected communication stack beside Matrix.

**(b) Standalone LiveKit.** One binary SFU, first-class agents framework. But key distribution,
rooms, membership, history and consent would all be custom protocol work — exactly the "invent a
message layer" the chat decision prohibits.

**(c) MatrixRTC / Element Call on a self-hosted LiveKit SFU. ← RECOMMENDED.**
Element Call is Matrix-native conferencing (MSC4143): **media is E2EE per-frame; per-participant keys
are distributed over Matrix to-device messages** — the E2EE transport we already run. The self-hosted
backend is exactly two additions: the **LiveKit SFU** and the tiny **lk-jwt-service** (both open
source). The 2026 Element Call SDK refactor makes it embeddable as a widget in our own UI.

**(d) Nostr Nests / MoQ (NIP-53).** Audio spaces over Nostr. Not production for team meetings;
kept as the *public broadcast* rail (§3.4), not the meeting rail.

### 3.2 Why (c) wins — it makes the hard requirement cheap

The user-facing requirement "E2EE meetings **with AI participants**" is contradictory on every other
stack: either the meeting is E2EE and the AI can't hear it, or the AI hears it because the server can.
MatrixRTC dissolves the contradiction:

- **Consent = membership.** An AI transcriber or realtime character joins as a **Matrix room member
  with its own identity** (its smart account → keystone client-credentials → MAS → a Matrix user, per
  the G6 agent-runtime model). Because it is a legitimate member device, it receives the media keys
  like everyone else — the call stays E2EE with the agent as a *visible, labeled, invitable and
  kickable endpoint*. No silent server-side tap is possible, and none is built.
- **One media plane, two products.** The LiveKit SFU that Element Call needs is the same SFU the
  **LiveKit Agents** runtime (open source, self-hosted, STT→LLM→TTS ~500 ms, MCP tool calling) attaches
  to. Meetings and AI characters share infrastructure instead of multiplying it.
- **It composes with everything already decided.** Matrix is the chosen human-chat rail; MAS accepts
  Röbel ID as upstream OIDC (the documented standard path); org rooms come from the same
  `org:<accountId>:<role>` claim; meetings appear in Element AND embed in our Arbeitsbereich UI.
- **Sovereignty is clean.** Synapse + MAS + Element + Element Call + LiveKit + lk-jwt: all
  self-hostable on the node, all rendered by the installer, no cloud dependency. (OpenTalk was
  reviewed as the German alternative — BSI-labeled, but no agent story and a parallel stack; we stay
  component-compatible with openDesk via Matrix, which openDesk also ships.)

**Consequence:** `services.workspace.video` (Jitsi stub) is **removed**; a new **`services.meet`**
block replaces it (§6). Jitsi remains available to openDesk-federation deployments that already run it.

### 3.3 AI transcripts and AI realtime characters — three tiers, in build order

**Tier 1 — Post-meeting minutes (opt-in recording).** Organizer invites the **Protokoll-Agent** into
the meeting; the agent announces itself in the call (audio + room message — this is also the German
§ 201 StGB two-party-consent and AI-Act Art. 50 disclosure, made structural). It records the tracks it
receives as a member, then locally: Whisper STT → the node's LLM (via LiteLLM) → minutes + decisions +
action items. Output lands as (1) an E2EE Matrix message in the room, (2) a document in the org's
Nextcloud folder **via `recordWorkspaceAction()`** — actor `{kind:'agent', actingFor: organizer}` —
the provenance seam Slice 1 already built for exactly this.

**Tier 2 — Live transcription/captions.** The same agent streams STT and posts rolling captions
(Matrix room messages or the Element Call reactions channel). German-first: Whisper turbo or Vosk
(what Nextcloud Talk uses for live transcription) — evaluated at build time on the node's CPU budget.

**Tier 3 — Realtime AI characters.** A LiveKit-Agents worker joins as a member with voice: STT → node
LLM → TTS, plus MCP tools (Vault read, task creation, treasury *proposals* — never execution — under
its Zodiac budget and Agent Charter). **Mecky in the Ratssitzung**: answers "what did we decide about
this last year?" from the Town Context Graph, live. Avatar/video rendering of characters is explicitly
out of scope until voice is proven.

Every tier obeys the agent rules that already exist: own identity, `act` delegation, audit sink,
kill switch, `bot: true` labeling. **An AI in a meeting is a member you invited, not a feature that
listens.**

### 3.4 Nostr's role around meetings

- **Public/civic meetings** (council livestream, town assembly): announce and index via **NIP-53 live
  activities** + NIP-52 calendar events on the node relay; federation mirrors them (NSP-9); Atlas can
  show them. The meeting itself still runs on MatrixRTC; Nostr is the *public discovery + provenance*
  rail, consistent with "the relay is sovereignty infrastructure, not a reach channel."
- **Minutes provenance**: the two-tier split from Slice 1 — content private in Nextcloud/Matrix, the
  signed *fact of the action* published to Nostr under the agent's npub.
- **Agent-to-agent interop** stays on the existing A2A rails (`agents.a2a.relayPubkeys`); private agent
  channels remain gated on NIP-29 + NIP-42 (unchanged roadmap). **No cross-protocol message bridge** —
  the prohibition stands.

## 4. Netizen AI — the per-node sovereign model registry (the "Sarvam pattern")

Sarvam-105B/30B (India, open weights, Feb 2026), **Soofi S 30B-A3B (German/English MoE, open weights
July 2026, ~3.2B active params — the research doc's named upgrade trigger has FIRED)**, EuroLLM-22B
(Apache-2.0): the world now ships *regional sovereign models*. Netizen's move is not to pick one — it
is to make the model **a manifest field with regional presets**:

```jsonc
"ai": {
  "gateway": "litellm",                 // the one seam — already the declared rule
  "selfHosted": true,
  "models": {
    "reason":  "soofi-s-30b-a3b",       // preset de: Soofi S · preset eu: EuroLLM-22B
    "chat":    "soofi-s-30b-a3b",       // preset in: sarvam-30b / sarvam-105b
    "classify":"local-small",
    "stt":     "whisper-large-v3-turbo",// NEW role: meetings transcription
    "tts":     "local-tts",             // NEW role: AI characters' voice
    "frontier":"claude"                 // fallback, egress-gated
  },
  "sovereignty": { "dataEgressPolicy": "local-first" }
}
```

Deployment realities (from the verified research): a 30B-A3B MoE serves on a **Hetzner GEX44
(€232.30/mo)** class GPU box; GEX131 (€1,197.30/mo) for bigger models; nodes without a GPU declare
`selfHosted: false` and get frontier-via-gateway with **egress logged**. Two hard rules this spec
adds:

1. **The gateway lands before any local model.** LiteLLM on the node in front of Claude first — that
   turns `dataEgressPolicy` from a field into a control (route by data-class, log every egress) and
   gives per-citizen quotas (the Intelligence Dividend metering LiteLLM does natively).
2. **Meeting audio never leaves the node.** STT is local from Tier 1 — Whisper runs fine on the CPU
   class we have for post-meeting batch; live captions size the first GPU purchase, not the last.

This is also the honest answer to "AI for everyone using Netizen": most nodes will start with
`selfHosted: false` + logged egress + quotas, and *graduate* to their regional model when the
community funds the GPU — the manifest documents which state a node is in, and `netizen doctor`
says it out loud.

## 5. What "full workspace" means — and what we still refuse to build

The suite, per pillar, with its source of truth:

| Pillar | Provided by | Status/decision |
|---|---|---|
| Files | Nextcloud behind keystone (`@netizen-labs/workspace`) | live, gated |
| Documents | Collabora via our own WOPI host | live, gated |
| Chat | Matrix/Element via MAS | on node; **installer graduation = W2** |
| **Meetings** | **MatrixRTC: Element Call + LiveKit SFU + lk-jwt** | **this spec, W3** |
| Calendar | Nextcloud CalDAV first; NIP-52 for public events | integrate (portfolio decision) |
| Tasks/Projects | OpenProject as OIDC RP | scaffold → later wave |
| Wiki | XWiki as OIDC RP | scaffold → later wave |
| Mail | two-lane client (IMAP/JMAP + wallet-lane) | **never run a mail server** (unchanged) |
| Sheets | wave 3+ | "sheets are far harder than docs" (unchanged) |
| AI members | agent runtime + LiveKit Agents + LiteLLM | §3.3/§4 |

Unchanged discipline: **reuse documents/sheets/mail/calendar/tasks; build identity, agents, money,
meetings-glue and coordination.** And the ARCHITECTURE.md invariant binds this product explicitly:
no central account, no central document store, **no central SFU** — every service here renders
per-node from the manifest; if netizenlabs.xyz disappears, every workspace keeps working.

## 6. Manifest & protocol changes (all of it lands in the installer)

Per the standing rule — every service/config/policy MUST render from the manifest; hand-wiring is
drift:

1. **`services.meet`** (new block, replaces `services.workspace.video`): `{ matrixrtc: { livekit,
   lkJwt, elementCall }, hostnames, turn? }`. Renders: LiveKit + lk-jwt + Element Call containers,
   Caddy entries, `.well-known/matrix/client` MatrixRTC foci, keystone relying-party wiring via MAS.
2. **Matrix graduation** (prerequisite): the installer renders a REAL `homeserver.yaml`, MAS config
   and Element config from `services.chat.matrix` — importing every hand-won setting from the live
   node ([WORKSPACE_SSO_SETUP.md](../../WORKSPACE_SSO_SETUP.md)) so node #2 inherits them. This
   closes the known crash-loop trap.
3. **`ai.models` grows `stt` + `tts` roles**; regional presets `de|eu|in` ship as manifest templates
   (the Conduit-strategy "presets = templates" move, applied to AI).
4. **`agents.workers[]` gains a `meetings` capability** declaring which agent may be invited to calls
   and under which charter (per-org allow, recording announcement text, retention days for audio =
   **0 by default** — transcript survives, audio does not).
5. **Workspace env de-drift**: the nine hand-set env vars gating the Arbeitsbereich render from
   `services.workspace` + `identity.relyingParties`.
6. **Housekeeping while touching the schema**: fix the **NSP-9 numbering collision** (federation vs
   operations — operations becomes NSP-11), and note `services.meet` as NSP-7 surface.

## 7. Build order — strangler-fig, every step ships Röbel value

| Phase | Ships | Gate/exit test |
|---|---|---|
| **W0 — Unblock (days)** | Fix the two RLS findings (`account_owners` INSERT + rename); ship AI-Act Art. 50 disclosure (**legal deadline 2026-08-02**); offsite backups + cloud firewall (user one-liners) | org workspace safe to enable; disclosure live |
| **W1 — Workspace GA in Röbel** | Flip `NEXT_PUBLIC_WORKSPACE_NATIVE_FILES` for citizens + 2–3 pilot orgs; role-based write access (drop unconditional `canWrite`); mobile route | a Verein stores and co-edits real documents |
| **W2 — Chat graduation** | Installer renders real Matrix/MAS/Element; org rooms auto-provisioned from `org:` claims; chat tile → native | `netizen up` on a clean box yields working E2EE org chat; node #2 proves it |
| **W3 — Meetings v1** | `services.meet` rendered (LiveKit + lk-jwt + Element Call); embedded in Arbeitsbereich + Element; E2EE group calls | two orgs hold a real E2EE meeting on the node |
| **W4 — AI plane v1** | LiteLLM on-node (frontier behind it, egress logged, per-citizen quotas); **Protokoll-Agent Tier 1** (invite → announce → Whisper local → minutes to Nextcloud with provenance) | a real Vereins-sitzung gets AI minutes, consented, all audio on-node |
| **W5 — Live AI members** | Tier 2 captions; **Tier 3 realtime character** (Mecky in a call, voice, MCP tools, charter-bounded); first sovereign model if GPU funded (Soofi S preset) | Mecky answers a question live in a meeting; `doctor` ai layer goes green if GPU |
| **W6 — Productize** | `roebel-id`→`netizen-id` rename + generated JWKS/RP list; `@netizen-labs/workspace` extraction; manifest presets (`verein`, `town`, `business`, `de|eu|in` AI); Netizen Cloud **Workspace SKU** priced (Community €99 / Town €299 / Institution €900+ held) | a non-Röbel node declares the workspace and `netizen up` delivers it |

W1–W4 are justified by Röbel alone. W5 is the differentiator demo. W6 generalizes — gated, as
always, on a real second deployment.

## 8. Dogfooding in Röbel — real community, real businesses

- **Vereine first** (the org accounts already exist): files + docs + org chat + one real board
  meeting with the Protokoll-Agent. The Fördermittel agent already drafts for them — its drafts now
  land *in their workspace*, closing the loop.
- **Local businesses**: the gastro partners (already using AI menu images) get the same org
  workspace — a shared folder, a doc, a meeting link that is *theirs*, GDPR-clean, no Google account
  needed. Businesses are the paying-customer rehearsal for the Netizen Cloud SKU.
- **Civic meetings**: one public council-adjacent session announced via NIP-52/NIP-53, streamed
  through the same stack — the demonstration-effect artifact for the Netizen story.
- **Sommercamp cohorts** as the youth beachhead: each cohort gets a workspace; the AI character
  tier gets its friendliest test audience.
- **Individuals** (G6: "every user gets a sovereign workspace — individuals, not just orgs"): the
  citizen dashboard already tiles into personal files/docs; meetings for personal use ride along free.

Success metric for the dogfood, stated plainly: **one Verein and one business run a weekly meeting +
their documents on the node for a month without us touching the box.**

## 9. Risks & honest limits

- **Matrix graduation is the schedule risk** — it is the known trap (crash-loop scaffold) and
  everything in W2–W5 stacks on it. Mitigation: import the live node's working configs into the
  renderer rather than writing configs from docs.
- **E2EE + AI is consent-sensitive**: the member-model makes it structural, but German law
  (§ 201 StGB) and AI Act Art. 50 require the announcement UX to be unskippable, and retention
  defaults must be audio=0.
- **Element Call SDK churn** (2026 refactor is fresh); pin versions, treat the widget seam as ours.
- **XMTP stays the agent-DM rail, Matrix the human rail** — running both is a cost we accepted in the
  chat decision; meetings do not change it.
- **Local model quality/cost**: Soofi S is a preview release; frontier fallback stays, egress-logged.
  The GPU is a community purchase decision, not a prerequisite.
- **NSP-4 (Node API) remains the unsolved protocol work** for cross-node workspace features; nothing
  here depends on it, and nothing here should accidentally invent it ad hoc.

## 10. Decisions for Max

1. **Meetings plane = MatrixRTC/Element Call + self-hosted LiveKit** (drop the Jitsi stub) — confirm.
2. **AI-in-meetings consent model = membership** (agent must be invited, announces itself, audio
   retention 0 by default) — confirm.
3. **Order: chat graduation (W2) before meetings (W3)** — or accept hand-wired Matrix for a faster
   meetings demo and graduate afterward? (Recommended: graduate first; node #2 needs it anyway.)
4. **First dogfood org**: which Verein and which business get W1 access?
5. **GPU timing**: buy the GEX44-class box at W5 (Soofi S live) or defer until a node co-funds it?
6. **STT choice for German** (Whisper turbo vs Vosk) — decide by bake-off on the node at W4, or
   pre-commit?
7. **Does Tier 3 (realtime characters) target Mecky first**, or a neutral per-org assistant persona?

---

*Next step after approval: superpowers **writing-plans** for W0+W1 (the unblock + GA slice), with W2
(Matrix graduation in the installer) planned as its own slice immediately after.*
