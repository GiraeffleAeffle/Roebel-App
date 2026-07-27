# DNS — from manual clicking to autonomous setup

**Date:** 2026-07-27
**Why this exists:** standing up the Röbel node required a human to hand-enter DNS
records in a registrar's web UI. That is the single biggest remaining manual step in
"one command spins up a sovereign node", it produced **three separate outages**, and it
is fully automatable. This document records exactly what was needed and specifies how
`netizen` does it without a human.

---

## 1. What a node actually needs (recorded from the real setup)

Röbel's zone is `roebel.app`, DNS operated by **IONOS** (`ns*.ui-dns.*`).

| Host | Type | Value | Points at | Why |
|---|---|---|---|---|
| `relay` | A | `178.105.19.80` | the node | Nostr relay (Caddy → strfry) |
| `cloud` | A | `178.105.19.80` | the node | Nextcloud + Collabora |
| `matrix` | A | `178.105.19.80` | the node | Synapse (when Matrix ships) |
| `auth` | A | `178.105.19.80` | the node | MAS |
| `chat` | A | `178.105.19.80` | the node | Element |
| `wiki` · `meet` · `project` | A | `178.105.19.80` | the node | XWiki · Jitsi · OpenProject |
| `id` | **A + AAAA** | `66.241.125.144` / `2a09:8280:1::155:6fda:0` | **Fly** | the keystone is hosted **off-node** |

Then, for the externally hosted keystone only: `fly certs add id.roebel.app`.

**The critical asymmetry:** most records point at the node, but any service with
`hosted: "external"` points at *its own* provider. The manifest already knows which is
which (`identity.idp.hosted`), so an agent can derive this — a human has to remember it.

## 2. Every failure a human hit (all machine-preventable)

| What happened | Consequence | The check that prevents it |
|---|---|---|
| Typed `CNAME` into the **Hostname** field (record type vs. subdomain) | created `CNAME.roebel.app`; `id` still unresolved | Agent never types into a form; it sets `name` from the manifest |
| Pointed `id` at the bare `roebel-id.fly.dev` | cert stuck "Not verified" forever | Provider adapter knows Fly needs the **app-scoped** target (`0pko0lo.roebel-id.fly.dev`) or A+AAAA |
| Left a stale `relay` A record alongside the new one | **two A records** → ~50% of requests hit a dead host; TLS issuance flaky | Reconcile to *desired state* (delete extras), never blind-append |
| Tried to create a **DNS zone** for a subdomain at a second provider | rejected; would have hijacked the whole domain's DNS if completed | Zones are apex-only; validated before any call |
| Added records, then waited/guessed on propagation | premature `netizen up` → Caddy fails ACME | Poll authoritative NS until consistent, *then* proceed |

Every one of these is a **config error a machine cannot make** if it reconciles a
declared desired state through an API.

## 3. Design: DNS as a manifest concern

### 3.1 Manifest addition (NSP-7)

```jsonc
"dns": {
  "provider": "ionos",            // ionos | hetzner | cloudflare | desec | manual
  "zone": "roebel.app",           // apex only — validated
  "credentials": "$DNS_API_TOKEN",// secret REFERENCE, never a value
  "ttl": 300,
  "manageRecords": true           // false = print a plan, change nothing
}
```

Everything else is **derived**, not declared: the record set is a pure function of the
manifest (`services.*` hosts → node IP; `hosted: "external"` → that provider's target).
There is no second list of hostnames to keep in sync — that is what drifted for humans.

### 3.2 CLI surface

```bash
netizen dns plan   <manifest>   # pure: desired vs actual, prints a diff. No writes.
netizen dns apply  <manifest>   # reconcile: create/update/DELETE extras
netizen dns verify <manifest>   # poll authoritative NS until consistent
```
`netizen up` gains a **precondition**: DNS must verify before services start, because
Caddy's ACME challenge fails otherwise and Let's Encrypt has rate limits.

### 3.3 Reconciliation rules (the part that prevents the outages above)

1. **Desired state, not append.** Extra records for a managed host are removed. This is
   the only fix for the split-resolution failure.
2. **Never both** a CNAME and A/AAAA for one name — invalid; validate before writing.
3. **Zone must be the apex.** Reject a subdomain as a zone.
4. **External services use provider-specific targets.** A per-provider adapter supplies
   them (Fly → app-scoped hostname or A+AAAA; Vercel → its CNAME).
5. **Never touch unmanaged records.** Only reconcile hosts the manifest derives —
   `www`, `MX`, `TXT`/SPF/DKIM, and the apex belong to the user. Deleting a mail record
   would be catastrophic and unrecoverable.
6. **Dry-run by default in CI**; `apply` requires explicit intent.
7. **Propagation gate.** Poll the zone's authoritative nameservers (not a cached
   resolver) until every record matches, with a timeout.
8. **Then trigger certificates** (`fly certs add`, or let Caddy do ACME on first request).

### 3.4 Provider adapters

One small interface — `list(zone)`, `upsert(record)`, `delete(record)` — implemented per
provider. **IONOS**, Hetzner DNS, Cloudflare and deSEC all expose REST APIs with token
auth. `manual` prints the exact record table for a human (today's behaviour, kept as a
fallback for registrars without an API).

**Honest constraint:** the **registrar** cannot be automated away. ICANN domains always
have one, and delegation (NS records) is set there. An agent can manage *records* inside
a zone; acquiring the domain and pointing its nameservers remains a human/commercial
step — unless Netizen becomes the DNS operator (see §4).

## 4. The product path

1. **Now:** `dns plan/apply` against the customer's existing provider with a scoped API
   token. Removes the manual step; the customer keeps their registrar.
2. **Next:** **Netizen DNS** — Netizen runs authoritative nameservers; the customer
   delegates their zone (or a subdomain) once, and every later change is automatic.
   This is the Vercel model. Requires ≥2 nameservers in **separate failure domains** —
   never on the same box as the services, or an outage takes DNS down with it and you
   cannot even serve a status page.
3. **Optional:** a Netizen-owned parent domain, so a node can start at
   `<name>.netizen.xyz` with **zero** customer DNS work, and bring a custom domain later.

Path 3 is what makes a true one-click, non-technical signup possible: the node is
reachable and TLS-valid before the customer has thought about domains at all.

## 5. Security notes

- The DNS token is a **secret reference** in the manifest, resolved at apply time —
  same rule as every other secret. Scope it to the single zone where the provider allows.
- **DNS control is identity control**: whoever can write records can obtain certificates
  and impersonate every service on the node. Treat the token at the same tier as the
  keystone's signing key (`docs/NODE_SECURITY_POLICY.md` §1).
- Log every record change to the audit sink; unexpected DNS changes are an incident.
