# NSP-12 Public Decision Record — the EIP pipeline as a civic event grammar

**Date:** 2026-07-31
**Status:** DRAFT — design only; no implementation in this slice
**Follows:** [Nostr Citizen identity bridge](2026-07-27-nostr-citizen-identity-bridge-design.md), [NSP-9 federation](2026-07-27-nsp9-federation-design.md), proposal pointers (kind 32100, shipped in `packages/publisher`), [fork-with-fallback](2026-07-31-fork-with-fallback-design.md)
**Companion post:** `Netizen-Labs/apps/web/content/writing/2026-07-31-what-towns-can-learn-from-ethereum-governance.md`

---

## 0. Why this spec

Ethereum runs the largest functioning digital governance system in the world without a
single binding vote. Its actual mechanism is three-layered: a **legible proposal pipeline**
(EIP-1 lifecycle, editors who gatekeep process but never content), **rough consensus among
the people who must implement changes** (client teams; a proposal ships only when an
implementer commits), and **exit rights** (node operators can decline to upgrade;
communities can fork with the state). Since 2025 the Ethereum Foundation added a fourth
layer that turned out to be the most transferable: **legibility tooling**. Forkcast gives
every proposal a plain-language page with per-stakeholder impact, publishes call
transcripts within about two hours, names a champion per proposal, and enforces headliner
discipline (one big thing per upgrade cycle, pitched in an open, calendarized window).

Two lessons drive this design:

1. **The coordination layer is the product, not the vote.** A German Kommune cannot and
   should not move formal decisions out of the Stadtvertretung — and Ethereum's model
   never asks for that. AllCoreDevs does not bind node operators either. What transfers is
   legitimate advisory infrastructure: the pipeline, the record, the translation layer.
2. **Process tooling must outlive its operator.** In July 2026 the EF dissolved the team
   that ran Forkcast and the core-dev calls; maintenance of the tooling is now an open
   question. The Netizen answer is structural: encode the process in the protocol
   (this spec) and the installer (manifest-rendered, per the standing rule that everything
   on a node ships through `netizen render`/`up`), so any node operator — including the
   community itself — can keep the process alive without Netizen Labs.

The number: NSP-10 is the indexer, NSP-11 is operations. The Public Decision Record is
**NSP-12**.

## 1. Scope

**In.**
- The event grammar: kinds, tags, and lifecycle for proposals, status transitions,
  meeting records, Meinungsbild results, impact summaries, and decision cycles.
- Roles and keys: editor-agents, impact-agents, champions, implementers, facilitators.
- The manifest surface (NSP-0) and how NSP-10 (indexer), NSP-9 (federation), and the
  agent-watcher consume it.
- Legal rails: advisory-only framing, AI Act Art. 50 labeling, GDPR posture.

**Out**, each deliberately:

| Deferred | Why |
|---|---|
| Binding on-chain votes | Never in scope. Formal decisions stay with the Stadtvertretung; the record mirrors outcomes, it does not produce them. |
| MACI / coordinator-as-a-service internals | Owned by the [coordinator-as-a-service spec](2026-07-31-coordinator-as-a-service-design.md). NSP-12 only defines the *result pointer* event. |
| Meetings plane (calls, transcripts, recording) | Owned by the [Netizen Workspace meetings spec](2026-07-31-netizen-workspace-meetings-ai-design.md) (NSP-7 surface). NSP-12 takes pointers to transcripts, it does not produce them. |
| Honorariums / contributor funding | The Gemeinschaftskasse and Münzen tips already exist; wiring champion rewards is a later, separate decision. |
| New explorer UI build | The explorer page set ("Vorhaben") is sketched here as a consumer but implemented in its own slice. |
| Cross-community proposal portability | Needs the federation trust model from NSP-9 slice 2+. The grammar is shaped so records mirror cleanly, nothing more. |

**Success condition.** A proposal born in the Röbel app exists as a kind-32100 head with a
signed, append-only transition trail, an agent-labeled plain-language impact summary, and
(where run) a Meinungsbild result — all resolvable from the explorer without Supabase
(fork-with-fallback holds), and reproducible on testnode from the manifest alone.

## 2. The lifecycle

German-first stage names, mapped from EIP-1 + EIP-7723. The record never claims decision
power: stages that imply a formal act (`beschlossen`, `abgelehnt`) may only be entered by
mirroring a signed civic notice (kind 32102) from the body that made the decision.

