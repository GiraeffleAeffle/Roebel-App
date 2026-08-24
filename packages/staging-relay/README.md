# Röbel isolated staging relay

The relay accepts valid NIP-01 events from its static fixture allowlist and from
public keys admitted through a protected internal HTTP endpoint.

For real staging accounts, configure all of the following together:

- `RELAY_ADMISSION_TOKEN`: high-entropy shared secret used only by the
  workbench;
- `RELAY_ADMISSION_STORE`: writable NDJSON file on the same bounded staging
  volume as the relay's owned state;
- `RELAY_EVENT_STORE`: event NDJSON file;
- `RELAY_ALLOWED_PUBKEYS`: static fixture keys.

`POST /internal/admissions` accepts only the exact
`roebel_staging_relay_admission_v1` schema and one lowercase 64-hex pubkey. The
relay does not verify wallets itself; it trusts only the separately configured
workbench token. The admission file is loaded before the event file so an
admitted citizen's signed events remain queryable after a same-Pod restart.

This endpoint must stay ClusterIP-internal. Do not route it through the public
Ingress, do not place its token in image metadata, and do not reuse the token in
production. The store has no broad deletion or revocation API; the bounded
staging namespace lifecycle owns cleanup.

## Bounded durable state

Both NDJSON stores fail closed before loading or appending beyond their owned
budget. Defaults are `96 MiB` / `50,000` event records and `16 MiB` / `10,000`
admission records; all hard caps are at or below `128 MiB` and `100,000`
records. When admissions are enabled, the two configured byte budgets together
must stay at or below `112 MiB`, preserving at least `16 MiB` of a `128 MiB`
`emptyDir` for filesystem metadata and write headroom. Configure lower limits with `RELAY_MAX_EVENT_STORE_BYTES`,
`RELAY_MAX_EVENT_COUNT`, `RELAY_MAX_ADMISSION_STORE_BYTES`, and
`RELAY_MAX_ADMISSION_COUNT`.

An over-limit event append receives `blocked: store capacity`. An admission
overflow receives HTTP `503` without admitting the key. A Pod restart refuses
to start when either owned file already exceeds its configured byte or record
limit, rather than scanning an unbounded file or silently discarding history.
