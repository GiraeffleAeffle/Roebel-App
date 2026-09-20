# ADR 0015: One civic journey with embedded stage tools

## Status

Accepted for staging; the shared public journey shell is implemented through
topic, discussion, Mecky, proposal and case projections. Authority-bearing
transitions remain gated.

## Context

The Röbel feed is a general social timeline. People publish ordinary news, observations, questions, events, and neighbourhood posts. Only some of those posts identify a shared civic problem or become the starting point for a structured discussion.

The current staging work proves individual parts of the later lifecycle: a native discussion page, a Mecky response, a proposal/case preview, and a separate Röbel Data mini-app for participation and treasury context. The separate surfaces are useful technical proofs, but they make one public process feel like unrelated products and can hide provenance between the original post, proposal, administrative response, decision, budget, and outcome.

Combining every capability into one large page would create the opposite problem on mobile and would blur distinct authority boundaries. The product needs continuity without collapsing the underlying records or owners.

## Decision

1. The normal feed remains general. An ordinary feed post never becomes a civic topic, discussion, proposal, or case automatically.
2. A human may explicitly:
   - attach a source post to an existing civic topic;
   - create a new civic topic from it;
   - start a structured discussion under that topic; or
   - leave the post standalone.
3. The original signed post is retained as a source. Promotion creates new identifiers and provenance links; it does not edit the post into another record.
4. Röbel owns one **civic journey** shell for the complete public lifecycle. It keeps a stable topic header and exposes source posts, discussions, Mecky answers, proposal candidates, civic cases, administrative packages, Citizen Briefs, participation, decisions, budget constraints, execution, and outcomes as attributable stages.
5. The journey is one navigational and provenance line, not one mutable aggregate. Each stage retains its own owner, schema, authority, version, and transition gate. After Civic Case admission, Stadtstack's derived case stage map remains the canonical stage state; Röbel only projects it into the journey.
6. Mini-apps and external systems are **stage tools** behind narrow interfaces:
   - tree and sunburst views project the signed discussion graph;
   - the Röbel Data mini-app may render governance or budget exploration;
   - a municipality-operated Kair/openDesk workspace owns administrative work
     and may return an authorized Municipal publication receipt;
   - governance and treasury systems own their authorized actions.
   They receive a scoped journey context and return an intent or receipt. A
   municipal workspace receipt may advance only the exact reviewed municipal
   stage it proves; it cannot silently alter topic, proposal, or case state.
7. Direct mini-app URLs may remain for development and deep linking, but the primary public route is the Röbel journey. Returning from a stage tool restores the same topic and stage rather than dropping the person into a separate product.
8. Desktop presents a persistent stage timeline alongside the active work surface. Mobile presents the same stages through a compact progress header and stage navigation; it does not squeeze a desktop process map into one horizontal strip.
9. Proposal, participation, treasury review, and execution remain visibly connected in the journey, while their permissions remain separate. Displaying a budget constraint never authorizes a treasury transaction; displaying an advisory signal never turns it into a formal vote.
10. Mecky may classify, summarize, cite, and suggest the next human action. It may not promote a post, sign for a person, admit a civic case, approve administration work, open a binding vote, or spend funds.
11. A proposal candidate is signed while the journey is still topic-bound. The next stage remains “awaiting human case admission”; signing never calls the admission, administration, participation, governance, or treasury adapters automatically.
12. Röbel renders **public administration progress** only from Stadtstack's redacted public case projection. It may show accepted, current department responses and a current Citizen Brief. A department absent from that projection is labelled only as “not publicly reviewed”; Röbel must not infer whether private work is missing, pending, rejected, corrected, or retracted.
13. The journey may enter **Mitmachen readiness** as soon as the current Citizen Brief is public. This stage exposes the reviewed brief and provenance but no input control, option counts, or outcome. An advisory round becomes open or complete only from its own reviewed projection; readiness alone never advances the canonical Stadtstack case stage.
14. Röbel reads administration progress through a case-bound, GET-only public projection. The response must match the journey's exact canonical case ID. Reviewed department entries retain their public package ID, package checksum, artifact checksum, and review date; conflicting case bindings hide the administration stage until a human resolves them. This reader exposes no case-steward command and grants no administrative authority.
15. The primary Mitmachen entry point is a link from that exact Civic Journey. The Mitmachen reader reuses the same case-bound GET-only projection and rejects an unbound public profile. It may display the reviewed finance package as budget context beside the Citizen Brief, but the package remains an administrative statement: it is neither a treasury balance nor permission to reserve, transfer, or spend funds.
16. An ordinary-thread `@Mecky` request remains a signed conversation event,
    not a civic promotion. Its public projection exposes the exact mention ID,
    optional source-comment ID, `pending` or `answered` state, and exact reply ID.
    Aggregate counts alone are insufficient because the same source-bound state
    must survive navigation and reload. A delayed answer stays visible and may
    be checked again; the UI must not fabricate a reply or silently promote the
    post.