| Stage | EIP analog | Who may move it here | Meaning |
|---|---|---|---|
| `idee` | Idea | any citizen npub | Untracked sketch; becomes tracked when an editor-agent confirms completeness |
| `entwurf` | Draft | editor-agent (process check only) | Structurally complete: problem, proposal, affected parties named |
| `diskussion` | Review | author | Author declares it ready; open deliberation thread |
| `meinungsbild` | Last Call | facilitator (human) | Advisory MACI signal runs; result published as kind 32104 |
| `beschlussvorlage` | Scheduled for Inclusion | implementer | An implementer (Verwaltung, Stadtwerke, Verein) has committed a champion and capacity; forwarded to the formal body |
| `beschlossen` / `abgelehnt` | Included / Declined | mirror of kind-32102 civic notice only | The formal body decided; the record cites the notice |
| `umgesetzt` | Deployed | implementer | Done and verifiable |
| `ruhend` | Stagnant | editor-agent (mechanical: 6 months without activity) | Parked, revivable |
| `zurueckgezogen` | Withdrawn | author | Permanent; also the GDPR withdrawal path (§8) |

Rules carried over from Ethereum verbatim because they are the load-bearing ones:

- **Editors gatekeep process, never content.** An editor-agent may request missing fields,
  deduplicate, translate, and park stale drafts. It may never score, rank, or reject an
  idea on merit. This is EIP-1's editor mandate, and it is exactly the mandate an AI agent
  can hold accountably: mechanical, neutral, auditable.
- **Implementer commitment is the gate**, not enthusiasm. `beschlussvorlage` requires a
  named implementer champion — the analog of "client devs signal intent to implement."
- **Facilitation stays human.** Agents structure and translate; a human facilitator runs
  Meinungsbild windows and cycle scoping.

## 3. Event grammar

Existing kinds stay untouched: 32100 proposal head (shipped), 32101 menu, 32102 civic
notice. New kinds below are **provisional**; final numbers are claimed in
`packages/publisher/src/mappers.ts` at implementation time, which is the kind registry of
record. All are addressable (parameterized-replaceable) except the transition, which is a
regular immutable event — the audit trail must not be rewritable.

| Kind | Name | Form | Content |
|---|---|---|---|
| 32100 | Proposal head (exists, extended) | addressable, `d` = proposal slug | Markdown abstract + motivation. New tags: `status` (stage from §2), `champion` (`p` tag with role marker), `cycle` (`a` tag to 32106) |
| 2100 | Status transition | **regular, immutable** | `a` tag to the head, `from`/`to` stage tags, free-text reason, signed by whoever §2 authorizes for that transition. For `beschlossen`/`abgelehnt`: an `a` tag citing the 32102 civic notice is mandatory |
| 32103 | Meeting record | addressable, `d` = `<body>-<date>` | Agenda published before the meeting, minutes and transcript pointers after (pointers into the workspace plane, NSP-7) |
| 32104 | Meinungsbild result | addressable, `d` = poll id | MACI tally pointer, parameters (threshold band, anonymity-set size), verification pointer, and an explicit `advisory` tag — always |
| 32105 | Impact summary | addressable, `d` = `<proposal-slug>-<audience>` | "Was bedeutet das für dich" per stakeholder group (`anwohner`, `gewerbe`, `vereine`, `verwaltung`), authored by a labeled agent npub |
| 32106 | Decision cycle | addressable, `d` = cycle slug (e.g. `massnahmen-2027`) | The Meta-EIP analog: list of `a` tags to proposal heads, each with a stage marker (`vorgeschlagen` / `in-pruefung` / `eingeplant` / `nicht-aufgenommen` — the PFI/CFI/SFI/DFI mapping), plus the headliner designation and the pitch-window dates |

Head example (abridged):

```json
{
  "kind": 32100,
  "tags": [
    ["d", "radweg-seeufer"],
    ["title", "Radweg am Seeufer"],
    ["status", "beschlussvorlage"],
    ["p", "<champion-npub-hex>", "", "champion"],
    ["a", "32106:<node-pubkey>:massnahmen-2027", "", "cycle"]
  ],
  "content": "## Problem\n…\n## Vorschlag\n…"
}
```

**Reference rule (hard):** every cross-reference to a status-bearing document is an `a` tag
(`kind:pubkey:d-tag`), resolved at render time — never an event id. We have already been
burned by replaceable-event id links going stale; NSP-12 makes the addressable form the
only legal citation between decision-record events.

**Deliberation** needs no new kind: replies to the head via standard NIP-10 threading are
the discussion thread, and the explorer renders them under the proposal page.

## 4. Roles and keys

| Role | Key | Mandate | Bounds |
|---|---|---|---|
| Editor-agent | agent npub, NIP-24 `bot: true`, Art. 50 label | EIP-1 editor rule: completeness, dedup, translation, mechanical stage moves (`entwurf`, `ruhend`) | Pinned role in the agent-watcher; kinds and rate bounds in the manifest |
| Impact-agent | agent npub, labeled | Writes 32105 per stakeholder group when a head enters `diskussion` or any later stage, and refreshes on head edits after that point | Same watcher bounds; output always attributed and filterable by key |
| Champion | citizen npub (identity bridge) | Single accountable point of contact per proposal, named in the head | Human only |
| Implementer | org npub (Verwaltung, Stadtwerke, Verein) | Signs the `beschlussvorlage` transition; publishes `umgesetzt` | Human-operated org keys |
| Facilitator | human npub | Opens Meinungsbild windows, runs cycle scoping, chairs the process | Never an agent |

