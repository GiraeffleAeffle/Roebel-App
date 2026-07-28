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
| `NODE_AGENT_SECRET` | every agent **and organisation** identity on the node |
| `POSTGRES_PASSWORD`, Matrix/Nextcloud client secrets | the respective service |

All live in `/opt/netizen/roebel/.env` (mode 600) and **never** in the repo or a rendered
bundle. The manifest references them by name only, which is what makes it safe to publish.

`NODE_AGENT_SECRET` deserves attention: it is the root of both agent and organisation
identities, so rotating it re-keys every one of them. Treat it like a signing root.

## 6. What still needs deciding

- **`NODE_AGENT_SECRET` currently holds a demonstration value** that appeared in a chat log.
  Rotating it changes every agent and org pubkey, so three places move together: the box `.env`,
  `agents.a2a.relayPubkeys`, and `MECKY_PUBKEY` in the app. Making the app read that from
  config rather than a constant would remove the third.
- **Two credentials were pasted into chat logs** on 2026-07-28 — the Supabase service-role key
  and the Anthropic key. Both should be rotated.
- **No key rotation procedure exists** for citizen or org keys. For citizens it is arguably
  unnecessary (the key is theirs and revocation is on-chain), but an org whose node is
  compromised has no defined recovery path.
- **Org keys and agent keys share one root.** Splitting them would mean an agent compromise
  does not imply an organisation compromise. Worth doing before many orgs depend on it.
