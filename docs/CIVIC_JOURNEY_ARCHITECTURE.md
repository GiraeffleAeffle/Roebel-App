# Röbel Civic Journey architecture map

This is the navigation page for the discussion-to-outcome work. It records where the durable language, decisions, implementation specification, code, and operations live so a future slice extends the same journey instead of creating another parallel demo.

## Product position

The Röbel app is a general local social app first. A post about an event, a business, a personal observation, or local news remains a normal post. When a person identifies a shared problem or wants a structured public process, they explicitly promote that signed post into a civic topic or discussion.

The resulting civic journey stays visible as one attributable line:

```text
ordinary post
  ├─ remains ordinary
  ├─ joins an existing civic topic
  └─ creates a civic topic
         └─ structured discussion
              └─ reviewed Mecky assistance
                   └─ citizen-signed proposal candidate
                        └─ human-admitted civic case
                             └─ administration / openDesk
                                  └─ Citizen Brief
                                       └─ advisory Mitmachen
                                            └─ authorized decision
                                                 └─ treasury / execution
                                                      └─ public outcome
```

Stages are connected through identifiers and receipts, not collapsed into one record. Governance and treasury remain separate authority gates even when they are shown in the same journey.

## Durable decisions

| Decision                                                                             | Status                      | Purpose                                                                                          |
| ------------------------------------------------------------------------------------ | --------------------------- | ------------------------------------------------------------------------------------------------ |
| [ADR 0011](adr/0011-native-nostr-discussion-and-civic-handoff.md)                    | accepted for staging        | Keep signed discussion and Mecky/case handoff native to the Röbel experience.                    |
| [ADR 0012](adr/0012-citizen-brief-governance-and-treasury-gates.md)                  | accepted boundary           | Keep Citizen Brief, advisory participation, binding governance, and treasury execution distinct. |
| [ADR 0013](adr/0013-canonical-civic-topics-and-projection-only-feed-cleanup.md)      | proposed                    | Group promoted activity without deleting or rewriting signed events.                             |
| [ADR 0014](adr/0014-provider-neutral-member-identity-and-staged-wallet-migration.md) | accepted for staging design | Treat wallets as credentials and migrate Thirdweb through a provider-neutral session seam.       |
| [ADR 0015](adr/0015-one-civic-journey-with-embedded-stage-tools.md)                  | accepted for staging design | Make Röbel own the journey while mini-apps remain scoped, replaceable stage tools.               |

Canonical terms live in [`CONTEXT.md`](../CONTEXT.md). The integrated staging contract lives in [`2026-08-13-real-staging-topic-identity-and-administration-flow.md`](superpowers/specs/2026-08-13-real-staging-topic-identity-and-administration-flow.md).

## Product surfaces

| Surface              | Owns                                                            | Must not own                                                   |
| -------------------- | --------------------------------------------------------------- | -------------------------------------------------------------- |
| General Röbel feed   | ordinary posts plus projected topic activity                    | automatic civic classification or duplicate topic roots        |
| Post detail          | signed content, replies, “Als Thema weiterführen” action        | proposal/case state                                            |
| Civic journey        | stable topic header, stages, provenance, navigation             | authority belonging to administration, governance, or treasury |
| Discussion stage     | signed root/replies, argument tree and sunburst                 | votes or administrative conclusions                            |
| Mecky stage          | reviewed evidence, citations, uncertainty, suggested actions    | human signatures or official positions                         |
| Proposal/case stages | exact derivation, signatures, admission and versions            | silent promotion from social content                           |
| openDesk adapter     | human administrative work and returned packages                 | public discussion ownership                                    |
| Röbel Data mini-app  | bounded governance/budget exploration within a stage            | canonical topic/case state or treasury execution               |
| Mitmachen            | advisory or explicitly authorized participation with clear mode | ambiguous “vote” semantics                                     |

## Identity modules

The current Thirdweb stack is retained behind the first `CitizenSession` adapter. The target shape is:

```text
MemberIdentity
  ├─ AccountCredential(thirdweb_smart_account)
  ├─ AccountCredential(passkey_safe)
  └─ controls AppAccount(personal or organisation)

AppAccount ──authors──> posts, comments, events
MemberIdentity ──private proof──> NostrIdentity
AccountCredential ──holds/controls──> address-bound rights
```

