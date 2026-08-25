# City-neutral civic journey architecture map

This is the navigation page for the discussion-to-outcome work. It records
where the durable language, decisions, implementation specification, code,
and operations live so a future slice extends the same journey instead of
creating another parallel demo. Röbel is the first concrete application and
staging tracer; municipalities, application frontends, Kair/openDesk, and
publication adapters remain deployment choices around a city-neutral protocol.

## Testability checkpoint at 2026-08-25

The complete journey is **not yet accepted end to end in Talos staging**. The
code candidates and authority boundaries are substantially ahead of the live
deployment:

| Boundary | Current fact | Gate to the first whole-flow browser test |
| --- | --- | --- |
| Reviewed source | Application source `7f691b4de76c15cf72c18dc12f86003399015be0` is live as Web digest `sha256:e6a8b2f26acc1f22c5f8e13ea78d5355331a2d584bb1547614c286407806fdef`; Public Mecky is live as `sha256:2a47e…c46826`. | Publish the participant-gateway source and one reviewed Web UI integration as separate immutable components. |
| Talos delivery | Flux owns the reviewed Web and Public Mecky resources. The public Web remains read-only: `GET`/`HEAD` plus exact `POST /api/chat/mecky`. | Add a separately owned, namespace-scoped participant gateway and route only its five exact method/path pairs; keep rollback to the current Release Set. |
| Existing Web | The public app, post details, proposal view and exact Mecky chat respond. The Web pod has no database writer credential by design. | Point the constrained participant UI at the separate gateway and pass feed/post-detail semantic QA. |
| Thirdweb staging login | A real browser-public client ID is live. Google sign-in completes and a connected ephemeral guest profile loads; that account is correctly not a verified citizen. | Prove its EOA/ERC-1271/ERC-6492 wallet signature at the gateway, then write only through the bounded staging capability. |
| Staging participant gateway | ADR 0021 fixes the isolated write boundary; package, restricted database functions, immutable image and GitOps resources are in progress. | Deploy it, create one text post/comment, revoke the admission, and prove the next write fails. |
| Public Mecky | The live endpoint answers behind the exact chat boundary with the reviewed evidence policy and no civic authority. | Bind one participant post/mention to the signed-Nostr workbench and prove one same-thread, citation-bound reply. |
| Case Steward admission | The public Stadtstack repository contains the atomic signed-topic admission kernel; the current source candidate adds a municipality-scoped asynchronous control contract, atomic durable-port requirement and a separately typed GET-only binding reader. No listener, durable root-claim/outbox adapter, staff console, public deployment or GitOps resources exist yet. Public admission/completion commands are removed; one legacy server-side token remains only for the diagnostic administration read. | Complete ADR 0019 with separate staff/public deployables, staff authentication, transactional root claim and outbox replay, credential-free public read, token removal and browser acceptance. |
| Sovereign identity | The provider-neutral `CitizenSession`, structural Safe adapter, dual-control proof envelope and effect-free three-proof verifier exist. | WebAuthn creation/recovery, real Safe deployment/control, Pimlico execution, authenticated route, durable multi-replica challenges, stable member/credential persistence and opt-in deployed E2E are still required. |

