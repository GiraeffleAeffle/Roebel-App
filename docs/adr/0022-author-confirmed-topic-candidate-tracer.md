# ADR 0022: Author-confirmed source-post promotion and topic-candidate tracer

- Status: Accepted boundary for staging; implementation pending
- Date: 2026-08-25

## Context

ADR 0021 gives one invited staging participant a deliberately small capability:
publish an ordinary text post or comment, mirror the post to the signed Nostr
feed, and receive a signed, cited Mecky reply in the same thread. The original
post is still a social post. It must not become a civic topic merely because it
mentions a street, a problem, or Mecky.

The next useful test is the human hand-off from that conversation into the
civic journey:

```text
ordinary participant post
  -> same-thread @Mecky mention and cited reply
  -> source author explicitly promotes the post
  -> signed topic-only discussion root
  -> a new cited Mecky answer to that root
  -> source author signs a topic-suggestion candidate
```

The hand-off must preserve the source author and every piece of provenance.
It must not turn a browser action into a generic signed-event proxy, create a
CivicCase, or imply that Mecky or the participant has municipal authority.

The protocol must also work for another municipality. Röbel is the first
staging instance and its configured topic and Mecky values are test fixtures,
not global constants.

## Decision

Add exactly two closed operations to the separately deployed participant
gateway. They use the short-lived session and wallet/Nostr binding from ADR
0021; they do not add a generic event route.

```text
POST /api/staging-participant/v1/promote-source-post
POST /api/staging-participant/v1/sign-topic-suggestion
```

The first operation accepts one ordinary, participant-owned source post and a
complete source-author-signed, topic-only discussion root. The second accepts
one complete source-author-signed topic-suggestion event whose sources are the
root and its new Mecky answer. Both operations verify the complete signed
envelope before using the private relay/workbench adapter and return a
public-safe receipt. A retry returns the same receipt; it never publishes a
second effective root or candidate.

### Trusted instance policy

The deployment, not the browser request, supplies the following immutable
policy values:

```text
municipalityId   -- the instance's municipality slug
topicNamespace   -- the allowed canonical topic prefix
meckyPubkey      -- the one public Mecky author key for this instance
policyVersion    -- the verifier policy used for the receipt
```

For the first instance, the values identify Röbel/Müritz in staging. The
verifier accepts the same shape for another municipality only when that
municipality deploys its own values. A request cannot select a different
municipality, namespace, topic prefix, or Mecky key, and no code path treats
Röbel as the default for other deployments.

### Closed operation shapes

Both requests are JSON objects with no unknown keys. `requestId` is a UUID and
`idempotencyKey` is a bounded opaque string. The authenticated session wallet
is taken from the gateway cookie, never from a caller-asserted field.

```text
promoteSourcePost({
  schemaVersion: "staging_source_post_promotion_v1",
  requestId,
  idempotencyKey,
  sourcePostId,             // ordinary participant-owned app post UUID
  rootEvent                 // complete signed Nostr kind-1 event
}) -> {
  schemaVersion: "staging_source_post_promotion_receipt_v1",
  status: "promoted" | "already_promoted",
  sourcePostId,
  discussionRootId,
  topicId,
  sourceConversation: {
    sourceAppPostId,
    sourceAppCommentId?: string,
    mentionEventId,
    meckyReplyEventId,
    meckyReceiptId?: string
  } | null,
  authorityBinding: "none",
  policyVersion,
  receiptChecksum
}
```

`rootEvent` must be signed by the source-post author and must contain exactly
the topic-root envelope, in this order:

```text
["p", meckyPubkey]
["q", sourceNostrEventId, "", sourceAuthorPubkey]
["source-post", sourceNostrEventId]
  // when the author selects the completed same-thread exchange:
  ["source-app-post", sourcePostId]
  ["source-app-comment", commentId]                 // optional
  ["source-conversation-mention", mentionEventId]
  ["source-mecky-reply", meckyReplyEventId]
  ["source-mecky-receipt", meckyReceiptId]          // optional
["t", "stadtstack-civic-discussion"]
["municipality", policy.municipalityId]
["topic", policy.topicNamespace + ":" + topicSlug]
["topic-title", trimmedTitle]
["stance", "root"]
["argument-root", "self"]
```

