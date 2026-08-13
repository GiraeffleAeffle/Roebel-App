# ADR 0013: Canonical civic topics and projection-only feed cleanup

## Status

Proposed for staging.

## Context

The Röbel staging feed currently exposes several signed discussion roots for the same municipal subject as unrelated top-level cards. This makes a realistic test dataset look like timeline spam and loses the relationship between an initial observation, a structured discussion, Mecky assistance, and the later proposal workflow.

The signed Nostr events are audit evidence. Deleting or rewriting them merely to improve the feed would weaken provenance, can conflict with authorship, and would make restart and idempotency evidence harder to verify. A single topic can also legitimately contain more than one discussion when the questions are materially different.

The public app, Stadtstack case workflow, administrative workspace, governance view, and treasury review therefore need one stable subject identifier without collapsing their separate authority boundaries.

## Decision

1. Introduce a municipality-scoped **civic topic** with a stable canonical identifier. For example:

   `urn:stadtstack:topic:municipality:roebel-mueritz:lebenswerte-innenstadt`

2. Every structured discussion references exactly one civic topic. A discussion remains one signed Nostr root and its signed reply graph.
3. The normal feed renders one topic activity card and recent activity for related roots instead of presenting every root as an unrelated top-level subject.
4. Raw Nostr events remain the public evidence log. Feed cleanup is projection-only:
   - obsolete synthetic generations are archived from the current staging projection;
   - author-requested Nostr deletion requests retain their protocol semantics;
   - no operator bulk-deletes or rewrites signed events to make the UI cleaner.
5. Multiple discussions may share a topic only when their canonical questions are distinct. Reposts, retries, and test reruns are deduplicated by event and publication identifiers.
6. Proposal candidates link to the civic topic and the exact source discussion events. An admitted civic case retains those links; it does not replace them.
7. Mecky may suggest a structured discussion question, but a human app identity must confirm and sign the new root. Mecky does not create a resident discussion or admit a proposal autonomously.
8. A staging dataset release selects which synthetic activity is shown by default. Changing that projection never changes production data or the signed event log.

## Consequences

- A street, the Bürgerrat process, or a possible community meeting place can remain one recognizable subject while still accumulating distinct questions and workflow stages.
- The feed becomes quieter without deleting evidence.
- Topic identifiers, discussion identifiers, proposal identifiers, and civic-case identifiers remain separate and require explicit idempotency constraints.
- Existing staging roots need a deterministic backfill to a canonical topic before the grouped projection is enabled.
- Topic detail UI must expose the underlying signed discussions and provenance rather than hiding them behind a summary.
- This ADR does not authorize a formal vote, a municipal budget programme, a treasury transaction, or production data migration.
