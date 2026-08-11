# Autar — the agentic workspace: orchestrator, model router, and the meeting-to-work loop (Design)

> **Status:** DRAFT for review · 2026-08-11 · brainstormed with Max
> **Extends:** [two-product-lines-agentic-suite](2026-08-01-two-product-lines-agentic-suite-design.md) (line B),
> `netizen_labs/docs/STRATEGY.md` §5g (Autar-first, the own client, the two doors) and §12d (the routing
> engine), `netizen_labs/docs/AUTAR_KICKOFF.md` (M0–M2).
> **Confirms, does not overturn:** the [chat protocol decision](../../future-research/2026-07-26_CHAT_PROTOCOL_DECISION.md)
> — Autar stays Nostr-native, Matrix stays in line A, unified at identity with no message bridge.
> **Direction from Max (2026-08-11):** build the Slack/Teams-shaped workspace whose intelligence
> matches the Claude Code harness; full Nostr interoperability because agents are keypair-native
> there; calls on LiveKit driven by our own client; an AI Agent Orchestrator performs model routing;
> Claude plans and strategises, GLM-class models execute; **response speed is a first-class routing
> constraint, not a free variable**; and **code is not the priority — strategy, meetings, planning,
> ideation and marketing are the main use cases.**

## 1. Thesis

openDesk and every M365-generation suite assume a human sits in every seat. Autar assumes the
inverse: **agents produce, humans decide.** The shell stays deliberately familiar — channels,
threads, DMs, calls — because the novelty must live in what happens after you mark an agent, not in
learning a new metaphor. What makes it feel like the Claude Code harness rather than Slack-with-a-bot
is that the unit of interaction is not a reply but **a delegated piece of work with a plan, a result,
and an approval**.

The north star, in Max's words: start a meeting, add the project's agent to the call, send the link
to a contributor, ask the agent questions by marking it and otherwise it listens silently; at the end
the channel holds a transcript file and an agent-written summary; findings become work by marking the
agent, or by the agent proposing the follow-ups itself. Onboarding happens at the link.

## 2. Scope

The full "AI + crypto M365" is eight-plus independent subsystems and cannot be one spec. **This spec
covers two things only:**

1. **The Orchestrator and the model router** — the component that turns a mention into routed work.
2. **The meeting-to-work loop** — the north-star scenario end to end, because it exercises every
   plane and is testable.

Everything else is decomposed in §12 into follow-on specs. Explicitly **out of scope here**: the
visual design system, documents/sheets (Fileverse plane, B2), payments in-thread, governance,
mail/calendar, mobile clients, and the public GTM surface.

## 3. Decisions settled in this brainstorm

| # | Decision | Rationale |
|---|---|---|
| D1 | **Shell is Slack/Teams-shaped** — channels, threads, DMs. No new paradigm to learn. | Familiarity is a feature; the differentiation is agent depth, not navigation |
| D2 | **Substrate is Nostr, chat and channels included** (stock Buzz first, fork-last) | An agent *is* a keypair — no account provisioning, no device-key ceremony. Matrix's E2EE was designed around human devices doing verification, which is the wrong shape for an agent fleet |
| D3 | **Matrix is not used in Autar.** It stays in line A for German institutions | One identity plane (npub). Adding MXID re-splits the thing Autar exists to unify |
| D4 | **Calls: LiveKit SFU driven by our own client**, with Nostr carrying identity, membership, call announcement and post-call artifacts | Keeps one identity plane; guest links become a design problem, not an integration problem; LiveKit's agent framework makes an AI participant native |
| D5 | **Harness per agent role**, declared in the agent's Nostr profile | ACP's bring-your-own-harness contract already models this; costs nothing architecturally |
| D6 | **Claude plans, GLM-class models execute** (§5) | Planning turns are short and judgment-heavy; execution turns are long and mechanical |
| D7 | **An Orchestrator agent performs routing**, two-speed (§4) | Routing is itself a member with a key, budget and audit trail; telemetry is the §12d dataset |
| D8 | **Marketing-first tool bus**, not a repo tool bus (§7) | Code is not the priority. The ICP is a Verein and a restaurant |
| D9 | **Open weights self-hosted for sensitive data** | The GDPR/DPIA argument, not the price argument (§5.3) |
| D10 | **Routing resolves three axes in order: classification → latency → cost** | Speed and privacy are requirements; price is what we optimise inside them (§5.1) |
| D11 | **Unit of account is EUR; payment rails are pluggable** | Münzen is one rail among many to come, not the accounting unit. Launch simple: EUR budgets, Stripe subscriptions (§8.1) |
| D12 | **The in-call agent splits by question type, not data class** | Retrieval runs live and local; reasoning is acknowledged and deferred. Removes the apparent privacy/UX trade-off (§5.4) |
| D13 | **A meeting creates its own channel** | Matches the Teams shape and makes guest history a non-question (§6.2) |
| D14 | **One Expo codebase for every platform from the start** | Codebase drift is the failure mode that kills solo-maintained cross-platform products; worth a lower desktop-interaction ceiling (§14) |
| D15 | **Electron, not Tauri, for desktop** | Electron bundles Chromium, so desktop WebRTC is identical to the tested browser stack. Tauri's Linux WebKitGTK media support is the risk, and calls are the north star (§14.1) |

