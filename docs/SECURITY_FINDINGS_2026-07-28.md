# Security findings — 2026-07-28

Found while building the sovereign Arbeitsbereich
([state](SOVEREIGN_ARBEITSBEREICH_STATE.md)). Recorded here because two of them
are **live in production and predate that work**, and a finding that exists only
in a chat log is a finding nobody will act on.

Everything below was read from repo migrations. **The Supabase MCP was not
authenticated in that session, so live policy state was never confirmed.** Verify
against production before acting — a policy may have been changed outside a
migration file.

---

## ⚠️ Verified against production 2026-08-12 — still open, and wider than written

That verification was finally done, 15 days later. Results, read from `pg_policies`
and `information_schema.role_table_grants` on project `wwbeqhkslxdxhktqzqti`:

- **`20260802_account_membership_lockdown.sql` was never applied.** The newest
  applied migration is `20260731213311_membership_functions_revoke_default_privileges`.
  The code fixes shipped; the policy drop did not.
- **`anon` holds `INSERT, UPDATE, DELETE, SELECT`** on all three tables, and every
  policy on them evaluates to `true`. The anon key ships inside the Expo bundle.
- **The blast radius below is understated.** §1 describes joining any org and §2
  renaming any account. Live, the same key can also **delete any account row** and
  **delete any `account_owners` row** — walking straight past the
  `delete_owner_guarded` last-owner protection, which only runs inside the signed
  edge function. It can also forge `invite_tokens` rows and mutate existing ones.
- **The gate is one question.** `org-membership` is deployed and ACTIVE (v2,
  2026-07-31), so the only remaining condition is *"older installed Expo builds
  still write `account_owners` directly"* — i.e. EAS-build adoption. That is Max's
  call, and holding was Max's decision on 2026-08-12. Nothing here is applied.

Then read §5, which is the finding that matters more than any of the three above.

---

## 1. Anyone with the anon key can join any organisation — FIXED (code); policy drop gated

`supabase/migrations/005_accounts_system.sql:42`

```sql
CREATE POLICY "account_owners_insert" ON account_owners FOR INSERT WITH CHECK (true);
```

The anon key ships inside the app bundle and the Expo build. So anyone who can
read that bundle can insert `(victimOrgId, theirWallet, 'member')` into
`account_owners`.

That row is not cosmetic. The keystone reads it directly
(`apps/roebel-id/src/claims/readers.ts`) and mints a genuine
`org:<victimOrgId>:member` claim from it
(`apps/roebel-id/src/claims/resolver.ts`). Every consumer that trusts the
`groups` claim then treats the attacker as a real member.

**Why it matters more now.** The Arbeitsbereich's org file access is gated by
`hasOrgAccess`, which reads exactly that claim, and the group-folder mount point
is deterministic (`org-<accountId>`) with account ids readable under
`accounts_select USING (true)`. So this policy is the *only* thing standing
between an attacker and another org's private files.

**This is why the org workspace must not be enabled until it is fixed** — see the
`NEXT_PUBLIC_WORKSPACE_NATIVE_FILES` gate in
[SOVEREIGN_ARBEITSBEREICH_STATE.md](SOVEREIGN_ARBEITSBEREICH_STATE.md).

Fix direction: insert into `account_owners` should require either an existing
owner/admin of that account, or a signed invite — never `WITH CHECK (true)`.
There is already an invite path (`apps/web/src/lib/supabase-invites.ts`); the
policy should enforce what that flow assumes.

