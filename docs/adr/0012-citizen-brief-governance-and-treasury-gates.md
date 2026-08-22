# ADR 0012: Citizen Brief, governance, and treasury gates

- Status: Accepted boundary; formal governance and treasury execution deferred
- Date: 2026-08-13

## Context

Users should be able to follow an idea from discussion to a public explanation and participation surface. That continuity must not make an advisory staging signal look like a municipal decision or make a budget estimate look like permission to spend.

## Decision

The public proposal page shows four separate layers:

1. **discussion evidence** — signed public claims and Mecky citations;
2. **administrative review** — reviewed feasibility, legal, finance, mobility, environment, and other department packages;
3. **Citizen Brief** — the source-bound public synthesis of options, constraints, uncertainty, and the next responsible owner;
4. **Mitmachen** — an explicitly advisory opinion signal over the reviewed options.

The Citizen Brief is available to the public Mecky as reviewed context and visible in the Mitmachen proposal. It may be updated only by a new reviewed case version; older versions remain attributable.

A current reviewed Citizen Brief is shown in Mitmachen immediately as **Mitmachen readiness**, before any participation round or result exists. Missing participation data means only “not opened”; the interface must not invent options, accepted inputs, a tally, or an outcome. A completed advisory state is rendered only when a current `participationResult` and current `reviewedOutcome` arrive together and checksum-bind the exact Citizen Brief and each other. Opening a future input round requires its own reviewed rules and signed-input seam; this ADR does not authorize that write path.

Formal governance is a later transition, not a renamed advisory result. It requires a participation contract, eligible electorate, frozen rules, privacy and representation review, competent authority, and a verifiable tally. Treasury execution is later still: it requires an approved budget scope, Safe/treasury authority, signer policy, amount/asset/recipient limits, and an exact rollback or compensating-action plan.

## Staging behavior

- two synthetic users may discuss and sign candidates;
- administration, Citizen Brief, and advisory participation are synthetic but exercise the real schemas;
- a current Citizen Brief may be visible while the advisory round is explicitly labelled “Noch nicht geöffnet” and has no input control;
- no production account, production relay, formal vote, Safe transaction, transfer, commitment, or notification is used;
- the UI always renders “Keine echte Abstimmung” and “keine Auszahlung”.

## Promotion gates

Production enablement is blocked until the public Nostr relay policy, moderation, user consent, identity binding, Mecky evidence policy, administrative ownership, governance authority, and treasury controls each have their own reviewed operational receipt.