## 4. The Orchestrator

### 4.1 What it is

A resident agent member with its own npub, budget and audit trail. It is the target of a channel
mention. It does not do the work; it decides **who does it, on which engine, at what effort, and
whether a human must approve before or after.**

```
   #weekly ──@autar──▶ ORCHESTRATOR ──┬──▶ fast path (deterministic)  ~0 cost, <50ms
                                       │      known request shapes
                                       │
                                       └──▶ slow path (Claude planning turn)
                                              ambiguous asks only
                                                     │
                                    ┌────────────────┼────────────────┐
                                    ▼                ▼                ▼
                              specialist        bulk producer     specialist
                              (marketing)        (GLM-5.2)        (bureaucracy)
                                    └────────────────┼────────────────┘
                                                     ▼
                                        result → thread + approval surface
```

### 4.2 Two-speed routing — the load-bearing detail

If every routing decision is an LLM call on a capable model, **routing costs more than the work.**
"Summarise yesterday's meeting" must never pay a Claude planning turn to discover it is a
summarisation job.

- **Fast path.** A deterministic matcher over request shape + channel context + attached artifacts.
  Known shapes (summarise, transcribe, draft-from-template, generate-image, extract-fields,
  translate, classify) dispatch immediately with a pinned engine, effort and budget. No model call is
  made to decide.
- **Slow path.** Anything unmatched escalates to one Claude planning turn that produces a plan: steps,
  engine per step, budget estimate, and whether approval is needed before acting.
- **The loop that matters.** Every slow-path decision is logged with the shape it saw, the route it
  chose, what it cost, and whether the human approved the result unchanged. Recurring shapes get
  promoted into the fast path. This is §12d's "routing telemetry becomes the dataset that makes the
  router smart", implemented as a concrete mechanism rather than an aspiration.

### 4.3 Delegation discipline

Each hop re-establishes context, so delegation is not free. Rules:

- **One level of delegation.** The orchestrator delegates to specialists; specialists do not
  re-delegate. Deeper trees are a debugging and cost disaster.
- **Do not delegate what a specialist finishes in a couple of steps.** Prefer direct execution.
- **The orchestrator commits to its delegation** — it does not redo or re-derive a specialist's work
  after the report comes back.
- **Parallel dispatch in one message** when steps are genuinely independent.

### 4.4 Failure behaviour

| Failure | Behaviour |
|---|---|
| Specialist errors or times out | Orchestrator posts the failure in-thread naming the step and the reason. It does not silently retry on a costlier engine |
| Budget ceiling reached mid-task | Work pauses, partial result is posted, an approval card offers "raise budget / stop / continue cheaper" |
| Engine unavailable (self-hosted node down) | Fall back per policy to the hosted tier **only if the data classification allows it** (§9). Otherwise queue and report |
| Route was wrong (human rejects result) | Rejection is logged against the routing decision, not just the output — this is the negative signal the fast path learns from |
| Ambiguous ask, low confidence | Ask one clarifying question in-thread rather than guessing. Never silently narrow scope |

## 5. The model router

### 5.1 Three axes, in priority order

The router does not optimise cost alone. It resolves three constraints in a fixed order:

1. **Data classification** — a hard constraint. An engine above the payload's class is refused, on
   every path including fallback (§9).
2. **Latency budget** — a hard constraint set by the *surface*, not the task (§5.4). A live call and
   an overnight batch job are different worlds.
