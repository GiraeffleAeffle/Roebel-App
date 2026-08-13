# Röbel civic workflow language

This glossary fixes the terms used by the Röbel app and Stadtstack integration.

| Term | Canonical meaning | Not the same as |
| --- | --- | --- |
| **Feed post** | A public Nostr kind-1 note shown in the Röbel feed. | A formal proposal or administrative record. |
| **Civic topic** | A stable, municipality-scoped subject that groups related feed posts and discussions across time. | A single Nostr thread, a proposal, or a case. |
| **Topic activity** | A feed projection of recent posts, discussions, arguments, and reviewed workflow updates belonging to one civic topic. | A new source of truth or a copy of the signed events. |
| **Discussion** | One structured question under a civic topic, represented by a root feed post and its signed reply graph. | The whole topic or a vote. |
| **Argument** | A signed kind-1 reply carrying one `pro` or `con` stance and references to both the discussion root and its parent argument. | A counted ballot. |
| **Argument tree** | The parent/child projection of the signed argument graph. | A second source of truth. |
| **Sunburst** | A radial projection of the same argument tree. Area represents structure, not support or vote weight. | Poll results. |
| **Mecky answer** | Machine-labelled assistance produced from checksum-bound reviewed evidence. | Administrative feedback, legal advice, or an official position. |
| **Improvement proposal candidate** | A citizen-signed suggestion derived from a discussion and Mecky answer, awaiting human admission. | A submitted governance proposal. |
| **Civic case** | The admitted, append-only Stadtstack workflow record. | The public discussion alone. |
| **Administrative feedback** | Human-reviewed department packages attached to the civic case. | Mecky output. |
| **Citizen Brief** | The public, source-bound explanation of reviewed options and constraints. | A press release or binding decision. |
| **Mitmachen opinion signal** | A separate advisory participation round over reviewed options. | A formal municipal vote or binding on-chain governance action. |
| **Governance ballot** | A future explicitly authorized binding vote with frozen rules and authority. | The staging opinion signal. |
| **Treasury review** | A finance package that states budget needs, constraints, and possible funding source. | A payment or treasury transaction. |
| **App account** | The private Röbel login and wallet actor used for account recovery, permissions, and app actions. | A publicly enumerable civic identity. |
| **Nostr identity** | The client-held signing identity used for public posts and discussions after explicit opt-in. | The app account, an administrative identity, or a Mecky workload identity. |
| **Identity binding** | The private, mutually proved association between one app account and one Nostr public key. | A public directory of residents and wallets. |
| **Reviewed evidence** | A source URL or document version with content checksum, retrieval time, visibility, provenance, and human review state. | A model-generated claim. |
| **Administrative work package** | The idempotently exported, human-owned task created in openDesk only after proposal admission. | A raw feed post, Mecky answer, or automatic municipal decision. |
| **Staging dataset release** | A named projection selecting the currently demonstrated synthetic events while retaining older signed events as archived activity. | Deleting or rewriting the Nostr event log. |
| **Staging identity** | An explicitly labelled synthetic Nostr key used only by the isolated staging relay. | A resident, citizen credential, or production account. |

The lifecycle is:

`Feed post → Civic topic → Discussion → Mecky answer → Citizen signature → Human admission → Civic case → Administrative review → Citizen Brief → Advisory Mitmachen signal → (separate authority gate) Governance ballot → (separate treasury gate) execution`.