**FIXED 2026-07-31 (code); RLS policy drop still gated.** All membership
writes — org/personal creation, invite create/accept/decline/revoke, leave,
remove_member, role changes — now route through a new signature-verified edge
function, `org-membership`
(`apps/expo/supabase/functions/org-membership/index.ts`): EOA recovery →
ERC-1271/6492 verification on Gnosis, a 300s replay window, and per-action
owner/admin authorization, with last-owner protection enforced by
FOR-UPDATE-locked SQL guards (`delete_owner_guarded`,
`set_owner_role_guarded`). Web and expo callers were rewired onto the signed
path (web: `c3a2aa90`, `3f838fd2`, `ecd70f43`, `aa6693ee`; expo: `beec7214`;
role changes: `3196d153`). Residual noted at review: the replay check uses
`Math.abs(now - timestampSec) > 300`, so the accepted window is actually
±300s around the signed timestamp (effectively 600s wide) and there is no
per-message nonce — a captured signed request stays replayable for up to
600s. Accepted as-is; revisit if this endpoint's threat model changes. The
supporting RPCs/functions ship in
`supabase/migrations/20260801_membership_functions.sql` (additive, being
applied to prod now). **The actual `WITH CHECK (true)` policy drop lives in
`supabase/migrations/20260802_account_membership_lockdown.sql`, and applying
it is gated on the next EAS build shipping** — older installed Expo builds
still write `account_owners` directly, and dropping the permissive policy
before they upgrade would break them. Until that migration lands: the signed
path is live and is what every current client uses, but the old direct-INSERT
hole in the database is still technically open. Code-fixed, policy-pending.

**Sub-finding recorded in the same work:** `invite_tokens` had the identical
shape of hole. Its INSERT policy was also `WITH CHECK (true)` (anyone could
forge an invite row), and its SELECT policy was open enough to enumerate
bearer tokens — letting an attacker join any org without ever holding a real
invite link. Reads now go through the `get_invite_by_token` RPC (bearer
semantics: token-holder only, no enumeration) plus the signed
`list_invites`/`has_pending_invite` actions on `org-membership`. Same gate
applies: the underlying policy drop for `invite_tokens` is also in
`20260802_account_membership_lockdown.sql`.

## 2. Anyone with the anon key can rename any account — FIXED (code); policy drop gated

`supabase/migrations/005_accounts_system.sql:26`

```sql
CREATE POLICY "accounts_update" ON accounts FOR UPDATE USING (true);
```

Never dropped in any later migration, and `updateAccount` runs client-side on the
anon key (`apps/web/src/app/dashboard/profile/page.tsx`,
`apps/expo/app/edit-org.tsx`). So any account row — including orgs the caller has
nothing to do with — can be renamed by anyone.

The Arbeitsbereich no longer depends on this (the folder mount is keyed on
`accounts.id`, not on any name — see finding 3 below for why that changed), but
it remains an integrity problem for every other surface that displays an account
name as identity.

**FIXED 2026-07-31 (code); RLS policy drop still gated.** Client updates to
accounts now go through the signed `update_account` action on the
`org-membership` edge function, with a field whitelist and https URL
validation. Admin server actions were moved onto the service-role client
(`38f11751`), and the ungated `updateAccountOpeningHours` server action —
which bypassed everything — was deleted outright, its page rewired onto the
signed path (`aa6693ee`). As with finding 1, the `accounts_update USING
(true)` policy itself is only dropped in the gated
`supabase/migrations/20260802_account_membership_lockdown.sql`; until that
ships, the signed path is what every client uses, but the permissive policy
is still live in the database.

## 3. Cross-org file takeover via a client-supplied folder name — FIXED

Found and closed during the same session; recorded because the *shape* of the
mistake is worth remembering.

`resolveScope` derived a Nextcloud group-folder name from an `orgName` query
parameter and never checked it against the `accountId` the ACL had authorised.
`ensureGroupFolder` matched folders by name with no account dimension and bound
additively. A citizen with a legitimate claim for their own small org could send
another org's real, public name and have their own group bound onto that org's
existing folder — a persistent read/write/delete grant for their whole org.

The first fix moved the trust anchor from the query parameter to
`accounts.name`, which finding 2 above shows the same attacker can also write.
Still exploitable, one step longer.

The second fix keys the mount point on `accountId` — the primary key the ACL has
already checked — so no name, however obtained, can point one org at another's
folder. `orgFolderName` was deleted rather than left unused, and
`ensureGroupFolder` now refuses to bind when a folder already carries a different
`org:*` group.

**The lesson worth keeping:** moving a trust anchor from one attacker-writable
value to another looks like a fix and is not one. Ask what the attacker controls,
not where the value came from.

## 4. Org membership claims are a login-time snapshot — FIXED

