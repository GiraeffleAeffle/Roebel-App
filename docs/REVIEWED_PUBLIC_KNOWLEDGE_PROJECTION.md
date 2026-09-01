# Reviewed public knowledge projection

## Status

The Röbel consumer, explicit runtime composition, and GET-only reference
transport are implemented. This repository now also contains a minimal reviewed
Röbel corpus and the two public web routes that serve it. They are not evidence
of a production deployment until this change is merged and the normal Röbel
release process has completed; this work does not mutate staging or production.

## Purpose

Public Mecky should answer a normal tagged conversation like a civic, cited research assistant without gaining civic authority. The projection separates the expensive human decision—whether a particular source version is public and correctly represented—from routine automatic answers grounded in already admitted material.

```text
upstream source → immutable capture → human review/correction → public projection
                                                             ↓ GET only
normal Röbel post → @Mecky → bounded retrieval → cited answer (authority: none)
```

The answer path does not scrape, authenticate to or write back to the upstream source.

## Endpoints

For municipality `roebel-mueritz`, a producer may expose:

- `GET /api/federation/v1/municipalities/roebel-mueritz/public-knowledge/local-news`
- `GET /api/federation/v1/municipalities/roebel-mueritz/public-knowledge/ratsinformation`

The configured provider is one exact HTTPS origin. Cluster-internal HTTP is accepted only through an explicit option and only for an exact `*.svc.cluster.local` Service origin. Redirects, credentials in provider URLs, query strings and fragments are rejected.

The reviewed knowledge origin is deliberately separate from the Stadtstack
Civic Case origin. Röbel declares `https://www.roebel.app` for reviewed
news/RIS projections while retaining
`https://roebel-stadtstack.agentcart.eu` for reviewed Civic Cases. This prevents
one base URL from silently changing the authority or operator of another source.

## Closed envelope

```json
{
  "schemaVersion": "reviewed_public_knowledge_projection_v1",
  "municipalityId": "roebel-mueritz",
  "sourceKind": "local_news",
  "generatedAt": "2026-08-22T11:00:00.000Z",
  "records": [],
  "contentSha256": "sha256:<64 lowercase hex>"
}
```

`contentSha256` is SHA-256 over canonical JSON of the other five fields. Object keys are sorted recursively; array order remains significant. The consumer checks the checksum after strict schema validation and before returning any record.

The envelope has one source kind. Mixing news and council records is invalid. Separate adapters are composed only after each complete response passes.

## Record admission

Every record must already match the closed `PublicEvidence` source schema and have:

- the requested municipality and source kind;
- `admissionState: "admitted"`;
- a canonical review timestamp no earlier than publication and no later than projection generation;
- the fixed authority for its source;
- a unique evidence ID and unique source identity;
- an explicit lifecycle: `current`, `stale`, `superseded` or `withdrawn`.

Local news remains an attributed editorial report. Review establishes that the captured version, attribution and summary are fit for public retrieval; it does not make every claim in the article an official fact.

A Ratsinformationssystem item remains an official record. It proves what that exact paper or entry states. A calendar entry, agenda item or proposal does not prove a later decision, implementation or payment.

Only `current` records can rank into a Public Evidence Packet. Retraction and correction therefore take effect before model inference. The consumer has no stale-cache fallback: an unavailable or invalid projection is reported as `source_unavailable`.

## Runtime bounds

The adapter performs one credential-free `GET` with `Accept: application/json`, `credentials: omit`, `redirect: error`, `cache: no-store` and `referrerPolicy: no-referrer`. Defaults are:

- 5 second deadline;
- 512 kB maximum response;
- 50 records per source.

Configuration may only tighten or increase these values within the hard implementation ceilings of 30 seconds, 2 MB and 100 records. Any invalid record fails the entire source snapshot; partial admission is forbidden.

## Producer and activation responsibilities

For this initial static slice, the Röbel web repository owns the review gate:
the source URL or provider record ID, reviewed text, publication and review
times, admission decision and lifecycle are an explicit code-review diff. Each
`evidenceId` is the canonical SHA-256 of its complete reviewed capture (all
record fields except the digest itself), and the envelope has its own independent
checksum. Merging the change is the human admission step; the route does not
scrape or auto-admit upstream changes. A future producer may automate capture,
but provider-specific parsing and correction/supersession history must remain
behind the same reviewed boundary.

Röbel enables deployed sources explicitly through the canonical manifest fields
`agents.watcher.publicEvidence.reviewedSourceKinds` and
`agents.watcher.publicEvidence.reviewedKnowledgeBaseUrl`. The renderer passes
that closed declaration and exact origin to Public Mecky; neither may be
declared without the other and an undeclared source is not contacted. A failed
enabled source becomes only its own `source_unavailable` omission and cannot
erase admitted evidence from another source.

## Initial Röbel review set

The first review set deliberately contains one pair about the 2026 Röbel budget:

- **Local report:** Müritz Tipp, issue 4/2026, 7 March 2026,
  “Stadtvertreter in Röbel starten ins neue Jahr – Haushalt beschlossen,
  Investitionen geplant”. The admitted summary states only the article's
  supported high-level subjects and preserves the publisher URL.
- **Official record:** public ALLRIS proposal `BV-25-2026-007`, “Haushalt 2026
  der Stadt Röbel/Müritz”. Its public consultation sequence records the city
  council decision on 24 February 2026 as `ungeändert beschlossen`.

Both source destinations are stored verbatim in the checksum-bound records.
ALLRIS and the public Nostr index require query identifiers; the signed reply
projection and normal-feed UI admit only the exact public shapes
`/public/vo020?TOLFDNR=<digits>&VOLFDNR=<digits>&refresh=false` and
`/events?ids=<64-hex>`. Arbitrary query strings, credentials and fragments remain
rejected.

This slice uses the municipality's real public ALLRIS
Bürger-/Ratsinformationssystem. No public OParl endpoint was confirmed, so it
does not claim or fabricate OParl data, Kair, or openDesk integration.

The first real end-to-end release should use one reviewed local-news record and one reviewed council record for the same Röbel topic, then prove:

1. Mecky answers a normal signed mention with both authority labels and exact citations.
2. Withdrawing either record removes it before the next answer without changing the other source.
3. A checksum or municipality mismatch fails closed and produces an honest omission.
4. No case, administration, vote or treasury object is created by answering.