3. **Cost** — minimised subject to (1) and (2).

Stated the other way: **speed and privacy are requirements; price is what we optimise inside them.**

### 5.2 Policy

| Turn phase | Latency budget | Engine | Why |
|---|---|---|---|
| **Live in-call answer** | TTFT < 600ms | **flash tier**, streaming, ≤1 tool call | A human is waiting mid-conversation. Nothing else matters at this budget |
| Interactive in-thread reply | < ~3s | mid tier, effort `low`–`medium` | Fast enough to feel conversational |
| Strategy · planning · ideation · decision queue | seconds to minutes | **Claude Opus 5**, effort `high`/`xhigh` | Judgment. Short outputs, so premium pricing touches few tokens |
| Bulk drafting · long-context production | minutes | **GLM-5.2** (self-hosted where data is sensitive) | 1M context, cheap, open weights |
| Transcript cleanup · summarisation · classification · extraction | asynchronous | cheapest capable tier + **Batch API (−50%)** | Mechanical and unhurried — the meeting summary is the archetype |
| Final German customer-facing copy | asynchronous | **Claude** | Voice and German quality; Max reviews public copy regardless |
| Images | seconds | kie.ai `nano-banana-2-lite` | Already the shipped default across the repo |
| Speech → text | streaming, real-time | whisper-class **on the node** | Meeting audio never leaves our hardware |

Five cost levers, not one: **tier routing · prompt caching (reads ~0.1× of input, writes 1.25×) ·
the effort parameter · the Batch API at −50% for anything not latency-bound · and the fast path
itself, which spends nothing at all.** Stacked, a well-routed fleet lands roughly an order of
magnitude under naive Opus-everything.

### 5.3 Verified engine facts (2026-08-11)

**GLM-5.2** (Z.ai / Zhipu, released 2026-06-13): 753B parameters, **open weights**, 1M context,
131,072 max output. API **$1.40 / $4.40** per MTok. Strongest open-weight coder measured
(Terminal-Bench 2.1: 81.0; SWE-bench Pro: 62.1). Z.ai runs a **true Anthropic-compatible endpoint**
at `api.z.ai/api/anthropic` — the harness points at it with a base-URL swap, no code change.

**Claude** list pricing: Opus 5 $5/$25 · Sonnet 5 $3/$15 ($2/$10 introductory through 2026-08-31) ·
Haiku 4.5 $1/$5 per MTok.

**Flash tier candidates** (measured August 2026, to be re-benchmarked at implementation):
Gemini 2.5 Flash-Lite leads time-to-first-token at **0.35s** with 213.5 tok/s and $0.10/1M input;
Gemini 2.5 Flash and **Claude Haiku 4.5** both hold TTFT **under 600ms** on medium prompts;
**Groq**'s LPU hardware is consistently the fastest inference *provider* and is the route to
flash-class latency on open weights; DeepSeek V3.2-Exp is the cheapest credible option at
**$0.28/$0.40** per MTok. Anthropic additionally offers **fast mode** (`speed: "fast"`, beta
`fast-mode-2026-02-01`) on Opus 5 and Opus 4.8 — the same model at up to 2.5× output tokens/sec,
priced $10/$50 on Opus 5, Claude API only, with its own separate rate limit.

**The honest read: GLM does not win on price against Anthropic's cheap tier.** At $1.40/$4.40 it is
*dearer than Haiku 4.5 on input* and marginally cheaper on output. It wins on three other things:
**open weights** (self-hostable, so sensitive data never leaves the node), a 1M window, and
capability far above Haiku's tier. The sovereignty argument is the real one and it is stronger than
the price argument would have been.

**Trap: the $18/mo GLM Coding Plan is quota'd** (~80 prompts/5h, ~400/week). That is a
human-at-a-keyboard plan. A fleet of resident 24/7 agents exhausts it in days — **budget the API,
not the subscription.**

### 5.4 Latency engineering

Model choice is only one of the levers, and not the largest. In descending order of effect:

1. **Do not call a model at all.** The orchestrator's fast path (§4.2) was designed for cost, but its
   biggest win is latency — a dispatch decision that costs no model call also costs no round trip.
2. **Pre-warm the prompt cache.** Cache reads skip prefill entirely, which is most of TTFT on a long
   system prompt. When a call opens, fire a `max_tokens: 0` request carrying the agent's system
   prompt and channel context, so the first in-call question never pays cold prefill. Re-warm inside
   the cache TTL for the duration of the meeting.