The first adapter is now implemented in the web app. `CitizenSession` derives
the client-held Nostr identity once, creates a mutual wallet/Nostr binding proof,
and signs bounded post or promotion events without exposing either secret. The
staging workbench verifies the wallet signature on Gnosis, verifies the Nostr
binding locally, and only then asks the relay's authenticated internal admission
endpoint to persist that public key. Synthetic personas remain a labelled test
fixture and are not used as a surrogate for a connected account.

The existing `accounts` table remains the authored actor. New stable member and credential mappings are introduced beside it; existing wallet-keyed tables remain compatibility projections during migration. This avoids duplicating a person when a Safe address differs from the Thirdweb smart-account address.

The detailed account-replacement and sovereign-root investigations remain in:

- [`K1 — Netizen Accounts replaces Thirdweb`](kickoffs/2026-08-11_K1_NETIZEN_ACCOUNTS_REPLACES_THIRDWEB.md)
- [`K3 — Identity inversion`](kickoffs/2026-08-11_K3_IDENTITY_INVERSION.md)

ADR 0014 narrows their first implementation move: introduce the session seam and coexistence model before choosing an irreversible address/asset migration.

## Repository and operational ownership

| Concern                                                | Source of truth                                                        |
| ------------------------------------------------------ | ---------------------------------------------------------------------- |
| Röbel feed, post promotion, journey UX, login adapters | public Röbel App repository                                            |
| Signed Nostr posts and discussion graph                | configured public/staging relay plus idempotent publication ledger     |
| Mecky evidence/reply policy                            | public contract and private reviewed runtime configuration             |
| Civic case and deterministic transitions               | Stadtstack coordinator/runtime                                         |
| Administration work                                    | openDesk through an idempotent outbox/return adapter                   |
| Governance and treasury                                | their own reviewed contracts and signer policies; projected into Röbel |
| Talos deployment, secrets, immutable digests           | private operations repository reconciled by namespace-scoped Flux      |

No public application repository receives cluster-admin credentials or secret values.

## Vertical slices

| Slice                                | User-visible exit test                                                                                                                             | State                                                                                                                                      |
| ------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| 0. Vocabulary and boundaries         | One reviewed definition of post, topic, discussion, proposal, case, vote, and treasury state                                                       | documented in this branch                                                                                                                  |
| 1. General signed feed               | A real staging account publishes an ordinary signed Nostr post in the normal feed                                                                  | Thirdweb-backed `CitizenSession`, dual-proof admission and pre-signed event path implemented; immutable deployment and browser E2E pending |
| 2. Explicit civic promotion          | The user attaches that post to a topic or creates a discussion; the source remains attributable                                                    | browser-signed source-preserving promotion implemented; immutable deployment and browser E2E pending                                       |
| 3. Real Mecky loop                   | The user tags Mecky and receives one evidence-bound signed reply in the same thread                                                                | after 1–2                                                                                                                                  |
| 4. Proposal and admission            | A human signs a proposal candidate; a separate human action admits one idempotent civic case                                                       | topic-bound citizen signing and isolated publication implemented; deployed browser E2E and separate human admission remain                |
| 5. Administration round trip         | One exact openDesk package returns reviewed feedback to the same journey                                                                           | after 4                                                                                                                                    |
| 6. Brief, participation, and finance | Citizen Brief, advisory Mitmachen, and treasury review are visible together without implying authority                                             | after 5                                                                                                                                    |
| 7. Identity coexistence              | A Thirdweb tester and a passkey/Safe tester use the same `CitizenSession` contract; one dual-proof link preserves an existing app account and npub | parallel after seam                                                                                                                        |
| 8. Formal authority                  | A separately accepted governance/treasury contract enables real effects                                                                            | explicitly deferred                                                                                                                        |

Each slice must be idempotent, restartable, responsive on desktop/mobile, source-attributable, and deployable by immutable digest through the namespace-scoped GitOps path. A later slice cannot redefine identifiers or silently duplicate records created by an earlier slice.

The synthetic staging tracer is deliberately not counted as completing Slice 1
or 2. The real-account code path now exists, but completion still requires one
connected tester to exercise it against the deployed Gnosis verifier, durable
relay admission store, watcher, and normal Röbel feed.
