# Maintaining Mecky's public knowledge

The Web projection and Mecky reader share one server-only contract in
`@roebel/stadtstack-federation-client/reviewed-public-knowledge`. The existing
news and council routes, source authorities and checksums remain compatible.
No additional runtime dependency or model provider is needed.

## Read-only catalogue

Set `ROEBEL_PUBLIC_KNOWLEDGE_DIRECTORY` to an absolute, read-only mount containing:

```text
<directory>/<municipalityId>/local-news.json
<directory>/<municipalityId>/ratsinformation.json
```

Each file is one complete `reviewed_public_knowledge_projection_v1` snapshot,
limited to 50 records and 512,000 bytes. Every request opens and validates the
current file. The response remains `no-store`, with the verified content digest
as its ETag. An atomic file replacement therefore changes the next retrieval
without rebuilding or restarting Web or Mecky. There is no public write route.

An unset directory keeps the bundled records for compatibility. A configured
but missing, malformed, oversized, future-dated or invalid snapshot returns a
generic 503. It never falls back to a bundled or previously cached record that
may have been withdrawn. News and council snapshots fail independently. Record
authority, review time, municipality, duplicate identities and the full checksum
are checked before any bytes are published. A checksum proves integrity; source
admission still belongs to the authorized publication owner.

## Prepare an edition

1. Keep the previous reviewed snapshot in the source owner's version history.
   Prepare a complete draft with the existing schema, excluding `contentSha256`.
   Preserve source URLs, publication/review dates, record IDs and authority.
2. Have the source owner review the extraction and its public visibility. Keep
   unreviewed records and private notes outside this directory. This command
   requires admitted records; it does not grant admission or infer a review.
3. Generate a new file from the reviewed draft:

   ```sh
   pnpm exec tsx apps/web/scripts/prepare-public-knowledge.ts reviewed-draft.json next-edition.json
   ```

   Preparation validates scope, limits, dates and the closed record schema, then
   seals the checksum. It refuses to overwrite an existing output.
4. Review the resulting exact diff/digest, then have the existing operations
   publisher replace the relevant mounted file atomically. Keep the mount
   read-only in Web and retain the prior edition as a receipt. Kubernetes
   ConfigMap volumes must use directory mounts, not `subPath`; projection updates
   become visible once Kubernetes has refreshed the volume.
5. Verify the public route's ETag and a question that identifies the new record.
   Confirm one unrelated question retains its own citations. For a correction,
   assign a new evidence ID to the revised content, retaining the stable source
   identity. For withdrawal, set the record lifecycle to `withdrawn` in a newly
   sealed edition; Mecky removes it before ranking on subsequent retrievals.

Initial configuration/mount activation is an operations rollout. Later content
editions still need source-owner review and publication, but no application
image, prompt change or per-topic deployment. Restoring an older edition also
requires review: it can reintroduce a deliberately withdrawn record.

## Scope and next acceptance

This slice supplies maintained storage for the existing news/council contract.
It does not import a larger corpus. Document sections/page references, linked
Bürgerrat recommendations, reviewed Kair bundles, catalogue discovery of Briefs
and contextual follow-ups remain subsequent work. Do not label a Bürgerrat
recommendation as a council decision to fit the current schema. Extend the
neutral source contract deliberately when that document path is implemented.

The served-route tests exercise addition, correction and withdrawal against the
same running reader, plus source outages, corrupt snapshots and scope rejection.
Language-model acceptance must additionally check that “not recorded in this
source” does not become “never happened”. Prompts now state this distinction;
that instruction alone is not proof that every generated answer satisfies it.