The conversation block is either absent in full or present in full (apart from
its two explicitly optional values). In the accepted browser tracer it is
present and points to the already verified same-thread Mecky answer from
ADR 0021. The root content is the human-confirmed question, trimmed and
bounded; it must mention `@Mecky`. No `case`, `stadtstack-case`, argument,
pro, con, vote, or treasury tag is permitted.

```text
signTopicSuggestion({
  schemaVersion: "staging_topic_suggestion_signature_v1",
  requestId,
  idempotencyKey,
  discussionRootEvent,      // the accepted topic-only root
  meckyAnswerEvent,          // a new signed cited reply to that root
  candidateEvent             // signed by the same source author
}) -> {
  schemaVersion: "staging_topic_suggestion_receipt_v1",
  status: "signed" | "already_signed",
  candidateId,
  discussionRootId,
  meckyAnswerId,
  meckyReceiptId,
  topicId,
  entryState: "awaiting_human_case_admission",
  authorityBinding: "none",
  submittedToCivicWorkflow: false,
  policyVersion,
  receiptChecksum
}
```

The answer must be a newly signed kind-1 event by `policy.meckyPubkey`, reply
to exactly the root, carry the same municipality/topic, contain one bounded
`mecky-receipt`, and contain one to three admitted evidence tags. Synthetic
fixtures are labelled as synthetic; they do not become official sources.
The candidate is the existing `citizen_signed_topic_suggestion_v1` shape: its
content is the canonical `public_mecky_topic_suggestion_draft_v1`, and its
tags are exactly `schema`, `municipality`, `topic`, the root `e` reference,
and `mecky-receipt`. The candidate signer must equal the root/source author.
It contains no `case` or `stadtstack-case` tag and no workflow command.

The gateway reconstructs the candidate's public draft from the verified root
and answer rather than trusting duplicated JSON in the request. The signed
events remain the durable discussion record; receipts are retry and projection
evidence, not new authority.

### Idempotency and ownership

- `promoteSourcePost` claims `(policy namespace, sourcePostId)`. The source
  row, its bound Nostr event, and its owner are checked in a trusted resolver.
  The first valid root wins. A retry with the same root returns
  `already_promoted`; a different root, topic, author, conversation, or
  idempotency payload returns `idempotency_conflict`.
- `signTopicSuggestion` claims `(policy namespace, discussionRootId,
  sourceAuthorNpub)`. The first valid candidate wins. A retry with the same
  candidate returns `already_signed`; a different candidate for that root and
  signer returns `candidate_already_signed`.
- The claim and publication receipt are atomic at the writer boundary. A
  relay retry may re-submit the same event ID, but a partial relay outage never
  authorizes creation of a new event with a new ID.
- A session wallet, source app row, bound Nostr key, root signer, and candidate
  signer must all resolve to the same source author. A post owner check is a
  server-side fact, not a client `isAuthor` flag.

### State flow and authority boundary

```text
ordinary post
  -> participant-owned + signed
  -> @Mecky mention answered in same thread
  -> promoteSourcePost (author signs root)
  -> topic/discussion projection: root, tree, sunburst
  -> Mecky signs a new cited answer to the root
  -> signTopicSuggestion (author signs candidate)
  -> awaiting_human_case_admission
```

The normal feed may project each stage and link back to the same topic. The
original post remains an ordinary, attributable post. The discussion root is
topic-only. Mecky can answer, cite, explain uncertainty, and suggest the next
human action; Mecky cannot promote, sign, admit, vote, publish for a
municipality, or spend funds. A later, separately authenticated **Case
Steward** may admit one candidate into a CivicCase under ADR 0019. That later
operation is not reachable from either gateway method.

This slice does not expose or authorize:

