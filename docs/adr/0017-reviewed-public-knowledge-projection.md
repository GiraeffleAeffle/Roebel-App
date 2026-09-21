# ADR 0017: Consume reviewed public knowledge through a checksum-bound projection

- Status: Accepted for staging
- Date: 2026-08-22

## Context

ADR 0016 fixes the source-authority boundary for Public Mecky, but a type in the answer process is not yet a safe production source. Directly crawling a newspaper, RSS feed, Ratsinformationssystem (RIS) page or calendar while answering would bypass human source admission, make corrections difficult to enforce and couple a deployment to provider-specific markup. Requiring the administration to approve every Mecky answer would instead make ordinary conversation prohibitively expensive.

## Decision

An authorized municipal publication producer publishes municipality-scoped
records for reviewed local news and Ratsinformationssystem material. A
municipality-operated Kair/openDesk/RIS adapter may be that producer after an
explicit human municipal transition. Stadtstack validates and projects the
record; Röbel—or any other frontend—consumes it through a source-specific,
credential-free, GET-only adapter.

Each projection is closed, versioned and checksum-bound. It contains one source kind, one municipality, a generation time and exact admitted records. A record keeps its fixed authority (`editorial_report` or `official_record`), review time and lifecycle. The consumer rejects the whole source snapshot on an unknown field, checksum drift, duplicate identity, cross-municipality or cross-source record, pending review, future review, unsafe URL, redirect, oversized response or timeout. Withdrawn, stale and superseded records remain expressible but are removed before retrieval ranking.

The answer path never crawls upstream systems and receives no publisher, administration, case, voting or treasury credential. Once a source version is admitted, Mecky may answer ordinary tagged conversations automatically from it with citations and `authorityBinding: none`; humans review source admission, correction and official transitions, not every generated sentence.

The outward exchange is city-neutral. An official record may have an
OParl-compatible public representation, an MCP query projection and a signed
Nostr/Netizen replication event. Those interfaces neither replace OParl nor
create authority: `official_record` comes only from the attributable municipal
producer and covers only what that publication states.

The two source endpoints are deliberately independent:

- `/api/federation/v1/municipalities/{municipalityId}/public-knowledge/local-news`
- `/api/federation/v1/municipalities/{municipalityId}/public-knowledge/ratsinformation`

An outage or invalid snapshot for one endpoint yields a source omission and cannot admit partial records or silently borrow the other source's authority.

## Consequences

Röbel now owns a stable consumption contract and composes only the explicitly
declared reviewed source kinds into the same bounded catalog as reviewed Civic
Cases and the directly mentioning signed post. Stadtstack implements the
checksum-bound preparation and exact GET-only reference transport independently
of the Mecky runtime. The source kinds remain disabled in a node manifest until
their reviewed endpoints are actually deployed, so shipping this code cannot
turn a missing source into an endless production dependency.

Provider-specific RIS or news ingestion remains behind the publication boundary.
Production activation requires reviewed records, correction tests and a deployed
projection endpoint; raw or pending records continue to yield no factual answer.

### Maintained catalogue storage — 2026-09-19

Two reviewed source snapshots are now served by Röbel. The optional maintained
catalogue replaces their compiled storage with a read-only directory of the same
closed projection files. Producer and consumer share the server-only contract in
the existing federation-client package; the browser entry point stays unchanged.
Each request validates the current file, so a newly published edition or
withdrawal needs no application rebuild. Configured source failure returns 503
and never resurrects bundled content. Initial mount activation belongs to
operations; source updates still require their publication owner's review.
See the [maintenance runbook](../runbooks/maintained-public-knowledge.md).
This storage path does not itself import a wider corpus or admit new source kinds.

### Attributed document sections — 2026-09-20

The same projection now accepts an explicitly configured `community_document`
source at `community-documents`. It carries fixed `community_statement`
authority: a Bürgerrat recommendation remains attributed to that group. An
official Kair/administration publication still needs its municipal producer and
authority contract; this source kind cannot grant it official status.

Each section records a stable document/section ID, document checksum, publisher,
attribution, physical page range, printed page label and optional reviewed topic
links. An unknown publication date stays null. Section evidence IDs bind the
content, provenance, review and lifecycle; the projection additionally binds its
public citation URL. The URL identifies the exact section version. Multiple
sections of one document must agree on the source version. Neither the raw PDF
nor a private filesystem path is required in the public projection.

General questions can retrieve admitted sections alongside other sources. A
discussion question can retrieve only sections explicitly linked to the topic
of its freshly read, signature-verified root. Similar wording does not link a
section to a Case. The public source reader shows a changed/withdrawn state
instead of silently substituting a new passage behind an old citation. No new
index, model provider, database or write interface is introduced.

This adds the source capability. A reviewed edition, configured mount and explicit
Mecky source declaration remain separate activation steps. Source admission is
not inferred from the preparation command or from shipping the reader.
