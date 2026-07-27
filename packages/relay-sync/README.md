# @netizen-labs/relay-sync

Keeps a Netizen relay's **write allow-list** in step with **on-chain membership**, so
admission and revocation are automatic instead of hand-run `add-citizen.sh`.

Each pass:

1. Read the private `nostr_identities` registry (Supabase, **service-role key** — the
   table is deliberately unreadable by the anon key, since it maps wallet ↔ npub).
2. Verify the Nostr half of each binding offline (Schnorr/BIP-340).
3. Verify the Ethereum half via **ERC-1271** — Citizens hold ERC-4337 smart accounts,
   so this is an `eth_call`, not an `ecrecover`.
4. Confirm the wallet still holds a **CitizenNFTv2** on Gnosis.
5. Atomically rewrite the allow-list (temp file + `rename` in the same directory, so the
   strfry directory-mount picks it up by name).

**Revocation is not a special case:** a wallet that no longer holds the NFT simply fails
verification and is absent from the next write.

## The fail-closed rule

Any registry-fetch or RPC failure **aborts the pass and leaves the allow-list untouched.**
The alternative — treating an error as "no members" — would let one Supabase outage or one
flaky RPC write an empty file and revoke write access for the entire town. A stale
allow-list is a far better failure than an empty one.

This is covered by tests, and was re-verified against the real container on the node
(invalid key → `401` → file unchanged).

## Deployment (Röbel node, 178.105.19.80)

The package is not published to npm, and the box has no compose file — `strfry` and `caddy`
run as plain `docker run` containers. So it ships as a **single bundled file**:

```bash
pnpm --filter @netizen-labs/relay-sync build      # → dist/relay-sync.cjs (self-contained)
scp dist/relay-sync.cjs root@178.105.19.80:/root/relay-sync/relay-sync.cjs
```

On the box:

| Path | What |
|---|---|
| `/root/relay-sync/relay-sync.cjs` | the bundle |
| `/root/relay-sync/relay-sync.env` | config (mode `600`) |
| `/root/relay-sync/up.sh` | idempotent (re)create — **run this after any env change**, because `--env-file` is read at container-create time |

```bash
/root/relay-sync/up.sh                 # (re)start
docker logs -f netizen-relay-sync      # watch
```

### Environment

| Var | Value on the Röbel node |
|---|---|
| `SUPABASE_URL` | `https://wwbeqhkslxdxhktqzqti.supabase.co` |
| `SUPABASE_SERVICE_KEY` | **service_role** key — never the anon key |
| `GNOSIS_RPC_URL` | `https://rpc.gnosischain.com` |
| `CITIZEN_NFT_ADDRESS` | `0x59aA26f499D7C2B3EC2c8524Ed06F54fc4E85dE5` |
| `ALLOWLIST_PATH` | `/etc/strfry/citizens.txt` — see naming note |
| `SYNC_INTERVAL_SECONDS` | `120` (inside the 3-minute window the app polls after registering) |

**Naming note:** `netizen render` ships the policy as `strfry-policy/members.txt`, which is
this package's default. The currently-live Röbel box predates that and reads
`citizens.txt`, hence the explicit `ALLOWLIST_PATH`. Drop the override once the box is
re-applied from a fresh bundle.

## Prerequisites

The syncer reads `nostr_identities`. Until
`supabase/migrations/20260727_nostr_identity_bridge.sql` is applied and the
`nostr-identity-register` Edge Function is deployed, every pass fails closed and logs why —
which is correct, but means nobody gets admitted yet.

## Local

```bash
pnpm --filter @netizen-labs/relay-sync test
pnpm --filter @netizen-labs/relay-sync sync -- --once   # single pass, then exit
```
