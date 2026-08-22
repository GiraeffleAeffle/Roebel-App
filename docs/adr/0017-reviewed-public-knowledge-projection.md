# ADR 0017: Consume reviewed public knowledge through a checksum-bound projection

- Status: Accepted for staging
- Date: 2026-08-22

## Context

ADR 0016 fixes the source-authority boundary for Public Mecky, but a type in the answer process is not yet a safe production source. Directly crawling a newspaper, RSS feed, ALLRIS page or calendar while answering would bypass human source admission, make corrections difficult to enforce and couple Röbel to provider-specific markup. Requiring the administration to approve every Mecky answer would instead make ordinary conversation prohibitively expensive.

## Decision

Stadtstack publishes separate municipality-scoped projections for reviewed local news and reviewed Ratsinformationssystem records. Röbel consumes each projection through a source-specific, credential-free, GET-only adapter.

Each projection is closed, versioned and checksum-bound. It contains one source kind, one municipality, a generation time and exact admitted records. A record keeps its fixed authority (`editorial_report` or `official_record`), review time and lifecycle. The consumer rejects the whole source snapshot on an unknown field, checksum drift, duplicate identity, cross-municipality or cross-source record, pending review, future review, unsafe URL, redirect, oversized response or timeout. Withdrawn, stale and superseded records remain expressible but are removed before retrieval ranking.

The answer path never crawls upstream systems and receives no publisher, administration, case, voting or treasury credential. Once a source version is admitted, Mecky may answer ordinary tagged conversations automatically from it with citations and `authorityBinding: none`; humans review source admission, correction and official transitions, not every generated sentence.

The two source endpoints are deliberately independent:

- `/api/federation/v1/municipalities/{municipalityId}/public-knowledge/local-news`
- `/api/federation/v1/municipalities/{municipalityId}/public-knowledge/ratsinformation`

An outage or invalid snapshot for one endpoint yields a source omission and cannot admit partial records or silently borrow the other source's authority.

## Consequences

Röbel now owns a stable consumption contract without claiming that a reviewed producer endpoint or reviewed corpus is already deployed. Stadtstack can implement source collection, human review, correction and publication independently of the Mecky runtime. Provider-specific ALLRIS or news ingestion remains behind that publication boundary. Production activation requires at least one real reviewed record, correction tests and a deployed projection endpoint; raw or pending records continue to yield no factual answer.
