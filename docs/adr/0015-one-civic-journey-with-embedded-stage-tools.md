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
   - openDesk owns administrative work;
   - governance and treasury systems own their authorized actions.
   They receive a scoped journey context and return an intent or receipt. They do not own the canonical topic, proposal, or case state.
7. Direct mini-app URLs may remain for development and deep linking, but the primary public route is the Röbel journey. Returning from a stage tool restores the same topic and stage rather than dropping the person into a separate product.
8. Desktop presents a persistent stage timeline alongside the active work surface. Mobile presents the same stages through a compact progress header and stage navigation; it does not squeeze a desktop process map into one horizontal strip.
9. Proposal, participation, treasury review, and execution remain visibly connected in the journey, while their permissions remain separate. Displaying a budget constraint never authorizes a treasury transaction; displaying an advisory signal never turns it into a formal vote.
10. Mecky may classify, summarize, cite, and suggest the next human action. It may not promote a post, sign for a person, admit a civic case, approve administration work, open a binding vote, or spend funds.
11. A proposal candidate is signed while the journey is still topic-bound. The next stage remains “awaiting human case admission”; signing never calls the admission, administration, participation, governance, or treasury adapters automatically.
12. Röbel renders **public administration progress** only from Stadtstack's redacted public case projection. It may show accepted, current department responses and a current Citizen Brief. A department absent from that projection is labelled only as “not publicly reviewed”; Röbel must not infer whether private work is missing, pending, rejected, corrected, or retracted.
13. The journey may enter **Mitmachen readiness** as soon as the current Citizen Brief is public. This stage exposes the reviewed brief and provenance but no input control, option counts, or outcome. An advisory round becomes open or complete only from its own reviewed projection; readiness alone never advances the canonical Stadtstack case stage.
14. Röbel reads administration progress through a case-bound, GET-only public projection. The response must match the journey's exact canonical case ID. Reviewed department entries retain their public package ID, package checksum, artifact checksum, and review date; conflicting case bindings hide the administration stage until a human resolves them. This reader exposes no case-steward command and grants no administrative authority.

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
- This ADR does not authorize automatic promotion, a formal municipal vote, a treasury payment, or production data migration.