17. The first conversation-to-discussion tracer is **source-post-author-only**.
    Only the immutable post's author can promote it; that person explicitly
    chooses either the original post or one completed public `@Mecky` exchange
    attached to its post/comment thread as source context. The exchange may
    have been started by another participant and remains attributed to its
    exact signer. Choosing it binds the exact
    application post, optional comment, citizen mention event, Mecky reply
    event, and optional receipt identifier to the new signed discussion root.
    The selected Mecky answer is contextual provenance; it is not relabelled as
    the new discussion's answer, a proposal, or accepted evidence. Allowing a
    different verified resident to promote somebody else's post is a later
    moderation and anti-spam policy decision.
18. Promotion is idempotent at the writer, not merely in the browser. One
    author/source-post claim returns the already signed discussion root on a
    retry, even when the retry contains a differently worded question. The
    single staging writer may serialize that claim and restore it from the
    relay. Production or a multi-replica writer requires a durable atomic claim
    store/outbox before this boundary is called production-ready.
19. A source application UUID is not by itself proof of Röbel-row ownership.
    Before production, a trusted source resolver must compare the canonical
    post—and, when selected, comment—owner, normalized content and timestamp to
    the authenticated credential and signed Nostr chain. Client-side `isAuthor`
    checks remain useful UX but are never the authority boundary.

## Consequences

- People can move from “I noticed a problem” to a visible outcome without learning a collection of unrelated mini-apps.
- Ordinary social activity is not crowded out by workflow cards.
- A civic topic can contain several source posts and discussions while proposals and cases remain explicitly derived records.
- Specialized tools remain independently deployable and replaceable because the Röbel host owns the journey contract.
- The host needs a versioned journey projection and stage-tool context; mini-apps need to stop treating a query-string topic slug as sufficient state.
- Proposal signing and Civic Case admission are two independently attributable transitions, even when the interface presents them consecutively.
- The topic hub and each discussion now use the same pure stage projection and
  responsive journey rail. Missing receipts stay visible gaps; later records do
  not fabricate earlier transitions.
- Administration progress can stay in the same journey without copying private openDesk work queues or creating a second case state.
- The canonical topic and its discussion render the same checksum-bound public package projection; a detached mini-app or unbound public view is not the primary administration surface.
- People can see that a reviewed brief is ready for participation without mistaking readiness for an open poll or completed signal.
- Opening Mitmachen from the journey preserves the canonical case binding, and the reviewed finance response stays visibly connected without becoming a separate treasury mini-app or effect.
- Signed-out readers can follow the same public post conversation and are
  invited to authenticate in context; a source-bound Mecky request remains
  attributable while it is pending and after its answer is projected.
- An explicit promotion can preserve the exact conversation a person meant,
  while retries cannot create a second discussion root or rewrite the original
  post. Staging's single-writer guarantee is intentionally weaker than the
  durable source resolver and claim store required for production.
- This ADR does not authorize automatic promotion, a formal municipal vote, a treasury payment, or production data migration.

