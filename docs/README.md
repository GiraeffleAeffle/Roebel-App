# Documentation index

Röbel is a live civic platform for a real German town, and the **Netizen stack** is the
forkable generalisation of it. This directory has ~50 documents; this page is how you find
the right one.

**Start here depending on what you are doing:**

| I want to… | Read |
|---|---|
| Understand what exists today, at a glance | [State of the Netizen Stack](STATE_OF_THE_NETIZEN_STACK.md) |
| Know what is running on the sovereign node | [State of the Netizen Node](STATE_OF_THE_NETIZEN_NODE.md) |
| Work on Nostr, relays, or federation | [State of Nostr](STATE_OF_NOSTR.md) |
| Run my own node | [Netizen Node manifest](superpowers/specs/2026-07-26-netizen-node-manifest.md) → [installer](superpowers/specs/2026-07-26-netizen-node-installer.md) |
| Contribute code | [Contributor onboarding](CONTRIBUTOR_ONBOARDING.md), [Forking guide](FORKING_GUIDE.md) |
| Know what we deliberately have NOT built, and why | [Roadmap and deferred work](ROADMAP_AND_DEFERRED.md) |
| Know who holds which key, and who can revoke it | [Key governance](KEY_GOVERNANCE.md) |
| Know our GDPR/AI-Act duties and the deletion path | [DSGVO & AI Act compliance](DSGVO_AI_ACT_COMPLIANCE.md) |
| Decide where a new kind of data belongs | [Data placement and CRUD](DATA_PLACEMENT_AND_CRUD.md) |
| Publish app data (events, cinema, orgs, marketplace) to Nostr | [Public data on Nostr](PUBLIC_DATA_ON_NOSTR.md) |
| Work with the Stadtstack contributor | [Röbel × Netizen × Stadtstack alignment](STADTSTACK_ALIGNMENT.md) |
| Understand the mission | [Mission and goals](MISSION_AND_GOALS.md) |

## How these documents relate

The three **State of…** documents are the canonical answer to *"what is true right now"*.
Everything else is either a **design spec** (what we decided and why), **research** (what we
learned, including what turned out false), or a **runbook** (how to operate a thing).

```
STATE_OF_THE_NETIZEN_STACK.md      what the whole system is, and what is live
  ├── STATE_OF_THE_NETIZEN_NODE.md what runs on the box, and how to reproduce it
  └── STATE_OF_NOSTR.md            identity bridge, relay, allow-list, federation

ROADMAP_AND_DEFERRED.md            what is deliberately NOT built, and its trigger
```

The roadmap is the counterpart to the State docs: they say what is true, it says what was
consciously left undone. Every entry carries a **trigger** — the condition that makes it worth
doing — because an item without one is a wish, and an item without a stated reason is an
oversight.

A **State of…** doc that disagrees with reality is a bug. If you find one, fix it in the same
change as the code — the reason these exist is that a contributor cannot read a running
container.

- [State of the Sovereign Arbeitsbereich](SOVEREIGN_ARBEITSBEREICH_STATE.md) — the native workspace: what shipped, honest limits, and the four gates to turn it on
- [Security findings 2026-07-28](SECURITY_FINDINGS_2026-07-28.md) — two OPEN production RLS issues found while building it, plus the cross-org takeover that was fixed

## The rest, by category

**Design specs** — `superpowers/specs/`. One per slice of work, written before the code and
updated when reality disagreed with the design. The Nostr ones are worth reading as examples:
they record assumptions that were **wrong** and what replaced them.

**Research** — `future-research/`. Strategy and technology evaluation, including honest
"unverified" sections. Several claims here were later checked on-chain and corrected; the
corrections stayed in the documents rather than being quietly edited out. Newest:
[IT-Planungsrat blockchain report → regulatory landscape 2026](future-research/2026-07-29_ITPLR_BLOCKCHAIN_REGULATORY_LANDSCAPE.md)
(EUDI wallet, MiCA, municipal-token precedents, funding pipeline), whose operative
consequences live in [DSGVO & AI Act compliance](DSGVO_AI_ACT_COMPLIANCE.md).

**Runbooks** — operational procedures: [MACI Shamir operations](MACI_SHAMIR_OPERATIONS.md),
[deployment playbook](DEPLOYMENT_PLAYBOOK.md), [Hetzner setup](HETZNER_SETUP.md),
[donations operations](DONATIONS_OPERATIONS.md), [Nostr relay setup](NOSTR_RELAY_SETUP.md).

**Subsystem state** — deeper than the summaries above, for people working in that area:
[Circles / Röbel Münzen](CIRCLES_ROEBEL_MUENZEN_STATE.md),
[XMTP integration](XMTP_INTEGRATION_STATE.md),
[Workspace](WORKSPACE_STATE_AND_NEXT.md),
[Verification system](VERIFICATION_SYSTEM_STATUS.md).

## Conventions

- **Dates are absolute.** "Recently" is meaningless six months later.
- **Say what is unverified.** A documented unknown is useful; a confident guess is a trap.
  Both Nostr specs name assumptions that turned out false, and that is why they were caught.
- **Link, don't duplicate.** If a fact belongs in a State doc, link to it rather than
  restating it, so there is one place to fix when it changes.
