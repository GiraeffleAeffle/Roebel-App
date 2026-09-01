# ADR 0023: City-neutral citizen eligibility and suggestion adoption

- Status: Accepted boundary for staging; protocol kernel, browser signer and read-side Case handoff contract implemented; issuer/gateway/ledger/Case writer pending
- Date: 2026-08-25

## Context

ADR 0022 ends with an attributable participant suggestion whose state is
`citizen_adoption_required`. A staging invitation, wallet signature, app
account, Nostr key, Thirdweb session, passkey, Safe, or Pimlico user operation
can prove control of a credential; none proves that the holder is eligible to
act as a citizen for one municipality.

Röbel already has Gnosis-chain CitizenNFT deployments and Web code that can
read them. Those contracts are useful as the first Röbel eligibility input,
but making their chain, address, wallet, or token semantics part of the public
civic protocol would make the flow Röbel-specific and publicly correlate a
person's app activity with an address. Other municipalities may instead use a
municipal identity provider, resident registry, in-person verification, or a
later standards-based credential.

The same civic journey must support both cases without treating eligibility as
proposal admission, a vote, a municipal decision, or treasury authority.

## Decision

The real Case Steward accepts only an exact
`eligible_citizen_adopted_topic_suggestion_v1` bundle. It carries the complete
evidence required by ADR 0019, not only copied identifiers:

1. the complete signed discussion-root event from ADR 0022;
2. the complete signed, reviewed Mecky-answer event bound to that root;
3. the immutable signed
   `staging_participant_signed_topic_suggestion_v1` event from ADR 0022;
4. one public-safe, issuer-signed
   `municipal_civic_eligibility_receipt_v1`; and
5. one `citizen_adopted_topic_suggestion_v1` Nostr event signed by the citizen
   key named by that receipt.

The Case Steward verifies every envelope and every root, answer, receipt,
topic, participant and adopter binding. ADR 0023 changes only the candidate
type and its derivation for this path. It does not weaken ADR 0019's signed
evidence, staff role, municipality-wide discussion-root claim, atomic journal
and outbox, or public binding-receipt requirements.

The checksum-bound adoption acceptance receipt is trusted ledger state, not a
sixth browser-supplied artifact. The Case Steward loads it from the configured
adoption ledger by exact adoption event ID and fails closed on absence,
duplication, checksum mismatch or event/receipt mismatch.

Joining them grants only eligibility to request Case Steward review. It does
not create a Civic Case, publish for a municipality, open a vote, grant voting
weight, or authorize a treasury effect.

### Municipality eligibility policy

Each deployment pins a versioned municipality policy outside the browser. The
policy names the municipality, accepted eligibility class, trusted issuer
keys, receipt lifetime, one status-resolver base path, maximum status age,
event clock skew, chain finality rule, and one or more private
credential-verifier adapters. Requests cannot select or override those values.

Eligibility issuance starts from a server-derived, authenticated
`CitizenSession`. The browser cannot submit or override an address for the
eligibility check. The issuer creates one short-lived challenge with a
cryptographically unguessable nonce, exact audience, issue time and expiry. It
binds the trusted authenticated provider subject/session identifier and
selected app account, active credential kind, chain and controlled address,
Nostr public key, municipality, policy version and exact participant
suggestion. When stable-member persistence from ADR 0014 exists, the challenge
also binds that member ID; it is not required for the first Thirdweb tracer.
The challenge store atomically consumes the nonce once. The active credential
and the Nostr key both sign the same canonical challenge. EOA, ERC-1271 or
ERC-6492 verification and the Nostr signature must all succeed before an
adapter runs.

The first Röbel staging adapter verifies only
`CitizenNFTv2.isActive(controlledAddress)` on the currently approved Gnosis
deployment. An AttesterNFT alone is not citizen eligibility under this policy.
Before activation, operations must pin chain `100`, contract address,
bytecode/deployment identity and the finality rule from reviewed evidence. One
issuance uses a single finalized block number and hash for all calls and keeps
that block evidence in the private audit record. Chain mismatch, unavailable
RPC, unsupported finality, malformed response, missing bytecode, reorged block,
false `isActive`, or indeterminate result fails closed and issues nothing.
These values remain adapter configuration and private audit evidence; they are
not global protocol constants and the citizen wallet is not copied into the
public receipt.

