# B0+B1 — Stock Buzz on the Röbel Node + Netizen Identity Binding (Plan)

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development or
> superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.
> **Spec:** [two-product-lines-agentic-suite](../specs/2026-08-01-two-product-lines-agentic-suite-design.md)
> (§7 B-track; §9 decisions settled 2026-08-01). This plan covers slices **B0** (deploy stock Buzz
> via the installer) and **B1** (agents + citizens under Netizen identities). B2+ get their own plans.

## Session brief (read this first — you are a parallel session)

- **You are the B-track.** Other sessions work the same repos concurrently (line A W-track, NSP-12,
  accounts). Before building anything: `git pull`, `git log --oneline -15`, and check
  `ls packages/` in BOTH repos for prior work. Commit with EXPLICIT PATHSPECS only — never
  `git add .` — and push after each task (user's global git rule).
- **THE RULE OF THIS TRACK — FORK-LAST:** B0–B4 make ZERO source changes to Buzz. Configuration,
  composition, identity glue only. If a step seems to need a Buzz code change, STOP and record it
  as a B5 fork-scope candidate instead. A "Netizen Buzz clone" is explicitly rejected (spec §9.1).
- **Everything into the installer** (standing feedback rule): every container, config file and
  policy that lands on the node MUST be rendered from the manifest by `netizen render` and applied
  by `netizen up`. Hand-wiring on the box is drift and will be reverted.
- **Two repos:**
  - Installer/protocol code: `/Users/maxbrych/Documents/privat/side_projects/netizen_labs`
    (`packages/protocol/src/manifest.ts`, `packages/cli/src/render.ts|doctor.ts|executor.ts`,
    render unit tests in `packages/cli`). A near-duplicate CLI exists in the Röbel repo
    (`DAO_test/packages/cli`) — **verify which copy performed the most recent node deploy**
    (`git log` both; the sovereign-AI Phase A work rendered from netizen_labs) and build where the
    latest deploy came from; record the answer in your first report. Do not let the copies drift
    silently — if you must touch both, say so.
  - Röbel app + docs corpus: `/Users/maxbrych/Documents/privat/side_projects/DAO_test` (this plan,
    state docs, `@netizen-labs/nostr` identity derivation, the manifest instance
    `packages/protocol/examples/roebel.netizen.json` — same drift caveat).
- **The node (Röbel Genesis Node #1):** `root@178.105.19.80` (Hetzner CPX42, Ubuntu 26.04). SSH key
  `~/.ssh/id_ed25519` is passphrase-protected — `ssh-add` first (shared macOS launchd agent).
  Deploy dir `/opt/netizen/roebel/`. Secrets live in the box's own `.env` and NEVER pass through
  the CLI. `netizen up` rsyncs with `--delete`; generated state must be in the exclusion list
  (existing precedent: `.env`, `strfry-policy/members.txt`, `ops/status.json`) — **Buzz's data
  volumes/dirs must be excluded the same way or every deploy wipes the workspace.**
  Caddy (container `caddy:2`, docker network `netizen`) terminates TLS; **DNS is at IONOS and only
  Max can add the `buzz` A record** — that is a user gate, flag it early.
  Headroom verified 2026-07-30: 2.1 GiB RAM used of 16, 11 GB disk of 320.
- **Upstream:** `github.com/block/buzz`, Apache-2.0, **pin `v0.5.3`** (or the latest tag at
  build time — record which). Server bundle lives in `deploy/compose/`. Buzz brings its own
  Postgres + Redis + MinIO — run them as DEDICATED containers (do not share the node's existing
  Postgres; isolation beats consolidation at v0.5.x, and upstream supports exactly this shape).
- **Identity facts you need (already built, do not re-derive):**
  - Agents: `deriveAgentIdentity(nodeSecret, nodeId, name)` in `@netizen-labs/nostr` — node-held
    keys from `NODE_AGENT_SECRET` (on the box). Every agent event carries NIP-24 `bot: true` +
    `netizen_agent` tagging on the PUBLIC relay; inside Buzz, agents are first-class members by
    design, but keep the same keys so one agent = one npub everywhere.
  - Citizens: `deriveNostrSecretKey(walletSignature)` over the canonical message
    `"Netizen Nostr-Identität v1"` — **client-held, derived on device, the node must never hold or
    see a citizen's key** (custody rule from the identity-bridge spec; non-negotiable).
- **Buzz stays "Buzz"** in this track (upstream product, stock deployment). Line-B product naming
  ("Netizen Suite", working title) is not locked; no public branding work in B0/B1.

## Global Constraints

- pnpm only; render logic changes need unit tests in the installer repo's existing render test
  suite (pure-function tests — the established pattern).
- Pin container images/tags by digest or version tag — never `latest` (node convention).
- No shell `timeout` wrapper on macOS (binary doesn't exist — use the Bash tool's timeout).
- Secrets by reference in the manifest (`$BUZZ_*`) — an inline secret fails NSP-0 validation.
- German-first only for Röbel-app-facing UI (none expected in B0/B1).

---

### Task B0.1 — Upstream discovery (bounded, half a day max)

**Goal:** replace assumptions with facts about `deploy/compose/` at the pinned tag. Everything
downstream keys off this report.

- [ ] Clone `block/buzz` at the newest release tag (expect ≥ v0.5.3; record exact tag + commit).
- [ ] Inventory `deploy/compose/`: services, images (published registry images vs build-from-source
  Dockerfiles?), env vars and secrets each service needs, ports, volumes, healthchecks, the
  Caddy/TLS story it assumes, and how the relay URL reaches the desktop/mobile clients.
- [ ] Decision rule: if upstream publishes server images → pin them by digest. If server images
  must be built from source → build ONCE (locally or on the box), tag
  `netizen/buzz-<component>:<upstream-tag>`, record digests; do NOT wire a build step into
  `netizen up` (the installer applies, it does not compile).
- [ ] Identify the account/invite surface: how are communities/channels created, how do
  use-limited invite links (v0.5.0 feature) work, what admin API/CLI exists for membership —
  B1.3 depends on this. Also locate `buzz-cli` + the BYOH/ACP runtime configuration
  (how an external agent harness authenticates with a keypair).
- [ ] Write findings to `docs/superpowers/plans/2026-08-01-buzz-b0-notes.md` (commit it — the
  B2+ plans will read it), including a "surprises vs. spec assumptions" section.

**Exit:** the notes file answers every question the later tasks reference, with file paths into
the upstream repo.

### Task B0.2 — `services.buzz` in the manifest (NSP-7 surface)

- [ ] Add an optional `buzz` object to the `Services` zod schema in
  `packages/protocol/src/manifest.ts` (installer repo): `{ hostname (e.g. buzz.roebel.app),
  imageTag/digests per component, dataDir?, communityName? }` + secrets by reference
  (`$BUZZ_POSTGRES_PASSWORD`, `$BUZZ_MINIO_SECRET`, whatever B0.1 found). Follow the file's
  jsdoc-as-spec convention; note it as NSP-7 surface.
- [ ] Extend the renderer per the established 5-step recipe (precedent: the Nextcloud block,
  `renderNextcloudSetup`): `renderComposeYml()` gains the Buzz services + volumes;
  `renderCaddyfile()` gains the hostname → app-container route; `plan()` gains a step in the right
  phase with the hostname added to the `dns` step; `renderBundle()` emits any setup script/config
  files; `SECRETS.md` gains the new refs. Add the Buzz data volumes to the rsync exclusion list
  in the executor.
- [ ] `netizen doctor`: report the service (endpoint check) and extend the sovereignty report's
  comms layer note (a workspace relay you run is sovereignty-positive). Layers a node never
  declared stay omitted — follow the existing pessimistic-but-fair conventions.
- [ ] Unit tests: render tests asserting compose/Caddyfile/plan output for a manifest with
  `services.buzz` declared AND (regression) unchanged output when absent.
- [ ] Commit (pathspecs), push.

**Exit:** `netizen render` of a buzz-declaring manifest emits a complete, pinned, secrets-by-ref
bundle; render tests green; a manifest without buzz renders byte-identically to before.

### Task B0.3 — Deploy to the Röbel node

- [ ] Add `services.buzz` to the canonical `roebel.netizen.json` (hostname `buzz.roebel.app`).
- [ ] **USER GATE (flag to Max BEFORE deploying): add the IONOS A record `buzz` → 178.105.19.80.**
- [ ] Put the new secrets in the box's `/opt/netizen/roebel/.env` (invented values, recorded in the
  box's secret store convention — never in git, never through the CLI).
- [ ] `netizen render` (absolute manifest path — pnpm filter cwd gotcha) → `netizen up --dry-run`
  → review plan → `netizen up`.
- [ ] Verify: containers healthy; `https://buzz.roebel.app` serves (valid cert); a Buzz desktop
  client connects to the relay; `netizen doctor` reports it green; node RAM/disk delta recorded.
- [ ] Re-run one unrelated `netizen up` cycle and confirm Buzz data survived (rsync exclusion
  proof — the members.txt lesson).

**Exit (spec B0):** a channel with Max + one agent works on `buzz.roebel.app`; doctor reports it;
data survives a redeploy.

### Task B1.1 — First agent joins under its existing identity

- [ ] Derive (or reuse) the node agent's keypair via `deriveAgentIdentity(NODE_AGENT_SECRET,
  nodeId, "mecky")` — the SAME identity that posts on the public relay.
- [ ] Configure the ACP/BYOH harness (per B0.1 findings) so the agent connects to the node's Buzz
  relay with that keypair; declare the membership in the manifest the way `agents.a2a.relayPubkeys`
  declares public-relay access (add a sibling field if needed — a one-line schema addition, with
  the same "declaring the key IS the authorization, auditable in a git diff" rationale).
- [ ] The agent answers a mention in a members-only channel. Its Buzz profile clearly identifies it
  as an agent (Buzz supports this natively).
- [ ] Kill-switch check: removing the key from the manifest + `netizen up` revokes the agent's
  access (or document the actual revocation path if Buzz's membership makes it different).

**Exit:** Mecky (or a neutral test agent) chats in a members-only channel under its canonical npub,
revocably.

### Task B1.2 — Citizen identity, custody-preserving

- [ ] v1 is deliberately modest: the Röbel app (profile → "Netizen Workspace" section, behind a
  feature flag) lets a citizen derive their workspace key on-device (existing
  `deriveNostrSecretKey` flow — signature prompt is silent) and export/copy it for import into the
  Buzz client, with a German explainer that this key IS their workspace identity. The node NEVER
  sees the key (custody rule). No SSO deep-integration in B1 — record what deeper integration
  would need as B5 candidates.
- [ ] Onboarding path: use-limited invite links (v0.5.0) generated for the pilot channel; document
  the flow for 3–5 pilot humans.
- [ ] CitizenNFT→membership automation (relay-sync analogue against Buzz's membership surface) is
  OUT of B1 — write up what B0.1 found about the admin surface and file it as the B2-adjacent
  follow-up so it isn't lost.

**Exit (spec B1):** a citizen and the agent exchange messages in a members-only channel, both under
identities the node can prove (wallet↔npub binding already exists for citizens; agent keys are
manifest-declared).

### Task B1.3 — State docs + handoff

- [ ] Update `docs/STATE_OF_THE_NETIZEN_NODE.md` (+ `WORKSPACE_STATE_AND_NEXT.md` if it lists
  services) with the Buzz service, its resource footprint, secrets refs, and the invite/membership
  facts. State docs that disagree with the box are bugs — verify against the box, not this plan.
- [ ] Append B2-ready notes (Fileverse MCP slice) to the b0-notes file: what the agent harness can
  reach, where the tool-bus wiring should live.
- [ ] Final report: exact versions/digests deployed, RAM/disk delta, everything user-gated that
  remains, B5 fork-scope candidates collected along the way.

## Risks / honest limits

- Buzz is v0.5.x with a days-long release cadence: pin hard, upgrade deliberately, expect the
  B0.1 notes to age fast — date every claim.
- Buzz channels are relay-gated, NOT E2EE — nothing in B0/B1 may claim otherwise (spec §8).
- If `deploy/compose/` turns out to assume its own reverse proxy in a way that fights the node's
  Caddy, prefer configuring Buzz behind the existing Caddy (config-only); a genuinely
  incompatible assumption is a B5 candidate, not a patch.
- Desktop/mobile clients are upstream builds connecting to our relay — client UX is theirs; do not
  attempt client changes in this track.
