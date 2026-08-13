# Real Röbel staging: topic, identity, Mecky, and administration flow

## Status

Proposed integration specification. It consolidates the current public Röbel UI, Nostr identity bridge, Mecky watcher, Stadtstack case workflow, openDesk handoff, and namespace-scoped deployment route. It does not authorize production or municipal effects.

## What works today

| Capability | Current state |
| --- | --- |
| Sign up in the Röbel web app | The app can create an app/wallet account. Posting remains subject to the current citizen or organisation gate. |
| Public staging discussion | Works with labelled synthetic Nostr identities on the isolated staging relay. |
| Pro/con tree and sunburst | Work as projections of the synthetic signed reply graph. |
| `@Mecky` reply | Works for the prepared staging discussion and reviewed evidence fixture. |
| Proposal/case demonstration | Works as a synthetic, non-authoritative handoff. |
| Normal user post reaches Nostr/Mecky | **Not implemented on Web.** The normal composer writes the app post but does not yet produce the signed Nostr publication watched by Mecky. |
| Mecky creates a discussion on request | **Intentionally not automatic.** Mecky may propose a question; a human must confirm and sign the discussion root. |
| Administrative openDesk handoff | Contract boundary exists; the admitted, idempotent live handoff is not yet enabled. |
| Binding vote or treasury execution | Not enabled and outside the staging authority. |

## Canonical aggregate boundaries

```text
AppAccount --private proof--> NostrIdentity
                                  |
                                  v
FeedPost --> CivicTopic --> Discussion --> Argument
                    |              |
                    |              +--> MeckyAnswer(reviewed evidence only)
                    |                            |
                    +--> ProposalCandidate <----+
                              |
                         human admission
                              v
                          CivicCase
                     /         |          \
           openDesk package  CitizenBrief  TreasuryReview
                                      |
                              advisory Mitmachen signal
                                      |
                            separately authorized ballot
```

The app account, Nostr identity, Mecky workload identity, administrative identity, and governance identity are different principals. No bulk public table may expose their private associations.

## Identifier and idempotency contract

Existing records are reused rather than duplicated:

- `nostr_identities` remains the private app-account-to-Nostr-key binding.
- `nostr_publications` remains the publication retry and idempotency ledger.
- `nostr_events.id` remains the global signed-event primary key across overlapping relays.

The following logical records are added or made explicit:

| Record | Stable identifier | Required uniqueness |
| --- | --- | --- |
| Civic topic | canonical municipality URN | `(municipality_id, canonical_slug)` |
| Discussion | signed root event ID | `root_event_id`; exactly one topic |
| Argument | signed event ID | `event_id`; exact root and parent references |
| Mecky answer | signed reply event ID | one accepted answer per `(mention_event_id, agent_pubkey, policy_version)` |
| Proposal candidate | citizen-signed proposal event ID plus content checksum | one publication per signed candidate |
| Civic case | canonical case URN | one admitted case per accepted proposal candidate |
| Administrative outbox item | deterministic operation key | `(case_id, case_version, target, operation)` |

Argument trees and topic activity are projections over the signed event index. They are not mutable copies of the event content.

## Real staging account flow

1. A tester creates or restores an app account.
2. The staging gate grants only the explicit tester role; it must not weaken the production citizen-verification rule.
3. The tester opts in to a Nostr identity. The signing secret remains client-held; a private mutual proof binds the public key to the app account.
4. The normal composer creates a signed Nostr post in addition to the app post. The exact signed event is registered in the publication ledger before relay retry. A retry republishes the same event ID.
5. A civic post references one canonical topic. “Start discussion” turns a human-confirmed question into a signed root.
6. An `@Mecky` mention carries the exact Nostr `p` tag. The watcher consumes that event once and replies in the same thread.
7. If a user asks Mecky to start a discussion, Mecky returns a suggested question and an action for the user to review. The user signs the root; Mecky never impersonates the user.

## Evidence and Mecky policy