3. **Lower the effort.** Lower effort means fewer and more consolidated tool calls and less preamble —
   a latency lever as much as a cost one.
4. **Stream, always, on any human-facing surface.** Perceived latency is time-to-first-token, not
   total time.
5. **Cap tool calls inside a latency budget.** In-call answers get at most one tool call; anything
   needing more is acknowledged immediately and completed after the meeting.
6. **Then, and only then, pick a faster engine.**

**The `sensitive` + live cell, resolved (Max, 2026-08-11): split the in-call agent by question type,
not by data classification.**

Flash-class latency on hosted infrastructure is not reachable on our own GPU box. But that constraint
turns out not to bind, because what people actually ask an agent mid-meeting is overwhelmingly
**retrieval and capture**, not reasoning: *what did we decide last week · what number was that ·
note that as an action item · who owns this*. That is short-context lookup over the running
transcript and the context graph, and a small self-hosted model serves it inside the budget precisely
because the model is small and the context is short and cached.

| In-call ask | Handling |
|---|---|
| Retrieval, capture, clarification | Answered live by a **small self-hosted model** over the running transcript + context graph. Sub-second, nothing leaves the node |
| Reasoning, drafting, analysis | **Acknowledged immediately**, queued, completed after the call on the correct engine with full classification enforcement (§9) |

**The latency ceiling is a meeting-UX requirement, not a privacy compromise.** Nobody wants a
40-second agent monologue mid-conversation even from an infinitely fast hosted frontier model. Privacy
and UX point the same way here, so no trade-off is being made — the earlier framing of this as a
trade-off was wrong.

Two rules make the privacy posture explicit rather than merely adequate:

- **The agent is always a visible participant.** Never a silent listener absent from the roster.
- **The join screen states that the meeting is transcribed**, and by which agent account, before
  anyone joins. Transparent by construction, and the GDPR-correct thing regardless.

### 5.5 Engine registry

Engines are declared in the manifest and rendered by the installer like every other service (the
standing "everything into the installer" rule). Each entry carries: id, endpoint, auth,
**data-classification ceiling** (§9), **latency class** with a measured TTFT, price per MTok in/out,
context limit, and whether it is self-hosted. The router reads this registry; **no engine is
hardcoded in agent code**, and re-benchmarking a tier is a manifest change, not a code change.

## 6. The meeting-to-work loop

The north-star scenario, decomposed into the seven capabilities it actually requires.

| # | Capability | Status | Notes |
|---|---|---|---|
| 1 | Start a call from a channel | build | Call announcement published as a Nostr event in the channel |
| 2 | Add the project agent to the call | build | Agent joins as a LiveKit participant under its own npub |
| 3 | Send a join link to a non-member | **primitive exists** | Buzz `POST /api/invites` mints use-limited codes (NIP-98 signed, owner/admin role) |
| 4 | Agent silent by default, answers when marked | build | Wake-word is the mention; otherwise transcribe-only. **Output mode is user-selectable per channel** — speak (TTS), post to the thread, or both. The agent is always visible in the participant roster |
| 5 | Live transcription | **partly exists** | Buzz v0.5.3 huddles ship automatic agent transcription; our client needs its own path on LiveKit |
| 6 | On hang-up: transcript file + agent summary posted to the channel | build | Summary is a Batch-API job at the cheap tier |
| 7 | Meeting → work: mark the agent to act, or it proposes follow-ups | build | This is the delegation loop of §4 |

### 6.1 Data flow

```
channel ──start call──▶ Nostr call event (kind: call announcement, channel-scoped)
                              │
                              ├── members join via client ─────┐
                              ├── guest joins via invite link ─┤──▶ LiveKit room
                              └── agent joins as participant ──┘     (media only)
                                                                          │
                                        audio ──▶ STT on the node ──▶ running transcript
                                                                          │
                     mention detected ──▶ orchestrator ──▶ answer spoken/posted in-thread
                                                                          │
                                             hang-up ──▶ transcript file ──▶ Nostr event + blob
                                                     └──▶ summary job (Batch, cheap tier)
                                                              └──▶ summary message + proposed
                                                                   follow-ups as approval cards
```

**Nothing about the meeting lives outside the relay except the audio itself.** Identity, membership,
the call announcement, the transcript and the summary are all signed Nostr events.

