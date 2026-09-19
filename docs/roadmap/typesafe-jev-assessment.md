# TypeSafe / Jev: optional evaluation after catalogue coverage

Assessed 2026-09-19 against the current Mecky knowledge work. Decision: keep Jev
off the runtime path for now. Access to another model does not supply missing
source documents, versions, citations or contextual follow-ups.

TypeSafe documents typed Choice, Score and Noul judgments over supplied state.
Jev does not generate the citizen-facing explanation. A useful experiment would
be passage relevance ranking or suggestions of responsible departments; the
existing answer model would still explain the selected evidence.
[Official introduction](https://docs.typesafe.ai/introduction),
[patterns](https://docs.typesafe.ai/patterns).

Evaluate a pinned version on a small, labelled set of public passages after the
catalogue baseline exists. Include unrelated topics, ambiguous department
ownership, missing evidence and misleading embedded instructions. Compare
retrieval precision/recall, routing errors and abstention, latency, cost and
failure behavior with the current method. Derive thresholds from these results;
the returned confidence is computed from a distribution, not independent proof
of factual correctness or civic authority.
[Confidence documentation](https://docs.typesafe.ai/confidence).

Only add an Adapter if it improves that measured workload enough to justify the
extra request and provider dependency. Keep it switchable, bounded by a timeout
and able to fall back to existing retrieval. It may rank already admitted
sources or suggest a department. It may not admit evidence, cross a municipality
or discussion scope, grant a role, approve a response, create a decision or move
funds. Deterministic validation and explicit human transitions remain in code.

For the initial evaluation use public, non-personal material. TypeSafe's current
policy says inputs are not used for model training but services are hosted in
the US; it does not provide a fixed input retention period. Verify the applicable
processing agreement and deployment options before considering private municipal
data. No API call, credential configuration, SDK installation or data transfer
has been made for this assessment.
[Privacy policy](https://typesafe.ai/legal/privacy-policy).

Acceptance here is a measured optional addition. It is not a prerequisite for
Step 8, a replacement for the shared catalogue, or a commitment to a separate
classification microservice.