The first integrated acceptance therefore uses the existing Thirdweb adapter;
the passkey-owned Safe is a subsequent opt-in coexistence test, not a claimed
prerequisite that silently delays the civic journey. The live execution
checklist is [Stadtstack issue #25](https://github.com/GiraeffleAeffle/stadtstack/issues/25).

## Product position

The Röbel app is a general local social app first. A post about an event, a business, a personal observation, or local news remains a normal post. When a person identifies a shared problem or wants a structured public process, they explicitly promote that signed post into a civic topic or discussion.

Röbel is the reference public experience for the active tracer. No Röbel,
Strausberg, or other city-specific identifier belongs in the interoperability
contract; city names and IDs in tests are fixtures, not protocol constants.

The resulting civic journey stays visible as one attributable line:

```text
ordinary post
  ├─ remains ordinary
  ├─ joins an existing civic topic
  └─ creates a civic topic
         └─ structured discussion
              └─ reviewed Mecky assistance
                   └─ participant-signed suggestion (when not yet a citizen)
                        └─ citizen-credential adoption / citizen-signed candidate
                             └─ human-admitted civic case
                                  └─ bounded municipal context package
                                       └─ municipality-operated Kair/openDesk work
                                            └─ attributable official publication + receipt
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
| [ADR 0013](adr/0013-canonical-civic-topics-and-projection-only-feed-cleanup.md)      | accepted for staging        | Group promoted activity without deleting or rewriting signed events.                             |
| [ADR 0014](adr/0014-provider-neutral-member-identity-and-staged-wallet-migration.md) | accepted for staging design | Treat wallets as credentials and migrate Thirdweb through a provider-neutral session seam.       |
| [ADR 0015](adr/0015-one-civic-journey-with-embedded-stage-tools.md)                  | accepted for staging        | Make Röbel own the journey while mini-apps remain scoped, replaceable stage tools.               |
| [ADR 0016](adr/0016-review-gated-public-knowledge-and-attributed-community-context.md) | accepted for staging      | Separate source admission from authority across conversation, news, RIS, and reviewed cases.     |
| [ADR 0017](adr/0017-reviewed-public-knowledge-projection.md)                           | accepted for staging      | Consume explicitly enabled reviewed news/RIS projections through checksum-bound GET-only adapters. |
| [ADR 0018](adr/0018-separate-public-journey-and-operator-console-build-boundaries.md)  | proposed                  | Separate the public journey from privileged operator routes so authority and builds scale independently. |
| [ADR 0019](adr/0019-role-isolated-case-steward-admission-and-public-binding-receipts.md) | accepted boundary; deployment pending | Keep Civic Case admission out of the public Web and advance the journey through a public-safe binding receipt. |
| [ADR 0020](adr/0020-event-driven-attested-release-handoff.md)                         | proposed; bootstrap pending | Replace cron-only staging promotion latency with an exact, attested event handoff while retaining protected human review and recovery paths. |
| [ADR 0021](adr/0021-bounded-staging-participant-gateway.md)                           | accepted boundary; deployment pending | Let an invited real account exercise the staging feed without putting write authority or citizen claims in the public Web. |
| [ADR 0022](adr/0022-author-confirmed-topic-candidate-tracer.md)                       | accepted boundary; implementation pending | Promote one existing signed source note through two closed author-only operations into a topic root and participant suggestion; citizen adoption remains a separate identity transition. |

Canonical terms live in [`CONTEXT.md`](../CONTEXT.md). The integrated staging contract lives in [`2026-08-13-real-staging-topic-identity-and-administration-flow.md`](superpowers/specs/2026-08-13-real-staging-topic-identity-and-administration-flow.md).

## Product surfaces

| Surface              | Owns                                                            | Must not own                                                   |
| -------------------- | --------------------------------------------------------------- | -------------------------------------------------------------- |
| General Röbel feed   | ordinary posts plus projected topic activity                    | automatic civic classification or duplicate topic roots        |
| Post detail          | signed content, replies, “Als Thema weiterführen” action        | proposal/case state                                            |
| Civic journey        | stable topic header, stages, provenance, navigation             | authority belonging to administration, governance, or treasury |
| Discussion stage     | signed root/replies, argument tree and sunburst                 | votes or administrative conclusions                            |
| Mecky stage          | reviewed evidence, citations, uncertainty, suggested actions    | human signatures or official positions                         |
| Participant gateway  | short-lived wallet proof and constrained staging text post/comment writes | citizenship, organisation identity, Case, vote, treasury, administration, or broad Web mutation |
| Suggestion/proposal stage | exact derivation, participant suggestion, and separate citizen adoption/signature | treating an invite as citizenship, admission credentials, or silent promotion from social content |
| Case Steward console | staff-authenticated admission and its exact public receipt         | public social posting, Mecky output, later administrative approval |
| Municipal workspace adapter | human administrative work in Kair/openDesk (or equivalent) plus returned municipality-attributed publications/receipts | public discussion ownership or self-created municipal authority |
| Röbel Data mini-app  | bounded governance/budget exploration within a stage            | canonical topic/case state or treasury execution               |
| Mitmachen            | case-bound Citizen Brief, budget context, advisory participation | detached profiles, ambiguous votes, or treasury authority      |

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

This statement describes the Thirdweb-backed adapter and proof contract. It
does not mean that a passkey has been enrolled, a Safe has been deployed or
controlled, or a Pimlico bundler/paymaster has executed a user operation in
Röbel staging. Those are explicit Slice 7 effects and remain pending.

The existing `accounts` table remains the authored actor. New stable member and credential mappings are introduced beside it; existing wallet-keyed tables remain compatibility projections during migration. This avoids duplicating a person when a Safe address differs from the Thirdweb smart-account address.

The detailed account-replacement and sovereign-root investigations remain in:

- [`K1 — Netizen Accounts replaces Thirdweb`](kickoffs/2026-08-11_K1_NETIZEN_ACCOUNTS_REPLACES_THIRDWEB.md)
- [`K3 — Identity inversion`](kickoffs/2026-08-11_K3_IDENTITY_INVERSION.md)

ADR 0014 narrows their first implementation move: introduce the session seam and coexistence model before choosing an irreversible address/asset migration.

The current passkey/Safe code in Röbel is therefore an interface and
verification scaffold, not an installed wallet implementation. ADR 0014 now
divides the opt-in work into authenticated no-effect verification,
stable-member persistence, a real WebAuthn/Safe/Pimlico adapter, and explicit
recovery/coexistence E2E. Copying the Stadtstack passkey account file wholesale
is rejected because it mixes those provider mechanics with unrelated civic and
local-development concerns.

## Delivery performance seam

The current public image compiles a 300-page source inventory, including 76
`admin` and 111 `dashboard` pages. A measured two-to-four
webpack-parallelism change saved only five seconds across the exact Next build,
while compiler-cache and Turbopack candidates were slower, materially larger,
or failed page-data collection. [ADR 0018](adr/0018-separate-public-journey-and-operator-console-build-boundaries.md)
therefore records the proposed durable boundary: keep one repository and one
domain model, but extract the privileged operator console into its own
least-privilege deployable after the first complete civic tracer passes.

This proposal does not delay namespace-scoped Flux. The existing Web and Mecky
digests remain the first adoption targets; compiler-worker experiments are
accepted only when an isolated no-publish run demonstrates a material gain.

## Repository and operational ownership

| Concern                                                | Source of truth                                                        |
| ------------------------------------------------------ | ---------------------------------------------------------------------- |
| Röbel feed, post promotion, journey UX, login adapters | public Röbel App repository                                            |
| Bounded real-account staging writes                    | participant gateway package plus separately scoped private GitOps owner |
| Signed Nostr posts and discussion graph                | configured public/staging relay plus idempotent publication ledger     |
| Mecky evidence/reply policy                            | public contract and private reviewed runtime configuration             |
| Civic case and deterministic transitions               | Stadtstack coordinator/runtime                                         |
| Administration work and publication                    | municipality-operated Kair/openDesk (or equivalent) through an idempotent case-package and official-publication return adapter |
| Governance and treasury                                | their own reviewed contracts and signer policies; projected into Röbel |
| Talos deployment, secrets, immutable digests           | private operations repository reconciled by namespace-scoped Flux      |

No public application repository receives cluster-admin credentials or secret values.

## Vertical slices

| Slice                                | User-visible exit test                                                                                                                             | State                                                                                                                                                                                              |
| ------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0. Vocabulary and boundaries         | One reviewed definition of post, topic, discussion, proposal, case, vote, and treasury state                                                       | documented in this branch                                                                                                                                                                          |
| 1. General signed feed               | A real staging account publishes an ordinary signed Nostr post in the normal feed                                                                  | real Thirdweb login is live; bounded Supabase post/comment gateway is the active tracer seam, followed by wallet-to-Nostr binding and deployed browser E2E                                         |
| 2. Explicit civic promotion          | The user attaches that post to a topic or creates a discussion; the source remains attributable                                                    | browser-signed author-only promotion, grouped feed activity, and a canonical topic hub are implemented; ADR 0022's two closed writer operations end in a `citizen_adoption_required` participant suggestion, with one-source/one-root retry claims, exact conversation provenance, and a deployment-configured source-row resolver still pending |
| 3. Real Mecky loop                   | The user tags Mecky and receives one evidence-bound signed reply in the same thread                                                                | signed source-bound direct mentions, per-request pending/answered projections, reviewed Civic Cases, and explicitly enabled checksum-bound news/RIS projections compose into one catalog; the durable request UI is merged and publishing, while connected-account browser E2E remains |
| 4. Citizen adoption, proposal, and admission | A verified citizen credential adopts/signs the suggestion; a separately authenticated Case Steward admits one idempotent civic case and the public journey reads its binding receipt | the provider-neutral session/signing seam and Stadtstack atomic admission kernel exist; the separate citizen-eligibility policy, new versioned adoption event that references the participant suggestion, role-isolated control service, staff console, public receipt projection, GitOps resources and deployed browser E2E remain. Existing direct `citizen_signed_topic_suggestion_v1` is not an adoption event. A separately typed synthetic adoption/Case tracer may test the UI but cannot satisfy this slice. |
| 5. Administration round trip         | One exact case package enters a municipality-operated workspace; municipal staff return reviewed feedback and an attributable official-publication receipt to the same journey | public-read candidate now binds reviewed package IDs and checksums to the exact case on its discussion and canonical topic; a real Kair/openDesk-equivalent return receipt and deployed browser E2E remain pending |
| 6. Brief, participation, and finance | Citizen Brief, advisory Mitmachen, and treasury review are visible together without implying authority                                             | exact case-bound Mitmachen reader and reviewed finance context implemented; participation input/result and deployed browser proof remain                                                           |
| 7. Identity coexistence              | A Thirdweb tester and a passkey/Safe tester use the same `CitizenSession` contract; one dual-proof link preserves an existing app account and npub | provider-neutral structural Safe adapter, short-lived dual-control proof, atomic challenge interface, and three-proof server verifier implemented without effects; ADR 0014 slices authenticated routing, durable storage, stable-member persistence, the real WebAuthn/Safe/Pimlico adapter, recovery and deployed opt-in E2E |
| 8. Formal authority                  | A separately accepted governance/treasury contract enables real effects                                                                            | explicitly deferred                                                                                                                                                                                |

Each slice must be idempotent, restartable, responsive on desktop/mobile, source-attributable, and deployable by immutable digest through the namespace-scoped GitOps path. A later slice cannot redefine identifiers or silently duplicate records created by an earlier slice.

The synthetic staging tracer is deliberately not counted as completing Slice 1
or 2. The real-account code path now exists, but completion still requires one
connected tester to exercise it against the deployed Gnosis verifier, durable
relay admission store, watcher, and normal Röbel feed.

## Execution order to the first accepted journey

1. Keep the now-working Thirdweb login behind the provider-neutral session
   seam; do not mislabel its unverified guest as a citizen.
2. Deploy ADR 0021's restricted participant database functions and gateway
   through a separate namespace-scoped Flux owner. Route only its five exact
   method/path pairs and retain the current Web/Mecky Release Set for rollback.
3. Let the connected tester create one ordinary text post/comment, then bind
   that same wallet to one signed Nostr post in the normal feed. Keep other
   timeline content ordinary.
4. Explicitly promote that source post into a canonical topic/discussion,
   exercise the pro/contra tree and sunburst, and tag Mecky in the same thread.
5. Require Mecky's signed answer to cite admitted public evidence and preserve
   uncertainty and no-authority boundaries.
6. Keep the participant-signed output at `citizen_adoption_required`. ADR
   0014 provides only the session and signing seam. For the authority-valid
   path, first accept a separate citizen-eligibility and adoption ADR, verify
   eligibility, adopt/re-sign the suggestion, and admit the candidate through
   a separately authenticated Case Steward console. Until then, the UI may use
   a separately typed synthetic candidate and isolated staging Case tracer,
   but neither may enter the real Case Steward validator or count as completing
   Slice 4. Require the public journey to advance
   only from the checksum-bound Case binding receipt. Send one bounded case
   package into a municipality-operated Kair/openDesk workspace, then accept
   only the attributable official publication and checksum-bound receipt
   returned by that municipality. Render the resulting Citizen Brief,
   advisory Mitmachen and finance context in the same journey.
7. Only after that tracer passes, add the passkey-owned Safe + Pimlico adapter
   as an opt-in coexistence path and prove that the same member, app account and
   npub are preserved without duplicating history.
