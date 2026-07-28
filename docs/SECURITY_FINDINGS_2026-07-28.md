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

## 1. Anyone with the anon key can join any organisation — OPEN

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

## 2. Anyone with the anon key can rename any account — OPEN

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

## 4. Org membership claims are a login-time snapshot — OPEN, low

`workspace_sessions.groups` is written once at the OIDC callback. `SessionStore.update()`
refreshes only the tokens, and `loadSession` never re-reads claims. So a `citizen`
or `org:<id>:<role>` claim survives revocation for the life of the session —
bounded by the cookie's 14-day `maxAge`, not by the 8-hour editor token.

Consequence: an ex-member of an organisation keeps that org's file access until
their session expires. Citizen revocation is 67%-attester governance and slow by
design, so the org case is the sharper one.

Fix direction: re-read claims on refresh in `loadSession`, or shorten the session
TTL for org scopes.

---

## Not findings, but worth knowing

- **`SUPABASE_SERVICE_KEY` is on the Hetzner box** (`/opt/netizen/roebel/.env`)
  for `relay-sync`. Rotating the key without updating the box stops the Nostr
  allow-list syncer. It fails *closed* — a stale allow-list, so citizens keep
  write access — but revocations stop propagating silently.
- **`workspace_sessions` holds live access AND refresh tokens.** It is RLS-enabled
  with no policies plus an explicit `REVOKE`, and reaped nightly by
  `/api/cron/workspace-sessions-gc`. Treat it like the credential store it is.