### 6.2 Onboarding at the link

The guest opens the link and sees a join screen: their name, a notice that the meeting is transcribed
and by which agent account, one button. A Nostr key is derived and held client-side; they are added
as a scoped guest member for the duration plus a grace period. **No install, no signup, no visible
key.** The custody rule from §5g carries: keys are client-held, no Autar server ever sees an nsec,
and no surface may invite a user to paste a private key anywhere except a client's import field.

**A meeting creates its own channel** (the Teams shape). Because the channel is new, a guest has no
prior history to see and the question does not arise. For the separate case of inviting someone into
an *existing* channel, the invite carries a **`share_history` flag** — an explicit "Share history"
choice made per invitation, defaulting to off.

### 6.3 Transcript lifecycle

- **The transcript is authored by the agent's own account** and published as a signed Nostr event on
  the private relay, blob attached. Provenance is therefore intrinsic — the transcript names its
  author the way every other event does.
- **Deletion uses NIP-09** (event deletion request, kind 5), which the Buzz relay already implements.
  The event's author signs the request, so a human asks the agent and the agent issues the deletion.
- **On our own closed relay, deletion is enforceable.** NIP-09 is only a *request* that public relays
  may ignore; on the membership-gated private plane we control the store and actually delete. This is
  a substantive reason to keep transcripts on the private plane and never mirror them to the public
  relay.
- **An operator hard-delete path exists alongside it.** A data subject's right to erasure must not
  depend on an agent account cooperating or still existing, so relay-level deletion is available to
  the org owner independently of the agent's signature.

## 7. Agent roster and tool bus

Because code is not the priority, the tool bus is marketing- and administration-shaped. Repo tools
sit at the bottom.

| Agent | Role | Default engine | Core tools |
|---|---|---|---|
| **Orchestrator** | Routing, delegation, the decision queue | fast path + Claude on escalation | delegation, budget, audit |
| **Meeting** | Transcription, summary, follow-up proposals | cheap tier + Batch | STT, transcript store, summariser |
| **Strategy** | Planning, ideation, analysis | Claude Opus 5 | context graph, web research, document production |
| **Marketing** | Flyers, copy, social, campaigns | GLM for bulk, Claude for final German copy | image generation (kie.ai), CMS publishing, templates |
| **Bureaucracy** | Grants, applications, forms, sponsor outreach | GLM draft → Claude polish | document production, outreach/email, deadline calendar |
| **Dev** *(low priority)* | Code | GLM-5.2 via the Anthropic-compatible endpoint | repo tools, Agent SDK harness |

Several of these exist today as Röbel app *features* — the flyer generator, the Fördermittel outreach
chain, menu and event publishing. Autar's job per §5g is turning them into **standing agents with
their own keys, budgets and audit trails.**

### 7.1 Three independent dials

**Harness per agent · tools per role · engine per turn phase.** They vary independently. An agent's
identity, budget and audit trail are one object on Nostr regardless of which engine served a given
turn.

## 8. Budgets, approvals, audit

### 8.1 Unit of account is not payment rail

Two separate concerns, deliberately decoupled (Max, 2026-08-11):

- **Unit of account: EUR** (USDC as the crypto-native equivalent). All agent budgets, costs and
  routing telemetry are denominated here. One unit, everywhere, always.
- **Payment rail: pluggable.** Stripe for subscriptions at launch; USDC onchain; **Röbel Münzen as
  an alternative rail for Röbel businesses and public organisations only.**

Münzen is one instance of a general slot, not a special case — a community-derived local currency
among many that will follow. Any Autar deployer could later issue their own. **That generality is
deliberately not built now**; keeping the launch simple means EUR budgets and Stripe subscriptions,
with the rail abstraction present so the later ones are additions rather than a rewrite.

### 8.2 Mechanics

- **Every agent carries a budget** declared in its profile (per week, denominated in EUR). The
  orchestrator refuses dispatch that would exceed it and posts an approval card instead.
- **Approval cards are the human surface.** Approve / reject / iterate, in-thread. Rejections are
  logged against the routing decision (§4.4), not only the artifact.
- **The decision queue** batches cards so Max clears a week in one sitting — §5g M2, and §13c's
  founder rhythm implemented in software.
- **Audit is the event log.** Every dispatch, engine choice, cost and approval is a signed Nostr
  event. There is no separate audit database to fall out of sync.

