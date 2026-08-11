# Key governance — who holds what, and who can revoke it

**Date: 2026-07-28.** Part of the [documentation index](README.md).

Five distinct kinds of key now exist across humans, agents, organisations and the node itself.
This is the single page that says, for each: who holds it, what it can do, how it is revoked,
and what breaks if it leaks.

The organising principle: **the roster is the authority, not the key.** Wherever possible,
permission is a list that can be edited, not a secret that has been handed out — because a list
can be revoked and a secret cannot.

---

## 1. Citizen keys — held by the human, never by us

| | |
|---|---|
| Derived from | a wallet signature over `"Netizen Nostr-Identität v1"` |
| Held by | the citizen's device only (`expo-secure-store`) |
| Node can impersonate? | **No.** The node never sees it |
| Revocation | remove the CitizenNFT → the allow-list syncer drops them within one pass |
| If it leaks | that citizen can be impersonated on any Nostr relay, permanently |

Deterministic, so the same wallet reproduces the same npub on any device forever, and
**node-independent by design** — one wallet is one identity across every Netizen node. That
portability is the point, and it is why the derivation string is pinned by a test: changing it
re-keys every citizen.

**Write access is separate from the key.** Holding a key lets you sign; being on the relay
allow-list lets you publish. Membership is checked on-chain every pass, so revocation does not
require touching the key at all.

## 2. Agent keys — held by the node, declared in the manifest

| | |
|---|---|
| Derived from | `NODE_AGENT_SECRET` + node id + agent name |
| Held by | the node |
| Revocation | remove from `agents.a2a.relayPubkeys` → the next sync drops it |
| If it leaks | someone can publish **as the town's agent** — high reputational damage |

Scoped by node *and* agent, so "Mecky of Röbel" is a different identity from an agent of the
same name elsewhere. Two agents on one node never collide.

**Declared, not verified on-chain.** An operator putting a key in the manifest *is* the
authorisation — which is why it must be auditable in a git diff. Verified the hard way: a key
added by hand to `members.txt` was deleted by the next sync pass. Declaration is the only
durable path.

## 3. Organisation keys — held by the node, authorised by the roster

| | |
|---|---|
| Derived from | node secret + node id + org id |
| Held by | the node — **never shared with managers** |
| Who may publish | current rows in `account_owners` |
| Revocation | delete the roster row. Instant, no re-keying |
| Attribution | every org event carries `authorized_by` naming the member |

The alternative — a key shared among managers — cannot be revoked. Whoever leaves keeps their
copy forever, and the only remedy is re-keying, which destroys the org's identity and history.

**Honest cost:** the node can technically publish as any organisation. That is the same trust
already placed in it for the citizen registry, and unlike a shared secret it is auditable and
instantly revocable. An AI agent that publishes for an org is simply another authorised
publisher in the roster, not an exception to this.

## 4. The MACI coordinator key — split, and deliberately unreconstructable

| | |
|---|---|
| Held by | **nobody.** Shamir 3-of-5 across AttesterNFT holders |
| To use it | ≥3 Attesters submit shares; it exists in RAM for ~10 minutes, then is zeroed |
| Revocation | rotate the coordinator pubkey via governance |
| If 3 shares leak | past votes become decryptable |

Between tallies, the plaintext key **does not exist anywhere**. There is no fallback: the
legacy single-key path was permanently removed. This is the strongest governance in the stack
and the model to aim other keys toward.

## 5. Node operational secrets

| Secret | Blast radius if leaked |
|---|---|
| `SUPABASE_SERVICE_KEY` | **RLS bypassed project-wide.** The most powerful credential on the box |
| `ANTHROPIC_API_KEY` | billing, and the agent's voice |
| `HETZNER_INFERENCE_API_KEY` | Public Mecky inference quota; receives only public questions and reviewed public evidence |
| `NODE_AGENT_SECRET` | every agent **and organisation** identity on the node |
| `POSTGRES_PASSWORD`, Matrix/Nextcloud client secrets | the respective service |