Every agent output is a signed event under the agent's own key: humans can audit, filter,
or ignore any agent wholesale. Display surfaces resolve keys to display names — raw
addresses never appear in UI (standing rule).

## 5. The cycle — Maßnahmenpaket with headliner discipline

One 32106 event per planning cycle (typically the Haushaltsjahr). Imported from Ethereum's
2025 process because it solved scope creep in a body with limited implementer capacity —
which describes a small town better than it describes Ethereum:

- **At most one headliner per cycle**: the single big project, chosen first, everything
  else scoped only after the headliner is stable.
- **Open, calendarized pitch window**: dates live in the 32106 event itself. A pitch must
  name the problem, the affected groups, the rough cost, and a would-be champion — the
  same four things Ethereum requires of headliner pitches (need, impact, readiness,
  champion).
- **Stages are re-proposed each cycle**: a proposal not `eingeplant` this cycle does not
  carry over silently; it re-enters next cycle's window. Nothing rots in a backlog
  invisibly.

## 6. Meinungsbild rail

The 32104 result event is a *pointer*, not a tally system: MACI poll id, the published
tally, its verification artifacts, and the parameters that make the signal honest
(threshold band, anonymity-set size). Two hard rules:

1. The `advisory` tag is mandatory and the explorer renders the advisory framing
   unconditionally. Wording is "Meinungsbild", never "Abstimmung" (standing legal rule).
2. A 32104 may only be published by the coordinator pipeline after tally verification —
   the same signed path the coordinator already uses, no manual results.

## 7. Manifest and installer surface

Everything above is configuration, rendered by `netizen render`/`up` — nothing hand-wired.
Sketch of the NSP-0 block:

```json
"record": {
  "decisions": {
    "kinds": { "head": 32100, "transition": 2100, "meeting": 32103,
               "meinungsbild": 32104, "impact": 32105, "cycle": 32106 },
    "agents": {
      "editor": { "npub": "<npub>", "staleAfterDays": 180 },
      "impact": { "npub": "<npub>", "audiences": ["anwohner", "gewerbe", "vereine", "verwaltung"] }
    },
    "bodies": [ { "id": "stadtvertretung", "noticeAuthor": "<org-npub>" } ],
    "cycle": { "current": "massnahmen-2027" }
  }
}
```

Touchpoints, all additive:
- **NSP-10 indexer**: the six kinds join the indexed set (kind widening is a visible
  manifest edit, per existing rule).
- **Agent-watcher**: `editor` and `impact` become pinned roles with the standard bounds.
- **NSP-9 federation**: peers may mirror the decision kinds like any public civic kind;
  a town's governance record becomes mirrorable the way archive nodes mirror chains.
- **Explorer / Atlas**: a "Vorhaben" page set — per-proposal page with status, transition
  trail, impact summaries, thread, and Meinungsbild result; per-cycle page with the
  headliner and stage matrix. This is the Forkcast-shaped surface.

## 8. Legal rails

- **Advisory only, everywhere.** The record informs the formal process; `beschlossen` /
  `abgelehnt` enter the record exclusively by citing the signed 32102 notice. Public
  framing follows the standing rule: civic technology, never a "Blockchain-Verwaltungsprojekt".
- **AI Act Art. 50**: every agent-authored event carries the already-implemented labeling;
  the explorer renders the AI disclosure on 32105 and any agent-signed transition.
- **GDPR**: proposals are voluntarily published public civic content; the only personal
  data is the author's key and chosen display name. Withdrawal = `zurueckgezogen`
  transition plus deletion honored on the authoring relay; mirrors follow the NSP-9
  write-policy behavior. Impact summaries and meeting records must not name private
  individuals.

## 9. Slices (each gets its own plan; none started by this spec)

1. **Grammar**: NSP-12 zod schemas in `@netizen-labs/protocol`, kind constants + mappers
   in `packages/publisher`, transition-trail validation.
2. **Editor-agent**: pinned watcher role, completeness checks, dedup, `ruhend` sweep,
   labeling.
3. **Explorer "Vorhaben"**: per-proposal and per-cycle pages on the index/Atlas surface,
   NIP-10 thread rendering, advisory framing for 32104.
4. **First cycle**: publish `massnahmen-2027` as a 32106 with a real pitch window, and run
   one proposal end-to-end through the pipeline in Röbel — the dogfood exit test.

## 10. Open questions (for the user, not blockers to slice 1)

- Should meeting records (32103) start with the Stadtvertretung's public agendas only, or
  also include Vereins-/Ausschuss meetings from day one?
- Does the champion role require citizen-tier identity, or is resident-tier enough?
- Cycle cadence: strictly the Haushaltsjahr, or a shorter first cycle to dogfood the
  pipeline before budget season?