- generic signed-event or arbitrary workbench commands;
- public CivicCase creation or Case Steward admission;
- pro/con argument writes (tree and sunburst are read projections here);
- proposal execution, administration/openDesk completion, or Citizen Brief
  publication;
- votes, governance effects, treasury reads that imply authority, or payments.

## Domain invariants

1. An ordinary post stays ordinary until its source author signs a separate
   promotion root; no classifier, Mecky answer, or UI card promotes it.
2. One source post has at most one effective topic-root claim per deployment
   namespace. The source event and app row remain immutable.
3. A topic root has exactly one topic and one municipality from trusted policy;
   it has no CivicCase, stance other than `root`, argument parent, or voting
   meaning.
4. A selected conversation is exact provenance: the app post/comment, signed
   mention, signed Mecky reply, and optional receipt must all refer to the same
   chain, with timestamps in causal order.
5. Only the source author may sign the root and topic candidate in this slice.
   Another resident's moderation or co-sign policy requires a later ADR.
6. A Mecky answer is accepted only from the configured key, as a signed reply
   to the exact root, with bounded cited evidence and `authorityBinding: none`.
7. A topic candidate is an unsigned-to-authority, citizen-signed suggestion;
   its state is `awaiting_human_case_admission` and it cannot create a case.
8. Every accepted operation is restartable and idempotent; a different payload
   under an existing claim fails closed rather than choosing “latest wins.”
9. No request body, public table, mutable user projection, or Mecky prompt can
   override the municipality, topic namespace, or Mecky key from deployment
   policy.

## Exact rejection cases

The adapter returns a generic failure to the browser and records only the
bounded machine code; it never returns secrets, signatures, or private row
details. These are the required internal rejection codes:

| Code | Reject when |
| --- | --- |
| `invalid_request_shape` | Unknown/missing fields, wrong schema, oversized text/event, malformed UUID, tag, or JSON value. |
| `session_required` / `session_wallet_mismatch` | No active participant session, expired/revoked session, or caller wallet is not the bound signer. |
| `source_post_missing` / `source_post_not_ordinary` | The app post is absent, unpublished, not text-only, already a comment/topic root, or not the exact bound signed source row. |
| `source_post_not_owned` | The trusted row owner, bound Nostr author, and session wallet do not resolve to the same participant. |
| `source_conversation_invalid` | A selected mention/reply is absent, not same-thread, not signed, not addressed to the configured Mecky key, out of order, or has mismatched app IDs/content. |
| `root_signature_invalid` / `root_author_mismatch` | The root signature fails, is not kind 1, or is not signed by the source author. |
| `root_shape_invalid` | Root tags are missing, duplicated, reordered, contain unknown values, omit `@Mecky`, or contain case/argument/pro/con/vote/treasury authority. |
| `policy_binding_invalid` | Municipality, topic namespace, topic slug, or Mecky key differs from trusted deployment policy. |
| `idempotency_conflict` / `candidate_already_signed` | An existing source/root claim is retried with a different effective payload or candidate. |
| `mecky_answer_invalid` | The new answer is not from the configured Mecky key, does not reply to this root, lacks a valid receipt/evidence set, or contains a case/authority tag. |
| `candidate_signature_invalid` / `candidate_source_mismatch` | Candidate signature, draft checksum, root, topic, answer receipt, signer, or timestamps do not match the verified sources. |
| `candidate_shape_invalid` | Candidate is not the exact topic-suggestion schema, has unknown/duplicate tags, or includes a CivicCase/workflow/authority field. |
| `unsupported_intent` | The request attempts a generic event, argument, Case, administration, vote, treasury, or other operation not listed here. |
| `upstream_unavailable` | The trusted resolver, relay/workbench, evidence verifier, or durable claim store is unavailable; no partial success is reported. |

## Consequences

- A real invited tester can walk from a normal feed post through a visible
  discussion, a cited Mecky answer, and a signed topic candidate without
  filling the timeline with synthetic civic roots.
- The original app post, Nostr events, topic projection, and candidate remain
  attributable and independently verifiable. Tree and sunburst views remain
  projections, not alternate writes.