A later municipality may replace that adapter with its own OIDC, registry, or
credential verifier without changing the participant suggestion, adoption
event, or Case Steward intake contract.

### Public-safe eligibility receipt

After the authenticated member proves control of both the server-derived
active credential and Nostr key and the private adapter confirms current
eligibility, the configured municipal issuer constructs this unsigned, closed
`eligibilityCore`:

```text
{
  municipalityId,
  eligibilityClass: "municipal_civic_participation",
  subjectPubkey,
  participantSuggestionId,
  topicId,
  policyVersion,
  issuer,
  issuedAt,
  expiresAt,
  authorityBinding: "civic_eligibility_only"
}
```

The core is encoded as `stadtstack_stable_json_v1` UTF-8 bytes.
`payloadChecksum` is the lowercase SHA-256 of exactly those bytes and
`receiptId` is
`urn:stadtstack:municipal-civic-eligibility-receipt:` plus that checksum.
`statusRef` is then derived from the policy-pinned status base path and the
checksum; it is never accepted from the request and is not part of the core.
The issuer constructs this closed `receiptProofInput` and encodes it with
`stadtstack_stable_json_v1`:

```text
{
  domain: "municipal-civic-eligibility-receipt/v1",
  schemaVersion: "municipal_civic_eligibility_receipt_v1",
  receiptId,
  payloadChecksum,
  statusRef
}
```

It signs those exact UTF-8 bytes. The resulting closed public envelope is:

```text
municipal_civic_eligibility_receipt_v1 {
  schemaVersion: "municipal_civic_eligibility_receipt_v1",
  eligibilityCore,
  receiptId,
  payloadChecksum,
  statusRef,
  proof: {
    algorithm,
    keyId,
    signature
  }
}
```

`proof` is excluded from every checksum and signature input. Its algorithm and
issuer key identifier must be allowed by the pinned policy; `signature` is
unpadded base64url over the exact proof-input bytes. Unknown proof keys or
encodings fail closed. This ordering avoids a receipt hashing or signing
itself.

The receipt binds one citizen key to one exact participant suggestion and
topic; it is not a reusable public citizenship directory. It contains no name,
address, postcode, account ID, wallet, token ID, registry row, uploaded
document, or private verification evidence. It does deliberately expose a
stable Nostr key, issuer, municipality policy, suggestion and validity window.
Aggregating receipts can therefore reveal which public keys qualified and
sponsored civic topics. Issuance requires explicit disclosure at the adoption
step, and policy must set bounded lifetime and retention; a deployment needing
unlinkable eligibility requires a different reviewed credential design. The
issuer retains only the minimum private audit link required by its policy.

The Case Steward verifies issuer signature, municipality, suggestion, topic,
subject key, issue/expiry time and current status immediately before admission.
It ignores arbitrary receipt URLs and resolves status only through the
policy-pinned base path. For each admission attempt the Case Steward supplies a
new unguessable one-time status nonce. The endpoint re-evaluates the underlying
adapter before signing `active`; current revocation or inactivity produces
`revoked`, while an indeterminate adapter result fails closed and produces no
usable status. The closed canonical `statusCore` is:

```text
{
  schemaVersion: "municipal_civic_eligibility_status_v1",
  receiptId,
  payloadChecksum,
  policyVersion,
  state: "active" | "revoked",
  effectiveAt,
  observedAt,
  audience: "stadtstack-case-steward-admission",
  requestNonce
}
```

`statusChecksum` is the lowercase SHA-256 of the exact canonical UTF-8 core.
The issuer signs the exact canonical `statusProofInput` object
`{domain: "municipal-civic-eligibility-status/v1", schemaVersion:
"municipal_civic_eligibility_status_v1", statusChecksum}` and returns the
closed envelope `{statusCore, statusChecksum, proof: {algorithm, keyId,
signature}}`, using the same proof encoding rules as the receipt. The Case
Steward atomically consumes the matching nonce and accepts only an `active`
observation no older than policy `statusMaxAge`. Unknown states, reused or
mismatched nonce, signature/checksum mismatch, expiry, stale observation,
outage, timeout, malformed content or a receipt/status mismatch fail closed.
Revocation or expiry prevents a new admission but does not erase an already
issued public receipt or rewrite a previously admitted Case. Later governance
and treasury actions perform their own current authorization checks.

