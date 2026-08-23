# Röbel civic workflow language

This glossary fixes the terms used by the Röbel app and Stadtstack integration.

| Term | Canonical meaning | Not the same as |
| --- | --- | --- |
| **Feed post** | A public Nostr kind-1 note shown in the general Röbel feed. Most feed posts remain ordinary social posts. | A civic topic, formal proposal, or administrative record. |
| **Source post** | An existing signed feed post that a human explicitly selects as evidence or the starting point for a civic topic. It remains unchanged and attributable to its author. | A copied topic summary or an automatically opened case. |
| **Civic promotion** | A human-confirmed action that creates a civic topic from a source post, attaches the post to an existing topic, starts a structured discussion, or advances reviewed material to a proposal candidate. | Automatic classification by Mecky or an administrative admission. |
| **Civic topic** | A stable, municipality-scoped subject that groups related feed posts and discussions across time. | A single Nostr thread, a proposal, or a case. |
| **Topic activity** | A feed projection of recent posts, discussions, arguments, and reviewed workflow updates belonging to one civic topic. | A new source of truth or a copy of the signed events. |
| **Civic journey** | The attributable lifecycle projection that lets a person follow one civic topic from its source posts through discussion, proposal, case, review, participation, decision, and any authorized execution. | One giant mutable record, a mandatory path for every post, or authority to skip a gate. |
| **Journey stage** | One explicitly named state in a civic journey with its own owner, inputs, receipts, and transition rule. | A decorative progress indicator or permission to perform the next action. |
| **Discussion** | One structured question under a civic topic, represented by a root feed post and its signed reply graph. | The whole topic or a vote. |
| **Argument** | A signed kind-1 reply carrying one `pro` or `con` stance and references to both the discussion root and its parent argument. | A counted ballot. |
| **Argument tree** | The parent/child projection of the signed argument graph. | A second source of truth. |
| **Sunburst** | A radial projection of the same argument tree. Area represents structure, not support or vote weight. | Poll results. |
| **Mecky answer** | Machine-labelled assistance produced from admitted public evidence with explicit source authority and citations. | Administrative feedback, legal advice, or an official position. |
| **Improvement proposal candidate** | A citizen-signed, topic-bound suggestion linking the exact discussion and reviewed Mecky receipt while still awaiting human Civic Case admission. | A Civic Case, submitted governance proposal, or administrative decision. |
| **Case Steward** | A separately authenticated human role that may admit one exact citizen-signed improvement proposal candidate after checking scope and responsibility. | Mecky, a public-app user action, administrative feedback, or authority to decide the proposal. |
| **Civic case** | The admitted, append-only Stadtstack workflow record. | The public discussion alone. |
| **Case binding receipt** | The public-safe, append-only proof that one exact signed candidate and source discussion were admitted as one exact Civic Case version. | A mutation of the signed Nostr root, the private admission command, or permission to advance later stages. |
| **Administrative feedback** | Human-reviewed department packages attached to the civic case. | Mecky output. |
| **Public administration progress** | The redacted journey view of accepted, current department responses and any current Citizen Brief. An absent response means only that no publicly reviewed answer is available. | A private work queue, a rejected response, or an inferred review status. |
| **Citizen Brief** | The public, source-bound explanation of reviewed options and constraints. | A press release or binding decision. |
| **Mitmachen readiness** | The public state in which a current reviewed Citizen Brief is visible in Mitmachen but no advisory participation round or result exists yet. | An open poll, an accepted input, a tally, or a formal vote. |
| **Mitmachen opinion signal** | A separate advisory participation round over reviewed options. | A formal municipal vote or binding on-chain governance action. |
| **Governance ballot** | A future explicitly authorized binding vote with frozen rules and authority. | The staging opinion signal. |
| **Treasury review** | A finance package that states budget needs, constraints, and possible funding source. | A payment or treasury transaction. |
| **App account** | The stable Röbel actor used for a personal or organisation profile and authored app content. | One wallet address, one login provider, or a publicly enumerable civic identity. |
| **Member identity** | The private, stable login subject that may control one or more app accounts through one or more proved credentials. | A public profile, wallet address, Nostr key, or verified-citizen status. |
| **Account credential** | A proved way to authenticate or authorize a member, such as the current Thirdweb smart account or a passkey-owned Safe. | The person, the app account, or civic eligibility. |
| **Citizen session** | The provider-neutral app interface that exposes the authenticated member, selected app account, signing capabilities, and authorization strength. | Thirdweb, Safe, Pimlico, or a React hook. |
| **Nostr identity** | The client-held signing identity used for public posts and discussions after explicit opt-in. | The app account, an administrative identity, or a Mecky workload identity. |
| **Identity binding** | The private, mutually proved association between one member identity and one Nostr public key, with credential-specific proofs retained for audit. | A public directory of residents and wallets. |
| **Stage tool** | A narrowly scoped mini-app or external adapter used inside one journey stage, such as an argument visualization, budget explorer, or administration handoff. | The canonical journey, a second source of truth, or an independent authority lane. |
| **Reviewed evidence** | A source URL or document version with content checksum, retrieval time, visibility, provenance, and human review state. | A model-generated claim. |
| **Source admission** | The source-specific decision that a public item may enter one Mecky retrieval query. Admission verifies eligibility, consent, review and correction requirements; it does not make every source statement true. | Source authority or civic approval. |
| **Source authority** | The fixed claim treatment attached to an admitted source: attributed community statement, editorial report, official record, or reviewed civic evidence. | Search rank, popularity, or formal decision authority. |
| **Public evidence packet** | A municipality- and query-scoped selection of admitted sources, exact evidence identifiers, authority labels, citations and omission counts. | A source of truth, hidden model memory, or a permission to act. |
| **Reviewed public knowledge projection** | A checksum-bound, municipality- and source-specific public snapshot of human-admitted news or council records that a retrieval adapter may consume with GET only. | A crawler result, raw source archive, blanket factual verification, or permission for Mecky to act. |
| **Synthetic evidence capability** | A staging-only, two-factor runtime capability that requires both the exact synthetic mode and an explicit E2E permission. | A production default or a capability granted by a leftover legacy environment variable. |
| **Administrative work package** | The idempotently exported, human-owned task created in openDesk only after proposal admission. | A raw feed post, Mecky answer, or automatic municipal decision. |
| **Staging dataset release** | A named projection selecting the currently demonstrated synthetic events while retaining older signed events as archived activity. | Deleting or rewriting the Nostr event log. |
| **Staging identity** | An explicitly labelled synthetic Nostr key used only by the isolated staging relay. | A resident, citizen credential, or production account. |

An ordinary feed post has no mandatory lifecycle. A civic journey begins only after an explicit human promotion:

`Feed post ──human promotion──> Civic topic → Discussion → Mecky answer → Citizen signature → Human admission → Civic case → Administrative review → Citizen Brief → Advisory Mitmachen signal → (separate authority gate) Governance ballot → (separate treasury gate) execution → public outcome`.

A post may instead remain standalone, join an existing civic topic without opening a discussion, or seed a new topic whose journey never advances beyond problem exploration.