`workspace_sessions.groups` is written once at the OIDC callback. `SessionStore.update()`
refreshes only the tokens, and `loadSession` never re-reads claims. So a `citizen`
or `org:<id>:<role>` claim survives revocation for the life of the session —
bounded by the cookie's 14-day `maxAge`, not by the 8-hour editor token.

Consequence: an ex-member of an organisation keeps that org's file access until
their session expires. Citizen revocation is 67%-attester governance and slow by
design, so the org case is the sharper one.

Fix direction: re-read claims on refresh in `loadSession`, or shorten the session
TTL for org scopes.

**FIXED 2026-07-31.** Workspace sessions now re-read group claims on token
refresh instead of trusting the login-time snapshot (`ec2f19f4`, `6a2304c0`),
with an absent-vs-empty claim distinction and a sub-guard so a missing claims
response can't be misread as "still a member". An ex-member's session now
loses org file access at the next refresh instead of surviving to the
cookie's 14-day `maxAge`.

---

## 5. RLS has no subject in this database — added 2026-08-12

Findings §1–§3 were each treated as a bug on a specific table. Measuring the whole
schema shows they are three samples of a property that holds almost everywhere:

| Measured on production, 2026-08-12 | |
|---|---|
| Write policies (INSERT/UPDATE/DELETE/ALL) in `public` | **156** |
| …that reference `auth.uid()` | **0** |
| …whose *name* claims ownership ("own", "their", "self") | 25 |
| …of those 25, that evaluate to literal `true` | **25 of 25** |
| Tables `anon`/`authenticated` can write behind a `true` policy | **81** |

**The cause is architectural, not sloppiness.** This app authenticates by wallet
(thirdweb smart accounts), never by Supabase Auth. So `auth.uid()` is null on every
request and RLS has nothing to bind a row to. A policy *cannot* express "only the
owner" here. Authorization genuinely lives in the signed edge functions and the
client — which is a defensible design, and is the direction `org-membership`
already took.

**What is not defensible is the naming.** Twenty-five policies are called things
like *"Users can update their own posts"* while evaluating to `true`. That is not a
comment that drifted; it is a security control that reads as enforced and is not.
It is precisely why §1 and §2 sat unnoticed: whoever wrote them, and everyone who
read the schema afterwards, saw a name that promised ownership.

The three tables in §1–§3 were not uniquely broken. They were the three someone
happened to open.

**Actions, in order:**

1. **Rename before re-architecting.** A policy that means "any client may write
   this, authorization is upstream" should say so. Renaming 25 policies is cheap,
   changes no behaviour, and removes the false assurance that hid these findings.
   Do it as one mechanical migration.
2. **Triage the 81 by consequence, not by count.** Some are genuinely fine
   (`feedback`, `tour_completions`). Some are not, and deserve their own findings
   after review — `roebel_points_ledger` (*"Users can insert points"*, INSERT
   `true`), `vote_history`, `orders`, `users`, `proposals`, and the `allow_all`
   policies on `conversations` / `conversation_participants` / `direct_messages`.
   **This list is a starting point from schema shape alone — each needs its data
   sensitivity and its client path checked before it is called a vulnerability.**
3. **Hold the line with the ratchet.** [`supabase/checks/rls-write-policies.sql`](../supabase/checks/rls-write-policies.sql)
   asserts both numbers against a dated baseline and fails when either grows. It
   does not claim the debt is fixed — it stops it growing while §1–§2 wait on EAS,
   and it turns this document from prose that rotted for 15 days into something the
   database enforces.

---

## Not findings, but worth knowing

- **`SUPABASE_SERVICE_KEY` is on the Hetzner box** (`/opt/netizen/roebel/.env`)
  for `relay-sync`. Rotating the key without updating the box stops the Nostr
  allow-list syncer. It fails *closed* — a stale allow-list, so citizens keep
  write access — but revocations stop propagating silently.
- **`workspace_sessions` holds live access AND refresh tokens.** It is RLS-enabled
  with no policies plus an explicit `REVOKE`, and reaped nightly by
  `/api/cron/workspace-sessions-gc`. Treat it like the credential store it is.
