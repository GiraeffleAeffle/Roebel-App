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
> **two-plane architecture** — public Nostr plane / private workspace plane, agents native in both;
> (4) the **productization + Röbel dogfood build order** that assembles the already-shipped pieces
> into one sellable workspace.
>
> **Revision 2026-07-31 (same day):** direction **affirmed by Max** (meetings plane, consent model,
> dogfood order). The AI-plane section (§4) was written in parallel with — and now **defers to** —
> [sovereign-ai-product-design](2026-07-31-sovereign-ai-product-design.md), which settles product
> shape, model policy ("the router is the product"), tiers and hardware; §4 here keeps only the
> *requirements the meetings plane feeds into that spec*. §3b (two-plane architecture) added from
> Max's direction: *public Nostr data for everything Expo users see; private sovereign org
> workspaces; AI agents native in both.*

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

## 3b. The two-plane architecture — public Nostr, private workspace, agents in both

Max's framing, adopted as the structural rule of the whole product:

> *Everything app users see publicly is Nostr data. Orgs (and individuals) get private sovereign
> workspaces. AI agents are native to both planes.*

### The public plane — the Expo app's public surface becomes Nostr-native

Target state: **feed posts, events, articles, org profiles — every public thing in the app — is a
signed Nostr event on the node's relay**, mirrored by federation (NSP-9), queryable across nodes
(NSP-10), rendered by Atlas, and portable because the author's npub is node-independent (the
identity bridge). Concretely, the kinds we standardize on: kind 1 (feed notes), NIP-23 `30023`
(articles — the story engine's output), NIP-52 `31922/31923` (calendar events), NIP-53 (live
activities, incl. public meetings from §3.4), kind 0 (profiles), NIP-05 (name mapping).

The path is a **strangler, not a rewrite** — Supabase stays the system of record while each public
read/write moves over:

1. **Write path outbound (mostly exists):** the publisher already mirrors public datasets to the
   relay under node-held org identities; the vanish pipeline (NIP-62/09) already makes deletion
   real, and account deletion already speaks NIP-62.
2. **Read path (the next slice):** the Expo public feed and events tabs read from the node's
   indexer/relay instead of Supabase views. Exit test: a *second* client (or Atlas) shows the same
   feed with no Supabase access.
3. **Write path native:** citizens author posts/events signed with their **client-held npub**
   (identity-bridge slices 2–4) instead of the node publishing on their behalf.
4. **Media:** images/video for public posts move to **Blossom** (the already-named adopt candidate);
   until then media URLs point at existing storage.

Two hard rules keep this honest: **only genuinely public data touches the relay** — no NIP-42 means
everything published is world-readable forever, so the relay's write-gate + the pre-publish
disclosure are the boundary, and anything personal/private/paid stays off it until NIP-42/NIP-29
land (unchanged roadmap). And **public-plane features must work from the relay alone** — if a
"public" feature needs a Supabase call, it is not yet on the public plane.

### The private plane — the sovereign workspace

Everything in §5: Nextcloud files, Collabora docs, Matrix chat, MatrixRTC meetings — E2EE or
SSO-gated, never on the relay, ACL'd by the one `groups` claim. Private for orgs AND for
individuals (G6: every user gets a sovereign workspace). The only thing that crosses from private
to public is the **signed provenance fact** (the two-tier split) or an explicit publish action
(a Verein posts its event: drafted in the workspace, published as NIP-52 on the relay).

### Agents native in both planes — same member, two behaviors

The same agent identity (smart account → derived npub → OIDC client-credentials) acts on both
planes under one charter:

| | Public plane | Private plane |
|---|---|---|
| Identity | npub, NIP-24 `bot: true` + `netizen_agent` tag | keystone `actor_type: agent` → MAS → Matrix member; workspace `Actor` seam |
| What it does | posts stories/events, answers mentions (watcher), A2A with peer-node agents | drafts docs, files minutes, joins meetings, proposes (never executes) treasury actions |
| Bounds | `agents.a2a.relayPubkeys` + watcher rate bounds | Agent Charter scopes, Zodiac budget, `act` delegation, audit sink |
| Visibility | labeled event, world-readable | visible member, kickable, kill switch |

The flow that shows the whole product in one sentence: **a Verein's agent attends the board meeting
(private, E2EE, invited), files the minutes to Nextcloud with provenance, drafts the public event
announcement, and publishes it as a signed NIP-52 event on the relay — where every federated node
and any Nostr client can see it.**

## 4. Netizen AI — meetings-plane requirements (defers to the Sovereign-AI product spec)