## Synthetic Workspace return (7C, 2026-09-14)

The staging Workspace exposes two separate steward actions after all eight
accepted department reviews: prepare a read-only preview, then confirm that
exact preparation checksum. A changed Case discards the preview; ambiguous
saves require a reload. Neither the eighth review nor a generic continuation
request supplies the steward's publication decision.

The citizen discussion and topic pages read a separately typed
`synthetic_citizen_brief_return_v1`. Its exact Case, discussion and topic must
match the existing verified admission receipt. The shared browser-safe
federation client rejects extra/private fields, verifies the return checksum
and the original coordinator Brief checksum, and shows no old response text
after withdrawal or read failure. This synthetic view does not enable the
municipal journey's participation or governance steps.

Public Mecky can consume the same return only when both
`MECKY_ALLOW_SYNTHETIC_BRIEF=true` and `MECKY_SYNTHETIC_BRIEF_CONFIG` are set.
The latter is a closed JSON object with `environment: "staging"`, `publicOrigin`,
`caseId`, `discussionId` and `topicId`; it contains no credentials. Each query
reads the current return using GET without credentials or redirects. Confirmed
responses enter retrieval as `synthetic_citizen_brief` / `synthetic_demo`,
never `official_record`. Replies using this context carry a deterministic test
label in addition to source citations. Withdrawal or source failure removes
those passages from the next retrieval.

The fixture in the federation client is generated by the Stadtstack coordinator
from its public synthetic test vector and is byte-identical to that repository's
fixture. It contains no live Case or account data. The local rehearsal covers
the real Workspace component, gateway and coordinator, followed by the public
reader and component; its session identity is a fixture, not a new OIDC proof.
The existing staging login remains in place. Remote builds, deployment and
human review of the actual eight drafts remain separate gates.

### Visible synthetic return — 2026-09-14

A verified synthetic admission must not leave the page displaying the real
citizen-adoption gate as its active task. Röbel now projects a separately labelled
**synthetic demo journey** from the exact public admission and the current,
checksum-verified Brief return. The municipal journey and its eligibility state
remain unchanged. The page reads the return once for both the progress display
and the response panel; withdrawal, failure or a different binding cannot retain
a completed return. A current test Brief makes “Rücklauf diskutieren” the active
next task. It opens neither a participation round nor a vote.

The returned answers appear before the original argument tree; source exchanges
and signatures remain available as details. The Workspace verifies public
availability through the same reader and compares Case versions, instead of
inferring delivery from its private review flag. “Reviewed” describes acceptance
of a response, not the resolution of every factual question it identifies.

Ordinary feed mentions and public chat share Mecky's evidence reader. German
department labels make department-specific retrieval possible without changing
source authority or evidence identifiers. Brief citations link to the original,
readable discussion; the reader still validates the fixed machine-readable
Brief endpoint. Chat and feed may omit the deterministic source footer from
visible prose only when its URLs exactly match the separately verified citations.
Signed content is retained unchanged. A new question reads the current Brief;
older signed answers remain historical, and are not silently rewritten.

### Public follow-ups after a Brief — 2026-09-20

The Brief's public question action opens the existing source-post comment thread
with a selected discussion. The app checks that selection against the signed
root and its source-post and topic tags before showing the context. It waits for
that check before offering the contextual composer. The citizen's explicit send
creates the ordinary comment; its signed mention retains the exact discussion
URL in a visible `Diskussion:` footer. The feed renders that unchanged reference
as a readable return link.

For an explicit Mecky mention, the agent accepts only a reference to the
configured public app origin and re-reads the exact signed root. The root must
bind to the same feed post as the signed question. That context scopes retrieval
to the discussion and current reviewed Brief; missing, withdrawn or changed
sources are not replaced with an old answer. The reply remains in the shared
feed thread. This reference grants no new authority and does not advance the
proposal, participation, decision or execution stages. Ordinary comments and
unscoped Mecky questions keep their existing behavior.
