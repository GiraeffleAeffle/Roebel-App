# ADR 0011: Native Nostr discussion and civic handoff

- Status: Accepted for staging
- Date: 2026-08-13

## Context

Röbel already presents a social feed, Nostr record readers, proposals, Mecky, and governance surfaces. A separate workflow mini-app made the technical lifecycle testable but did not let people experience the flow where the discussion actually happens. Staging needs realistic interaction without mixing synthetic identities or test votes into production.

## Decision

The Röbel app owns the public experience:

1. synthetic signed Nostr posts appear as native feed cards;
2. a discussion route projects standard kind-1 replies into a pro/con tree;
3. a sunburst is a second projection of the same signed graph;
4. `@Mecky` answers as a machine-labelled Nostr author using only reviewed, checksum-bound public evidence;
5. only a human-controlled synthetic identity may sign an improvement proposal candidate;
6. Stadtstack owns admission, append-only case state, role-separated review, Citizen Brief, and advisory participation;
7. the result returns to the Röbel app as a native proposal/participation surface.

The isolated backend remains behind `/stadtstack-test/api`. Its diagnostic HTML is not the product UI and is not linked from the feed.

## Nostr graph

- root: kind 1, `stance=root`, `argument-root=self`;
- claim: kind 1 with NIP-10 `e` tags for root and reply parent, `argument-root=<root id>`, and exactly one `stance=pro|con`;
- Mecky reply: kind 1, `netizen_agent`, NIP-10 parent, evidence digests, and a Mecky answer receipt;
- proposal candidate: citizen-signed kind 1 linking the root discussion and Mecky receipt.

Relays and clients may verify every signature independently. The application may cache projections, but the signed events remain the discussion record.

## Authority boundary

Staging visibly labels all identities and artifacts synthetic. Mecky cannot admit a case, approve a department package, cast a vote, or spend funds. The Mitmachen result is advisory. Any formal governance ballot or treasury action requires a distinct ADR, owner, ruleset, and live authorization.

## Consequences

- The flow is testable in the actual Röbel navigation and responsive shell.
- Tree and sunburst cannot silently diverge because both are derived by one module.
- The isolated relay can be removed without touching production Nostr data.
- Promotion to production requires real identity, moderation, retention, accessibility, and authority reviews; staging success alone is insufficient.