All live in `/opt/netizen/roebel/.env` (mode 600) and **never** in the repo or a rendered
bundle. The manifest references them by name only, which is what makes it safe to publish.

`NODE_AGENT_SECRET` deserves attention: it is the root of both agent and organisation
identities, so rotating it re-keys every one of them. Treat it like a signing root.

## 5a. Rotating `NODE_AGENT_SECRET`

**Done once, on 2026-07-29**, because the value in place was a demonstration string that had
appeared in a chat log — meaning anyone who read that log could derive Mecky's private key and
publish as the town's agent.

The rotation was cheap precisely because it was early: Mecky had two events and *no
organisation had ever derived a key* (`deriveOrgIdentity` had zero call sites outside its own
tests). Every day of delay would have made it more expensive. If this secret is ever suspected
again, rotate immediately rather than waiting for certainty.

```bash
# 1. Generate on the box. It must never transit a chat, a ticket or a laptop.
NEW=$(openssl rand -hex 32)
sed -i "s|^NODE_AGENT_SECRET=.*|NODE_AGENT_SECRET=${NEW}|" /opt/netizen/roebel/.env

# 2. Derive the new agent pubkey (public — safe to circulate).
# 3. Update the manifest's agents.a2a.relayPubkeys, then AGENT_PUBKEYS in compose.
# 4. Recreate relay-sync   -> allow-list picks up the new key AND drops the old.
# 5. Recreate agent-watcher -> the agent comes back under the new key.
```

**Step 4 is the actual revocation.** Rotating the secret alone does nothing to an attacker who
already holds the old one; what stops them is the old pubkey leaving the relay allow-list. Verify
it explicitly rather than assuming:

```bash
grep -q "$OLD" strfry-policy/members.txt && echo "STILL WRITABLE" || echo "revoked"
```

Two things were changed so the next rotation is safer than this one:

- **The watcher now publishes its own kind 0 profile on startup.** Previously a profile was a
  manual step somebody had once done by hand, so a re-keyed agent came back *nameless* — every
  client showing a bare 64-hex pubkey. kind 0 is replaceable, so announcing on every boot is
  idempotent.
- **The app no longer trusts its compiled-in pubkey blindly.** `MECKY_PUBKEY` is still the
  default (no round trip, and unspoofable by anyone who can write to the relay), but if it
  yields no answer the app asks the node's index which key its agent uses now, and re-sends. A
  stale constant used to fail *silently* — the mention went to a key nobody listened on and the
  UI blamed the agent. That is the same failure mode that once made every MACI ballot tally
  0/0/0, and it is worth recognising by name.

### Escrow

A managed node's `NODE_AGENT_SECRET` is **escrowed to the community at setup**, not held only by
whoever runs the machine. It is the one secret that decides whether leaving a host is lossy:
carry it and the agents and organisations keep their identity, their history and their
followers; lose it and they all silently become different actors.

Verified on 2026-07-29: the secret alone was enough to re-derive the agent's exact pubkey using
a script that shares no code with our libraries — which is what a community would actually be
doing on the way out. See the export procedure in the Netizen repo.

Citizen keys need no escrow. They are derived from each citizen's own wallet and never touch the
node, which is stronger — there is nothing for a host to hold hostage.

## 6. What still needs deciding

- **Two credentials were pasted into chat logs** on 2026-07-28 — the Supabase service-role key
  and the Anthropic key. Both should be rotated. The Supabase one is the more urgent: it
  bypasses RLS across the whole project.
- **No key rotation procedure exists** for citizen or org keys. For citizens it is arguably
  unnecessary (the key is theirs and revocation is on-chain), but an org whose node is
  compromised has no defined recovery path.
- **Org keys and agent keys share one root.** Splitting them would mean an agent compromise
  does not imply an organisation compromise. Worth doing before many orgs depend on it.
