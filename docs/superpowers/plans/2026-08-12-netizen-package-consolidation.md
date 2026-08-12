# Netizen package consolidation — one source of truth for `@netizen-labs/*`

**Written 2026-08-12.** Executes [roadmap item 2](../../ROADMAP_AND_DEFERRED.md#2-extract-the-netizen-labs-packages-into-their-own-repo),
whose trigger fired on 2026-07-28. Mechanism chosen by Max on 2026-08-12: **publish to npm**.

This is no longer a tidiness item. The packages and the Röbel manifest now exist in **two**
repos, have diverged **in both directions**, and a routine `netizen up` from the wrong
directory takes a live service down. That is the cost this plan is paying off.

---

## 1. The ownership rule

Already written down in [State of the Netizen Stack §3](../../STATE_OF_THE_NETIZEN_STACK.md);
this plan just enforces it.

| Owner | What |
|---|---|
| **netizen_labs** | every `@netizen-labs/*` package — the generic, forkable stack |
| **DAO_test (Röbel)** | `apps/`, `contracts/`, `@roebel/*` (blockchain, design-tokens, config), and **`roebel.netizen.json`** — one node's manifest instance |

The manifest stays with Röbel deliberately. It is *data about one node*, not stack code, and
the moment it lives in the stack repo the stack acquires a dependency on one town's facts.

## 2. The fact that shapes everything: there is no merge base

netizen_labs begins at `0447fa4 Initial commit from Create Next App`. **No commit is shared
with DAO_test.** The packages were copied, not `git filter-repo`'d out.

So `git merge` is not available. Every shared package is a hand reconciliation, and the only
safe procedure is: pick the newer side as the base, diff the other side into it, and let tests
decide. Budget accordingly — this is the expensive part of the plan, not the npm wiring.

**Do not** attempt to graft histories with `git replace` or a synthetic merge commit. A fake
ancestry makes future `git log`/`git blame` lie about where code came from, which is worse than
having no history at all.

## 3. Per-package reconciliation

Divergence splits cleanly along the seam you'd expect: netizen_labs advanced the
**installer/protocol/agent** side, DAO_test advanced the **data plane**, because that is where
the Röbel work happened.

| Package | Base (newer) | Port in from | What the other side has |
|---|---|---|---|
| `protocol` | **netizen_labs** 08-12 | DAO_test 08-09 | `services.buzz.acpAgents` shape, the NSP-12 `record` block, **and `publisher.datasets` (11 values vs 6)** — see §3a |
| `cli` | **netizen_labs** 08-11 | DAO_test 08-09 | buzz/acpAgents render; NL alone has `dns.ts` + `deploy.ts` |
| `agent-watcher` | **netizen_labs** 08-12 | DAO_test 07-29 | route-before-answer + shape matcher are NL-only; check nothing regressed |
| `indexer` | **DAO_test** 08-06 | netizen_labs 07-30 | metering hooks, e/p/d tag filters |
| `publisher` | **DAO_test** 08-06 | netizen_labs 07-31 | **+454 lines**: menus, notices, business profiles, news, proposal pointers |
| `relay-sync` | **DAO_test** 07-31 | netizen_labs 07-30 | **+303 lines**: the NIP-62/NIP-09 vanish pipeline |
| `nostr` | **DAO_test** 08-01 | netizen_labs 07-28 | consented personal events, org keys |

### 3a. Two reproductions, so nobody has to take the above on faith

**netizen_labs' protocol cannot parse the live node's manifest.** Not "differs from" — cannot
read:

```
$ netizen_labs/packages/cli$ tsx src/cli.ts doctor DAO_test/…/roebel.netizen.json
ZodError: services.publisher.datasets[6..10]
  Invalid enum value. Expected 'events'|'cinema'|'orgs'|'articles'|'marketplace'|'deals',
  received 'businesses' / 'news' / 'notices' / 'menus' / 'proposals'
```

DAO_test's enum has 11 datasets, netizen_labs' has 6. So "netizen_labs' protocol is newer" is
true by commit date and **false by content** — it is behind on exactly the publisher work that
happened in Röbel. Treat every shared package as a two-way merge; do not let commit dates decide.

**The `netizen:*` rename is already known-broken against the live keystone.** Running doctor on
netizen_labs' own manifest reports what §6 predicts, without anyone having to reason about it:

```
identity DRIFT (5) — logins may fail:
  ! scope:netizen: expected supported, got missing
  ! claim:netizen:citizen  / :attester / :tier / :actor_type: expected supported, got missing
```

`checkIdpDrift` is doing its job. Merging that block into the live manifest would move these
five from "a warning on an unused example" to "a warning on the manifest we deploy from".

**Move wholesale (DAO_test → netizen_labs, no counterpart, no reconciliation):**
`facilitator`, `gateway`, `miniapp-sdk`, `record-client`, `workspace`.

**Stay in netizen_labs, never come to Röbel:** `accounts`, `signer`, `router`, `ortis-core`,
`ortis-operator`, `ui`.

**Stay in DAO_test:** `@roebel/blockchain`, `@roebel/design-tokens`, `@roebel/config`.

## 4. What gets published, and what must not

The `@netizen-labs` npm scope **already exists and is public** —
`@netizen-labs/miniapp-sdk@0.3.0` is live. Copy its packaging pattern verbatim
([`packages/miniapp-sdk/package.json`](../../../packages/miniapp-sdk/package.json)): `main:
src/index.ts` for workspace consumers, `publishConfig` overriding to `dist/` for the registry,
a `files` allowlist, dual CJS/ESM.

**Recommended split — needs Max's yes, because it is a disclosure decision, not a build one:**

| Tier | Packages | Why |
|---|---|---|
| **Public npm** | protocol, cli, nostr, relay-sync, indexer, publisher, record-client, workspace, agent-watcher, gateway, facilitator, miniapp-sdk | This is the forkable stack. The Röbel repo is already public AGPL-3.0, so these are published source either way — a registry entry adds distribution, not exposure. "Fork this" is unserious if standing up a node needs a private token. |
| **Unpublished** | accounts, signer, router, ortis-core, ortis-operator, ui | Commercial surface (Ortis/Autar) and key-handling code. netizen_labs is a private repo; these stay workspace-internal to it. |

If Max prefers everything private, the plan is unchanged except the registry — but note the
cost lands on the *outside operator* the whole extraction exists to serve.

## 5. Order of operations

Each step ends in a state that is safe to stop at. Do not start step N+1 with N's tests red.

1. **Freeze deploys from DAO_test.** Add the deploy-safety note (§7) to `packages/cli/README.md`
   in both repos. One line, prevents the failure mode while the rest of this runs.
2. **Reconcile the 7 shared packages** (§3), one commit per package, tests green per package.
   No publishing yet, no consumer changes. This is the bulk of the work.
3. **Move the 5 wholesale packages** into netizen_labs. Still no publishing.
4. **Reconcile the manifest** (§6) — netizen_labs' `examples/roebel.netizen.json` becomes a
   *generic example*; the real one stays in DAO_test and gains the netizen_labs-only blocks that
   survive review.
5. **Publish `0.1.0` of the public tier** from netizen_labs. Verify `npm view` for each.
6. **Swap DAO_test's consumers.** 145 files import `@netizen-labs/*`
   (miniapp-sdk 43, nostr 35, record-client 27, workspace 16, protocol 12, publisher 9, relay-sync
   6, indexer 6, facilitator 6, cli 2, agent-watcher 2, gateway 1). Imports do **not** change —
   only `package.json` (`workspace:*` → `^0.1.0`) and the removal of `packages/<name>/`.
   Do it package by package, typecheck between each.
7. **Delete DAO_test's copies** only after step 6 is green for that package.
8. **Re-run `netizen doctor`** against the live manifest and diff the output against the
   pre-consolidation baseline in §8. Any change is either an intended fix or a regression;
   there is no third option.
9. **Then, and only then**, declare `services.dns` (§9).

## 6. Manifest reconciliation — the dangerous blocks

Two of netizen_labs' manifest differences are **not** safe to merge into the live manifest by
inspection, and neither is a formatting nit:

- **`netizen:*` claims + the `netizen` scope.** netizen_labs renames the claim namespace from
  `roebel:*`. The keystone at `id.roebel.app` emits whatever it emits; changing the manifest
  does not change the keystone. Merging this blind means the manifest asserts claims nobody
  issues, and `checkIdpDrift` exists precisely to catch that. **Verify against the live
  discovery document before merging, and treat it as a keystone change with an app-side
  rollout, not a manifest edit.**
- **`authBridge.signer` → `https://signer.roebel.app`.** That hostname **does not resolve**
  (verified 2026-08-12, empty `dig`). Declaring a service that does not exist is exactly the
  drift this manifest is supposed to make impossible. Merge it when the signer deploys, not
  before — and note it is separately blocked on the ERC-4337 contract-sender issue.

Blocks that merge cleanly: DAO_test's `services.buzz` and `record` are live and undisputed;
netizen_labs simply lacks them.

## 7. Deploy safety until this lands

**Run `netizen up` from DAO_test only.** Its manifest is the one that matches the box.

A deploy from netizen_labs regenerates the Caddyfile without the `buzz` vhost and, because
`up` rsyncs with `--delete`, removes `buzz/` from the bundle. The containers survive
(bootstrap issues no `--remove-orphans`), so nothing crashes — `buzz.roebel.app` simply stops
being served, which is the kind of failure that gets diagnosed as DNS for half a day. It
already happened once to that exact hostname for an unrelated reason.

## 8. Baseline to diff against (captured 2026-08-12, before any change)

```
node: roebel · 16 secrets · 6 endpoints · 17 plan steps
sovereignty (5/8 layers under own control):
  ✓ hosting · ✓ identity-issuer · ✗ identity-keys · ✗ data
  ✓ workspace · ✓ comms · ✗ ai · ✓ durability
warnings (2): AI not self-hosted · authBridge.provider is 'thirdweb'
identity: keystone matches the manifest ✓
```

Note the ✓ on `durability` was scored from the declaration while the box reports
`offsite: unconfigured`. **That scoring bug is already fixed** in netizen_labs' CLI as part of
this change set: `sovereigntyReport` now takes `LiveNodeFacts`, `netizen doctor --host user@ip`
reads `ops/status.json` over SSH, and a layer that cannot be measured is never scored ✓.

So the post-consolidation baseline reads **4/8**:

```
✗ durability: self+offsite (unverified) — declares restic-sftp but NOT VERIFIED — the restic
  credentials live in the box's .env, which this manifest cannot see.
  Run `netizen doctor --host user@ip` to read ops/status.json
```

That is a more honest number, not a regression. It goes back to 5/8 the moment
`BACKUP_RESTIC_REPOSITORY` + `BACKUP_RESTIC_PASSWORD` are set — and then it will mean something.

## 9. What unblocks the moment this lands

- **`services.dns`.** `netizen dns plan|apply` exists in netizen_labs with tests; DAO_test's
  protocol has no `dns` block at all, so the live node cannot declare one today. After the swap
  it is a five-line manifest block plus `$IONOS_API_KEY` on the box. The `buzz` A record
  vanished from the IONOS zone once already and cost a debugging cycle — this is the check that
  would have caught it.
- **`deploy.ts`** (`netizen deploy --merge`, the CommunityRegistry path) becomes reachable from
  Röbel.
- **One `netizen doctor`** whose output means something, because there is only one manifest and
  one CLI to disagree.