**Ownership note (2026-07-31):** product shape, tiers, hardware, model policy and presets are
settled in [sovereign-ai-product-design](2026-07-31-sovereign-ai-product-design.md) ("one product,
two doors"; **the router is the product**; RAG-first; Netizen Box via Assisted tier). This section
now states only what the *workspace/meetings plane requires from* that AI plane — kept here so the
requirements have one home:

1. **`ai.models` grows two roles**: `stt` (meetings transcription) and `tts` (AI characters'
   voice). The router spec owns which engines fill them per tier; the workspace only requires that
   the roles exist in the manifest and resolve through the gateway.
2. **The gateway lands before any local model** (W4 depends on it): LiteLLM on the node in front of
   the frontier model, so `dataEgressPolicy` becomes a control (route by data-class, log every
   egress) and per-citizen quotas apply to workspace AI from day one.
3. **Meeting audio never leaves the node.** STT is local from Tier 1 — post-meeting Whisper batch
   runs on the CPU class we have; live captions (Tier 2) are a stated input to the AI spec's
   hardware sizing, not a reason to ship audio off-box.
4. **Meeting/workspace agent calls carry the actor context** (`act` principal, org scope) so the
   router can apply the governed egress policy per data-class — a Vereins-protokoll is private-tier
   by definition.
5. **The regional-model story ("Sarvam pattern")** — a German node running Soofi S, an Indian node
   Sarvam, an EU node EuroLLM — is marketing-true through the AI spec's preset/tier design; this
   spec only requires that swapping the preset never touches the workspace integration (the roles
   are the interface).

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
3. **`ai.models` grows `stt` + `tts` roles** (regional presets and tiers are owned by
   [sovereign-ai-product-design](2026-07-31-sovereign-ai-product-design.md)).
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
| **W0 — Unblock (days)** | Fix the open RLS findings (`account_owners` INSERT, account rename, stale session claims); offsite backups + cloud firewall (user one-liners). *(AI-Act Art. 50 disclosure: implemented 2026-07-30 in a parallel session; only deploy gates remain.)* | org workspace safe to enable |
| **W1 — Workspace GA in Röbel** | Flip `NEXT_PUBLIC_WORKSPACE_NATIVE_FILES` for citizens + 2–3 pilot orgs; role-based write access (drop unconditional `canWrite`); mobile route | a Verein stores and co-edits real documents |
| **W2 — Chat graduation** | Installer renders real Matrix/MAS/Element; org rooms auto-provisioned from `org:` claims; chat tile → native | `netizen up` on a clean box yields working E2EE org chat; node #2 proves it |
| **W3 — Meetings v1** | `services.meet` rendered (LiveKit + lk-jwt + Element Call); embedded in Arbeitsbereich + Element; E2EE group calls | two orgs hold a real E2EE meeting on the node |
| **W4 — AI plane v1** | LiteLLM on-node (frontier behind it, egress logged, per-citizen quotas); **Protokoll-Agent Tier 1** (invite → announce → Whisper local → minutes to Nextcloud with provenance) | a real Vereins-sitzung gets AI minutes, consented, all audio on-node |
| **W5 — Live AI members** | Tier 2 captions; **Tier 3 realtime character** (Mecky in a call, voice, MCP tools, charter-bounded); first sovereign model if GPU funded (Soofi S preset) | Mecky answers a question live in a meeting; `doctor` ai layer goes green if GPU |
| **W6 — Productize** | `roebel-id`→`netizen-id` rename + generated JWKS/RP list; `@netizen-labs/workspace` extraction; manifest presets (`verein`, `town`, `business`, `de|eu|in` AI); Netizen Cloud **Workspace SKU** priced (Community €99 / Town €299 / Institution €900+ held) | a non-Röbel node declares the workspace and `netizen up` delivers it |

W1–W4 are justified by Röbel alone. W5 is the differentiator demo. W6 generalizes — gated, as
always, on a real second deployment.

**The public plane (§3b) runs as a parallel N-track**, paced by the identity-bridge slices rather
than the W-phases: **N1** Expo public feed + events read from the indexer/relay (exit test: a second
client renders the same feed with zero Supabase access) → **N2** citizens author kind-1/NIP-52
events under client-held npubs (identity-bridge slices 2–4) → **N3** public media on Blossom.
N1 needs nothing from the W-track and can start immediately; the AI-plane work runs in its own
spec's track.

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

> **Affirmed 2026-07-31 (Max):** the meetings plane (MatrixRTC/Element Call + self-hosted LiveKit,
> Jitsi stub dropped), the consent-by-membership model, the dogfood direction, and the two-plane
> architecture (§3b — public Nostr / private workspace / agents in both, from Max's own framing).
> GPU/hardware timing and model choices moved to
> [sovereign-ai-product-design](2026-07-31-sovereign-ai-product-design.md). Remaining open:

> **Settled 2026-07-31** (recommendations adopted on Max's "recommend answers and continue"):

1. **Chat graduation (W2) comes before meetings (W3).** Meetings stack on a correctly configured
   Synapse+MAS; a hand-wired demo would be exactly the drift the installer rule forbids; and node #2
   needs the rendered configs regardless. The demo is one phase later and twice as durable.
2. **First dogfood orgs — by criteria, Max names the humans**: the Verein most active in the org
   events dashboard today (an org that already runs events has documents, a board, and meetings),
   plus one gastro partner already using the AI menu tooling (shortest path to a paying-customer
   rehearsal). One of each, not more, until the month-untouched metric holds.
3. **STT: pre-commit Whisper (large-v3-turbo) for Tier 1** post-meeting minutes — best German
   accuracy, batch fits the CPU budget. The bake-off (vs Vosk / whisper-streaming) applies only to
   Tier 2 live captions and runs on the node at W5, when latency actually matters.
4. **Tier 3 ships as Mecky.** Existing brand, existing tools, German voice, and G6 already names
   Mecky the reference org agent. The persona becomes a per-org-configurable charter field later —
   a skin, not a second build.
5. **W-track first in the main working thread; N1 is the designated parallel-session task.**
   W0→W1 is the path that unblocks everything else, while N1 (public feed/events read from the
   indexer/relay) touches disjoint code and is independently unblocked — the ideal handoff to a
   parallel agent.

---

*Next step after approval: superpowers **writing-plans** for W0+W1 (the unblock + GA slice), with W2
(Matrix graduation in the installer) planned as its own slice immediately after.*