## 9. Data classification and privacy posture

Each engine in the registry carries a **data-classification ceiling**; each channel and agent carries
a classification. The router refuses to send data above an engine's ceiling.

| Class | Examples | Allowed engines |
|---|---|---|
| `public` | published marketing copy, public record | any registered engine |
| `internal` | drafts, internal strategy | any registered engine |
| `sensitive` | member data, org financials, citizen or municipal data | **self-hosted only** |

This is what makes open weights load-bearing rather than a price optimisation: the *same* GLM-5.2
running on our own German hardware serves `sensitive` work that no hosted endpoint may touch. The
DPIA problem is designed out rather than managed.

**Honest privacy copy, non-negotiable in every surface:**

- Channels are **relay-gated, not E2EE.**
- **DMs are encrypted** — NIP-17 gift-wrapped.
- **E2EE documents** come from the Fileverse plane (B2), not from chat.
- No surface may imply channel E2EE.

## 10. What we deliberately do not build

- **E2EE group chat.** Marmot / NIP-EE is not production-grade. Watch, do not build.
- **Cross-org federated channels.** NIP-29 groups live on one relay; the ICP is single-org. Revisit
  when a real second org asks.
- **A Matrix bridge.** Unification is at identity. No message bridges, ever.
- **Our own media stack.** LiveKit SDKs handle media; we build the call *UI*, not the SFU.
- **A from-scratch harness.** Harnesses are adopted per agent role, not written.
- **Slack/Teams bridges, retention tooling, moderation suites.** Line A's customer, not Autar's.

## 11. Testing and verification

- **The scenario is the acceptance test.** A meeting with Max + one contributor + one agent that
  produces a transcript file, a summary message and at least one approved follow-up is the pass
  condition. Anything less is not M-complete.
- **Router tests are cost tests.** Assert that a known-shape request never triggers a slow-path model
  call, and that the logged cost of a summary job stays under a fixed ceiling.
- **Latency tests are budget tests.** Assert measured TTFT for an in-call answer stays under the
  surface's budget (§5.2) with the cache warm *and* cold, and that a route exceeding its budget is
  rejected at dispatch rather than discovered by a waiting human.
- **Classification tests are refusal tests.** Assert the router refuses a `sensitive` payload against
  a hosted engine, including on fallback paths (§4.4) — the fallback is where this leaks.
- **Guest-link tests** cover expiry, single-use, revocation, that `share_history` defaults to off, and
  that a guest cannot read channel history from before the invite unless the flag was set.
- **Transparency tests.** Assert the agent appears in the participant roster whenever it is in a
  call, and that the join screen shows the transcription notice before the join button is reachable.
  A regression here is a legal problem, not a cosmetic one.
- **Deletion tests.** Assert a NIP-09 request from the agent removes the transcript from the relay
  store, and that the operator hard-delete path works **without** the agent's signature.
- **No claim of completion without the command output.** Standing verification rule.

## 12. Decomposition — follow-on specs

| Spec | Covers | Depends on |
|---|---|---|
| `autar-client-shell` | The Expo client: navigation, thread view, agent presence, approval cards, design language, Electron packaging | this spec §14 |
| `autar-calls` | LiveKit integration, guest join, agent participant, recording and retention | this spec |
| `autar-engine-registry` | Manifest schema, installer rendering, self-hosted GLM on the GPU node, LiteLLM wiring, flash-tier benchmarking | this spec §5.5 |
| `autar-agent-roster` | Per-agent charters, tool adapters, the marketing and bureaucracy tool bus | this spec §7 |
| `autar-roebel-embed` | The org-dashboard embed, CitizenNFT→membership provisioning, German-first surface | client shell |
| `autar-documents` | Fileverse plane, E2EE documents and sheets | independent |

## 13. Resolved by Max (2026-08-11)

All six questions from the first draft are closed. Recorded here because the reasoning matters more
than the answers.

1. **Budgets in EUR** (USDC equivalent), payment rails pluggable, Stripe for subscriptions, Münzen
   only as an alternative rail for Röbel businesses and public organisations. **Keep the launch
   simple** — see §8.1.
2. **Transcripts authored by the agent account**, deleted via NIP-09, enforceable because the relay
   is ours, with an operator hard-delete path for erasure rights — see §6.3.