### Citizen adoption event

The citizen signs a new event; the participant event is never relabelled or
mutated. The citizen may be the original participant or another eligible
resident. The original participant remains visibly attributed, and the citizen
is visibly the person sponsoring the unchanged suggestion for review.

The adoption content is canonical `stadtstack_stable_json_v1`. Its closed
`adoptionCore` contains:

```text
{
  municipalityId,
  topicId,
  participantSuggestionId,
  participantSuggestionRef,
  participantPubkey,
  sourceDiscussionId,
  sourceAnswerReceiptId,
  adopterPubkey,
  eligibilityReceiptId,
  eligibilityReceiptChecksum,
  title,
  summary
}
```

`adoptionId` is
`urn:stadtstack:citizen-topic-suggestion-adoption:` plus the lowercase SHA-256
of the exact canonical UTF-8 `adoptionCore`. The complete closed content is:

```text
{
  schemaVersion: "public_citizen_topic_suggestion_adoption_v1",
  adoptionId,
  ...adoptionCore,
  entryState: "case_steward_review_required",
  authorityBinding: "civic_eligibility_only",
  submittedToCivicWorkflow: false
}
```

`participantSuggestionRef` is exactly
`nostr://event/<participantSuggestionId>`, where the event ID is 64 lowercase
hexadecimal characters; no alternate URI, relay hint or case variant is valid.

The title, summary, discussion and Mecky answer/receipt must match the immutable
participant suggestion exactly. Adopting changed wording requires a new
participant suggestion; an adoption is not an editing surface. The outer
Nostr event is kind `1`, its `pubkey` equals `adopterPubkey`, and its content
is the canonical object above. At the atomic first intake only, its integer
`created_at` must be inside the policy-pinned clock-skew window around recorded
`receivedAt`; its signature must verify. Its exact ordered tags are:

```text
["schema", "citizen_adopted_topic_suggestion_v1"]
["municipality", municipalityId]
["topic", topicId]
["e", participantSuggestionId, "", "adopted-suggestion"]
["e", sourceDiscussionId, "", "root"]
["p", participantPubkey]
["eligibility-receipt", eligibilityReceiptId]
["credential-class", "municipal-civic-eligibility"]
```

No other tag is accepted. In particular, the event contains no chain,
contract, wallet, token, adapter, `case`, vote, governance, treasury,
municipal-publication or workflow-command tag.

The closed adoption command contains
`schemaVersion: "citizen_topic_suggestion_adoption_request_v1"`, a UUID
`requestId`, bounded `idempotencyKey` and the complete signed adoption event.
Its `requestChecksum` is the lowercase SHA-256 of canonical UTF-8
`{schemaVersion, adoptionEvent}`; transport-only `requestId` and
`idempotencyKey` are excluded. At the atomic first claim, the writer records
`receivedAt`, checks event `created_at` against that time once, verifies that
the eligibility receipt was valid then, and never reapplies wall-clock skew to
the immutable event.

The writer atomically claims `(municipalityId, participantSuggestionId,
adopterPubkey)` and stores the first exact signed envelope, request checksum
and this closed acceptance receipt:

```text
citizen_topic_suggestion_adoption_acceptance_receipt_v1 {
  schemaVersion: "citizen_topic_suggestion_adoption_acceptance_receipt_v1",
  adoptionId,
  adoptionEventId,
  municipalityId,
  topicId,
  participantSuggestionId,
  adopterPubkey,
  eligibilityReceiptId,
  requestChecksum,
  eventCreatedAt,
  receivedAt,
  policyVersion,
  status: "accepted",
  authorityBinding: "civic_eligibility_only",
  receiptChecksum
}
```

`receiptChecksum` excludes itself and is the lowercase SHA-256 of the other
closed receipt fields in canonical UTF-8. An exact retry returns that same
stored event and receipt; it does not ask the citizen to re-sign with a new
timestamp and does not reapply clock skew. A different event, receipt, payload
or idempotency reuse fails with an explicit conflict. Later Case admission
verifies the acceptance receipt and that the original event and receipt were
inside their validity intervals at `receivedAt`, then separately performs the
fresh anti-replay status check above. ADR 0019's municipality-wide
discussion-root claim remains the separate uniqueness gate that prevents two
adopted candidates from creating two Cases for one discussion.