- The participant gateway stays small: two closed operations and their private
  adapters. The public Web still receives no writer secret or Case authority.
- The topic/candidate contracts are city-neutral. A municipality operates its
  own deployment policy and can use another frontend or relay adapter without
  changing the signed envelope.
- A staff-only Case Steward and later municipal openDesk handoff remain needed
  before the journey can show a CivicCase or administrative outcome. This ADR
  intentionally does not claim the full civic flow is live.
- The source resolver and durable claim store are production prerequisites;
  process-local staging idempotency is not enough for a multi-replica writer.

## Rejected alternatives

- **Automatically turn every post mentioning a problem into a topic:**
  rejected because the ordinary Röbel feed must remain social and promotion is
  a meaningful human choice.
- **Let Mecky create or promote the root:** rejected because Mecky may suggest
  wording and cite sources but cannot sign for the person or grant authority.
- **Expose the existing generic signed-event/workbench endpoint:** rejected
  because it would make conversation, Case, argument, vote, and treasury
  commands reachable through the participant session.
- **Rewrite the original post into a discussion root:** rejected because signed
  events are immutable and source attribution would become ambiguous.
- **Trust a browser ownership flag or mutable `users` projection:** rejected
  because neither proves canonical row ownership or signer control.
- **Use a global Röbel topic or Mecky key:** rejected because the protocol must
  be deployable by other municipalities with their own policy and identity.
- **Create the CivicCase when the candidate is signed:** rejected because
  candidate signing and staff admission are separate authority transitions under
  ADR 0019.

## Acceptance matrix

| Scenario | Expected result |
| --- | --- |
| Invited participant creates a normal text post, mentions Mecky, and receives a signed same-thread cited reply | The post remains normal; the reply is visibly attributed and `authorityBinding: none`. |
| The same source author signs one exact topic-only root with the completed conversation provenance | `promoteSourcePost` returns `promoted` and one receipt; the root appears once under the configured topic. |
| The same promotion request is retried after relay or browser timeout | `already_promoted`, same root ID/checksum; no second event or topic link. |
| A different wallet, post owner, Nostr key, or source content is supplied | Fail closed with ownership/source mismatch; no relay or database write. |
| A root uses another municipality, namespace, Mecky key, case tag, pro/con tag, or unknown tag | `policy_binding_invalid` or `root_shape_invalid`; no publication. |
| Mecky signs a new reply to the accepted root with 1–3 valid evidence references | The answer is projected in the same discussion and can be used as the candidate source. |
| The source author signs the exact topic-suggestion candidate from that root and answer | `signTopicSuggestion` returns `signed`, `awaiting_human_case_admission`, and no CivicCase. |
| The same candidate is retried | `already_signed`, same candidate ID/checksum; no duplicate. |
| A candidate has a changed title/source/receipt or a `case`/authority field | Candidate verification fails; no workflow submission. |
| Any request targets generic events, argument writes, Case, openDesk, admin, vote, or treasury | `unsupported_intent`; no side effect. |
| Relay, resolver, evidence, or claim store is unavailable midway | `upstream_unavailable`; the operation returns no false success and can be retried safely. |

## Rollback

Rollback is a projection and capability rollback, not deletion of signed
history. First disable the two gateway routes and revoke the staging
participant admission. Stop the worker from accepting new claims, then let
in-flight requests finish or fail closed. Verify that the public Web remains
read-only and that generic workbench, Case, administration, vote, and treasury
routes remain unreachable.

Existing signed source posts, mentions, Mecky answers, roots, candidates,
publication claims, and audit receipts are retained as labelled staging
evidence. The public projection may hide the topic/candidate stage by release
version, but it must not rewrite or delete the source events. A later redeploy
may replay the same event IDs and claim keys; it may never issue replacement
events to “repair” a partial publication. Any durable claim or relay adapter
failure is recovered with the same idempotency key or manually quarantined for
review; it never falls through to Case admission or another authority path.
