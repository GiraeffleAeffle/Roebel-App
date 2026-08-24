# ADR 0019: Role-isolated Case Steward admission and public binding receipts

- Status: Accepted boundary for staging; deployment pending
- Date: 2026-08-23

## Context

A citizen can now sign a topic-bound improvement proposal candidate in the public Röbel journey. Turning that candidate into a Civic Case is a materially different human authority action. The current diagnostic workbench can call a Case Steward command with a server-held token, while the public projection still discovers case membership from tags on the immutable discussion root. Exposing that command through the public Web would let a browser cross the human-admission gate; adding a case tag after the fact would rewrite signed history.

## Decision

Case admission is owned by a separate, privileged Case Steward module and deployable. The public Röbel Web may sign and publish the candidate, show that it awaits review, and read a public result; it never receives a Case Steward credential and never exposes an admission, completion, administration, openDesk, voting, or treasury command.

The Case Steward command accepts one closed request containing the exact signed discussion root, reviewed Mecky answer and citizen-signed candidate. A separately authenticated staff identity must hold the `case_steward` role and explicit Röbel municipality scope. The command verifies all signatures and bindings, derives the new case identifier from the candidate, requires an initial expected version of `0`, and invokes the append-only coordinator idempotently. The durable adapter must claim the discussion root, append the case creation, discussion evidence and candidate admission, and enqueue the binding receipt atomically or not at all. That root claim is municipality-wide so two replicas cannot admit different candidates for one immutable discussion.

The atomic result includes a public-safe **Case binding receipt** that binds the municipality, topic, discussion root, Mecky answer, candidate, Civic Case identifier, case version, journal head and admission checksum with `authorityBinding: none`. A separate credential-free, GET-only public projection exposes that receipt after replaying the durable outbox. Its checksum detects corruption and binds the fields; it is not independently authentic without the trusted Stadtstack projection endpoint or a later signed inclusion proof. Röbel advances the journey from this receipt; it does not modify the signed Nostr root or infer admission from a missing or pending response. Existing case tags remain a labelled legacy staging compatibility path only.

The Röbel Web consumes that projection only through its server-side BFF at `GET`/`HEAD` `/api/stadtstack/case-bindings/by-discussion/:rootId`. `STADTSTACK_PUBLIC_CASE_BINDING_ORIGIN` is a server-only HTTPS origin with no path, query, userinfo, browser exposure, forwarded request headers, or credentials. The BFF performs a short, no-store, credential-free exact-path read, verifies the complete `public_case_binding_receipt_v1` checksum and transport checksum, and returns only the verified receipt. `404` means no admitted binding; malformed upstream data and availability faults collapse to a generic `503`. The browser never receives the public-reader origin, and only this verified BFF result may advance CivicCase or administration stages.

The control handler and public reader use separate composition roots, pods, service accounts, Services and ingress/network policies. The public reader exposes no writer, authenticator, coordinator or admission method. The public HTTP adapter rejects oversized or deeply nested bodies before decoding; unknown control faults are logged privately and returned only as a generic availability failure.

Admission does not automatically contact openDesk. Creating an administrative work package is a later, separately authenticated and idempotent human action with its own outbox receipt. Governance, participation and treasury effects remain behind their existing distinct authority gates.

## Consequences

- Public admission/completion routes are removed now. The remaining legacy server-side Case Steward token used for the diagnostic public administration projection is removed when that read is switched to the credential-free binding/projection service.
- A staff console/control deployable and its identity provider become required before a real candidate can advance in staging.
- Post-hoc admission preserves Nostr immutability and can be projected consistently into feed, topic, discussion, administration and Mitmachen views.
- The control deployable, public receipt projection and staff console need separate least-privilege GitOps resources plus two-replica uniqueness, crash-replay and browser acceptance tests before Slice 4 is complete.