The Case Steward derives the eventual Case identity from the verified adoption
event, not from the participant suggestion or a browser-provided identifier.
The existing `citizen_signed_topic_suggestion_v1` remains a direct-candidate
compatibility shape for already verified citizen flows; it is not an adoption
event and is not accepted by the first real ADR 0023 Case Steward intake.

The corresponding public read-side handoff is
`public_case_binding_receipt_v2`. In addition to ADR 0019's root, topic,
Mecky-answer, Case journal and admission checksums, its closed checksum-bound
envelope names `candidateKind:
eligible_citizen_adopted_topic_suggestion_v1`, the adoption ID and event ID,
participant-suggestion event ID, adopter public key, eligibility receipt ID
and checksum, policy version, issuer, source-answer receipt ID, and adoption
acceptance-receipt checksum. It also carries exact false values for
administrative endorsement, binding vote, council decision, openDesk write,
treasury effect and payment effect. Röbel may drive Case, public
administration, Citizen Brief and explicitly advisory Mitmachen only after
this trusted receipt matches the exact participant suggestion currently shown.
A `public_case_binding_receipt_v1` can still describe its legacy direct
candidate, but it cannot relabel or advance a participant suggestion.

The provider-neutral `CitizenSession` exposes the matching bounded adoption
signing operation. Trusted composition must supply the municipal eligibility
receipt and deployment-pinned policy; the session only signs the verified
ADR-0023 event and neither publishes it nor creates a Case. This read/sign
tracer deliberately does not claim an issuer, adoption gateway/ledger, Case
writer, staff console or live browser path.

### Synthetic browser tracer

Before a real issuer is activated, staging may implement a separately typed
`synthetic_citizen_adoption_tracer_v1` and an isolated synthetic Case path so
the journey UI can be exercised. It must carry visible synthetic/no-authority
labels, use a separate namespace and validator, and cannot contain or imitate a
municipal eligibility receipt. The real Case Steward, governance, voting and
treasury paths reject it by schema before any write.

## Consequences

- Röbel can test its existing citizen infrastructure without making the shared
  protocol depend on Thirdweb, Gnosis, CitizenNFT, Safe, Pimlico, or one city.
- A non-citizen may surface a valuable problem and retain authorship while an
  independently eligible citizen sponsors the exact suggestion for review.
- The public journey can explain who suggested, who adopted, which municipal
  policy established eligibility, and which later human admitted the Case
  without publishing the person's wallet or private residency evidence.
- The municipality-operated Kair/openDesk round trip remains downstream of
  Case admission. Its official publication receipt is a different municipal
  authority transition and cannot be inferred from citizen eligibility.
- Governance ballot eligibility and treasury authorization remain separate
  future contracts; CitizenNFT ownership is not silently reused as either.

## Rejected alternatives

- **Treat a staging invite or successful login as citizenship:** rejected
  because authentication and civic eligibility answer different questions.
- **Put the wallet or CitizenNFT proof directly in the Nostr adoption:**
  rejected because it makes a city-specific credential public and correlates
  identities unnecessarily.
- **Relabel the participant event after verification:** rejected because signed
  events are immutable and the later sponsor must remain independently
  attributable.
- **Let the browser choose an issuer, municipality, contract, or policy:**
  rejected because it turns policy into caller-controlled data.
- **Reuse the eligibility receipt as voting or treasury authority:** rejected
  because participation, binding governance and execution have distinct rules,
  snapshots and accountable operators.

## First tracer acceptance

1. A participant suggestion without a current receipt cannot reach the real
   Case Steward.
2. A configured Röbel adapter verifies one approved staging citizen credential
   and issues a public-safe receipt without wallet or personal data.
3. The same or another eligible citizen signs one exact adoption; changing the
   suggestion, topic, receipt or signer fails closed.
4. An exact retry returns the first stored signed adoption envelope; changed
   content, receipt, timestamp, signer or idempotency payload conflicts, and
   the separate ADR 0019 root claim prevents a second Case.
5. The real Case Steward validates all five complete artifacts in the
   eligible-adoption bundle and
   emits only the ADR 0019 Case binding receipt after separate staff admission.
6. Expired, revoked, cross-municipality, unknown-issuer, synthetic, direct-v1,
   voting, and treasury inputs are rejected before any Case write.