3. **A meeting creates its own channel**, so guest history is a non-question by default; an explicit
   `share_history` flag covers invites into existing channels — see §6.2.
4. **Output mode is user-selectable per channel** — speak, post, or both.
5. **Two dogfood targets, one per door** (§14).
6. **The `sensitive` + live trade-off dissolves** once the in-call agent is split by question type
   rather than data class — see §5.4.

## 14. Client architecture — one codebase, all platforms

**Decision (Max, 2026-08-11): a single Expo codebase targeting every platform from the beginning,
with Electron for desktop.** Not phased, not split.

**Rationale — drift, not polish.** The failure mode that kills a solo-maintained cross-platform
product is not a slightly-off scrollbar; it is two codebases falling out of sync until keeping them
current becomes the whole job. One codebase is worth accepting a lower ceiling on desktop-specific
interaction, and the ceiling is manageable (below).

| Target | Path |
|---|---|
| Web · PWA | Expo Router + react-native-web, `output: single` |
| iOS · Android | EAS build |
| macOS · Windows · Linux | **Electron** wrapping the Expo web export |

### 14.1 Electron over Tauri — decided on the call stack

Tauri wins on binary size (3–10MB vs 85–150MB) and memory, and upstream Buzz's own desktop client is
Tauri + React. Autar still takes Electron, for one reason: **Tauri renders in the OS webview** —
WKWebView, WebView2, and **WebKitGTK on Linux**, where WebRTC support (screen sharing, codec
coverage, device enumeration) is historically weakest. **Electron bundles Chromium**, so the desktop
WebRTC stack is identical to the one developed and tested in the browser.

When the north-star scenario is *a meeting works*, call predictability outranks binary size. Slack,
Discord, Teams and VS Code all ship Electron for the same reason. Revisit only if Tauri's Linux
media story demonstrably closes.

### 14.2 Deliberate platform splits

One codebase does not mean zero platform code. These four splits are planned, bounded, and reviewed —
anything beyond them is drift and gets rejected:

| Split | Why it is unavoidable | Containment |
|---|---|---|
| **Call layer** | LiveKit ships separate SDKs: `@livekit/react-native` and `livekit-client` | One `CallProvider` interface, two implementations. Requires a dev/EAS build — not Expo Go |
| **Chat list virtualization** | `FlatList` on web underperforms real windowing; chat history is the stress case | Platform-split that single component |
| **Desktop interaction** | Keyboard shortcuts, context menus, text selection, drag-and-drop | `Platform.OS === 'web'` escape hatches with raw DOM handlers |
| **Marketing site** | autar.xyz must not ship the app bundle | A small separate static site. A landing page is not a second app codebase |

### 14.3 One styling system, unlike Röbel

Autar uses **`StyleSheet.create()` + `useTheme()` on every platform, web included.** Röbel carries
two systems (Tailwind on web, StyleSheet in Expo) and the NativeWind attempt to unify them broke the
app and was reverted. Autar starts on the far side of that problem and **must not** acquire a second
styling system.

### 14.4 Tuition already paid in this repo

These traps are known from `apps/expo` and transfer directly — re-learning them would be waste:

- **`app.config.ts` is authoritative**; `app.json` is ignored. Config bakes at EAS build time, not
  via OTA.
- **PWA head tags ship via `public/index.html`** — `+html.tsx` is unused at `output: single`.
- **Service worker must precache entry scripts** or offline never boots.
- **Metro workspace imports must be extensionless**; a `.js` suffix breaks `eas update` silently.
- **Max runs EAS builds and updates himself.** Done means committed and pushed — never run
  `eas update` unasked.

## 15. Dogfood targets — both doors in parallel

§5g sequenced the doors (audience-of-one first, Röbel orgs later). Max's answer runs them **in
parallel**, which tests both ICPs at once and gives the community door a named first business:

| Target | Door | What it proves |
|---|---|---|
| **MüritzPhone** — a business account in Röbel/Müritz | Community door (§5g door 2) | The real small-business case: marketing, bureaucracy, outreach. German-first, no visible key management, no client install |
| **Netizen Labs itself** | Direct door (§5g door 1) | The larger-org case: meetings, strategy, planning, a codebase. English-first |

The two targets exercise different halves of the tool bus (§7) — MüritzPhone leans on the marketing
and bureaucracy agents, Netizen Labs on strategy, meetings and dev. Neither alone would surface the
gaps in the other.