Mecky answers from the reviewed Stadtstack evidence projection, not directly from arbitrary web search results. Each evidence item must carry:

- source URL or document identifier;
- source and retrieval timestamps;
- content checksum and parser version;
- municipality and topic binding;
- licence/visibility classification;
- review status and reviewer receipt.

Local news and council-information-system connectors are read-only ingestion sources. Their content enters a quarantine/review stage before Mecky can cite it. A model response records the exact evidence identifiers used. Missing reviewed evidence yields an honest “not verified yet” answer.

## Administration and openDesk

Only an admitted civic case creates administrative work. The export uses an outbox with the deterministic operation key above and contains the case ID, source checksums, human owner, department package, and return channel. It does not forward raw private account mappings or grant Mecky administrative authority.

openDesk returns human-reviewed packages. Stadtstack converts those packages into a source-bound Citizen Brief, and the Röbel app projects the brief back onto the same civic topic. The Mitmachen view remains advisory until an independently accepted governance rule activates a ballot. Treasury review can state funding constraints; it cannot move funds.

## Staging topic set

The next dataset release should replace timeline spam with topic projections while retaining the old signed events as archived activity:

1. **Marienfelder Straße** — the current end-to-end safety discussion and proposal fixture.
2. **Lebenswerte Innenstadt** — a source-labelled topic for the official Röbel Bürgerrat process and its published results when available.
3. **Begegnungsort in Röbel** — a clearly labelled community question about a possible meeting place or bar; not presented as an established fact or municipal plan.
4. **Bürgerbudget-Labor** — optional and explicitly hypothetical until Röbel adopts published rules. No Strausberg amount or per-proposal ceiling is represented as Röbel policy.

Public `index.roebel.app` events may be shown through their original signed events and provenance. They must not be copied into synthetic personas or silently re-authored.

## Feed behaviour

- The normal feed contains topic activity; there is no visually separate “test feed” once the real staging account slice is enabled.
- One topic card may reference several distinct discussions and shows the latest activity, source status, and workflow stage.
- A topic page exposes each signed root, its argument tree/sunburst, Mecky replies, provenance, proposal state, and Citizen Brief.
- Test/retry events are deduplicated by signed event ID and publication key.
- Switching the current staging dataset release archives old synthetic cards from the default projection without deleting their Nostr events.

## CI, GitOps, and operator access

The fast release path is:

```text
Röbel PR -> remote scoped CI -> immutable GHCR digest
         -> reviewed private-ops digest update
         -> Flux tenant Kustomization
         -> stadtstack-roebel-web-preview only
```

Flux should apply through a dedicated ServiceAccount whose RBAC is limited to the Röbel staging namespace and exact resource kinds. Image tags are not deployment inputs. Secrets remain outside the public repository and are decrypted or referenced only in the private operations boundary. The public app workflow publishes images; it does not receive cluster-admin credentials.

Flux pulls Git and image state outbound, so it does not require Tailscale. Human/Freelens access should first restore the existing bounded rootless WireGuard viewer. A Tailscale Kubernetes Operator is optional for operator convenience, but it is a separate cluster-wide dependency and authority decision, not a prerequisite for GitOps.

## Acceptance slice

The next vertical slice is complete only when one real staging tester can:

1. create an app account and opt in to the private identity binding;
2. publish one normal-feed post as a signed Nostr event;
3. convert it into or attach it to one canonical civic topic;
4. mention Mecky and receive one signed, evidence-bound reply in the same thread;
5. review and sign a proposed discussion question;
6. see the topic exactly once in the normal feed and open all underlying signed activity;
7. produce a citizen-signed proposal candidate without creating an administrative case automatically;
8. observe an idempotent admitted-case/openDesk round trip in staging;
9. see a source-bound Citizen Brief and advisory Mitmachen state;
10. repeat the flow after restart with no duplicate events, topics, replies, cases, or work packages.

No step in this slice is a real municipal vote, a production migration, a treasury payment, or permission to publish personal test data outside staging.
