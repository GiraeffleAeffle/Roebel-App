# ADR 0011: Native Nostr discussion and civic handoff

- Status: Accepted for staging
- Date: 2026-08-13

## Context

Röbel already presents a social feed, Nostr record readers, proposals, Mecky, and governance surfaces. A separate workflow mini-app made the technical lifecycle testable but did not let people experience the flow where the discussion actually happens. Staging needs realistic interaction without mixing synthetic identities or test votes into production.

## Decision

The Röbel app owns the public experience:

1. ordinary signed Nostr posts and promoted civic activity both appear in the native general feed;
2. only an explicit human action links a source post to a civic topic or creates a structured discussion from it;
3. a discussion route projects standard kind-1 replies into a pro/con tree;
4. a sunburst is a second projection of the same signed graph;
5. `@Mecky` answers as a machine-labelled Nostr author using only reviewed, checksum-bound public evidence;
6. only an authenticated citizen session may sign a topic-bound improvement proposal candidate; labelled synthetic identities remain an isolated staging fixture;
7. the candidate contains no Civic Case identifier and has no administrative effect; a separate human admission may create the append-only Stadtstack case;
8. Stadtstack owns admission, append-only case state, role-separated review, Citizen Brief, and advisory participation;
9. the result returns to the same Röbel civic journey as a native proposal/participation surface.

The isolated backend remains behind `/stadtstack-test/api`. Its diagnostic HTML is not the product UI and is not linked from the feed.

## Nostr graph

- root: kind 1, `stance=root`, `argument-root=self`;
- claim: kind 1 with NIP-10 `e` tags for root and reply parent, `argument-root=<root id>`, and exactly one `stance=pro|con`;
- Mecky reply: kind 1, `netizen_agent`, NIP-10 parent, evidence digests, and a Mecky answer receipt;
- proposal candidate: citizen-signed kind 1 linking municipality, civic topic, root discussion, and Mecky receipt; it carries no `case` or `stadtstack-case` tag before admission.

Relays and clients may verify every signature independently. The application may cache projections, but the signed events remain the discussion record.

## Authority boundary

Staging visibly labels the environment and every synthetic fixture; a connected tester remains a real signed account in a non-production lane and is never relabelled as synthetic. Mecky cannot admit a case, approve a department package, cast a vote, or spend funds. The Mitmachen result is advisory. Any formal governance ballot or treasury action requires a distinct ADR, owner, ruleset, and live authorization.

## Consequences

- The flow is testable in the actual Röbel navigation and responsive shell.
- Tree and sunburst cannot silently diverge because both are derived by one module.
- The isolated relay can be removed without touching production Nostr data.
- Promotion to production requires real identity, moderation, retention, accessibility, and authority reviews; staging success alone is insufficient.
