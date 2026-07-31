# Workspace GA + Membership Security Lockdown (W0+W1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close security findings #1, #2 and #4 ([SECURITY_FINDINGS_2026-07-28.md](../../SECURITY_FINDINGS_2026-07-28.md)) so the org workspace can go GA in Röbel with role-based write access and a mobile route — phases W0+W1 of [the workspace spec](../specs/2026-07-31-netizen-workspace-meetings-ai-design.md).

**Architecture:** All client-side anon-key writes to `accounts`, `account_owners` and `invite_tokens` move behind (a) a signature-verified Supabase edge function `org-membership` (same verify shape as the recently fixed `delete-user-account`: EOA `recoverMessageAddress` → ERC-1271/6492 `verifyMessage` on Gnosis, 300 s replay window) and (b) two SECURITY DEFINER RPCs for the no-privilege paths (account creation, token-bearer invite lookup). A lockdown migration then drops every `USING (true)` write policy on those tables. Separately: workspace sessions re-read `groups` claims on token refresh; `resolveScope` learns roles and mints `canWrite` (owner/admin write, member read-only), enforced in all four write routes and defense-in-depth in Nextcloud groupfolder permission bitmasks; the citizen Arbeitsbereich gets a mobile bottom nav.

**Tech Stack:** Next.js 15 App Router (apps/web), Expo 55 (apps/expo), Supabase (Postgres RLS, edge functions/Deno), viem (signature verify), thirdweb v5 (silent `signMessage`), `node:test` via `tsx --test`.

## Global Constraints

- Package manager: **pnpm** only. Tests: `pnpm test:web` (root) and `pnpm --filter @netizen-labs/workspace test`. No vitest/jest.
- Route handlers are NOT unit-testable in this repo's harness — put decisions in pure modules, keep routes thin (repo convention, `SOVEREIGN_ARBEITSBEREICH_STATE.md:65-67`).
- Supabase operations (applying migrations, deploying edge functions, reading logs) go through the **Supabase MCP** (project ref `wwbeqhkslxdxhktqzqti`) — the CLI is intentionally not installed. MCP is currently unauthenticated in some sessions; if unavailable, STOP at the rollout task and hand the user the checklist.
- **The lockdown migration is WRITTEN in Task 2 but APPLIED only at rollout (Task 13)** — applying it before Tasks 3–7 ship would break org creation, invites and profile edits in production.
- UI copy German-first. Never show raw wallet addresses in UI (resolve to display names).
- Do NOT touch `.github/workflows/` (the gh token lacks workflow scope; CI edits are a user follow-up).
- Commit convention: `fix(web): …`, `feat(expo): …`, etc. Commit with explicit pathspecs, never a bare `git add .` (parallel sessions share this repo).
- All snippets below were verified against the tree on 2026-07-31; line numbers are anchors, not gospel — re-locate by symbol if a parallel session moved code.

## File Structure (what this plan creates/modifies)

```
supabase/migrations/20260801_account_membership_lockdown.sql   (new — RPCs + policy drops)
apps/expo/supabase/functions/org-membership/index.ts           (new — signature-verified membership writes)
apps/web/src/lib/org-membership/message.ts                     (new — canonical message builder, pure)
apps/web/src/lib/org-membership/client.ts                      (new — web caller: sign + POST)
apps/web/tests/org-membership-message.test.ts                  (new)
apps/expo/lib/org-membership.ts                                (new — expo caller: sign + POST)
apps/web/src/lib/supabase-accounts.ts                          (modify — create via RPC, update/remove via edge fn, delete inviteOwner)
apps/web/src/lib/supabase-invites.ts                           (modify — all writes via edge fn, reads via RPCs)
apps/web/src/lib/supabase-member-management.ts                 (modify — leaveOrg via edge fn)
apps/expo/lib/supabase-accounts.ts / supabase-invites.ts       (modify — same)
apps/web/src/app/actions/{accounts,extern-accounts,admin-businesses,restaurants}.ts (modify — admin client)
apps/web/src/lib/workspace/session.ts                          (modify — orgRole())
apps/web/src/lib/workspace/context.ts                          (modify — canWrite in scope; claims re-read on refresh)
apps/web/src/lib/workspace/session-store.ts                    (modify — update() persists groups)
apps/web/src/app/api/workspace/{editor,files,files/upload,files/folder}/route.ts (modify — enforce canWrite)
packages/workspace/src/provisioning.ts                         (modify — per-role folder permissions)
apps/web/src/components/workspace/WorkspaceMobileNav.tsx       (new)
apps/web/src/app/arbeitsbereich/layout.tsx / page.tsx          (modify — mount mobile nav, link Dateien)
docs/SECURITY_FINDINGS_2026-07-28.md, docs/SOVEREIGN_ARBEITSBEREICH_STATE.md (modify — state truth)
```

---

### Task 1: Canonical message module (pure, shared spec)

**Files:**
- Create: `apps/web/src/lib/org-membership/message.ts`
- Test: `apps/web/tests/org-membership-message.test.ts`

**Interfaces:**
- Produces: `buildOrgMessage(action: OrgAction, wallet: string, timestampSec: number, payload: Record<string, unknown>): string`, `hashPayload(payload: Record<string, unknown>): string`, `type OrgAction = "create_invite" | "revoke_invite" | "accept_invite" | "decline_invite" | "leave" | "remove_member" | "update_account"`, `MAX_MESSAGE_AGE_SECONDS = 300`. Tasks 3, 4, 5, 6 depend on these exact names. The edge function (Task 3) re-implements the same format in Deno — the test here is the spec both sides must satisfy.

Message format (versioned, mirrors `delete-user-account`'s `delete-account:<wallet>:<ts>` style):
`roebel-org-v1:<action>:<lowercased wallet>:<timestampSec>:<sha256hex of canonical payload JSON>`
Canonical payload JSON = `JSON.stringify` of the payload with keys sorted at the top level (payloads are flat).

- [ ] **Step 1: Write the failing test**

```ts
// apps/web/tests/org-membership-message.test.ts
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildOrgMessage, hashPayload, MAX_MESSAGE_AGE_SECONDS } from "../src/lib/org-membership/message";

describe("org-membership message", () => {
  it("builds the versioned message with lowercased wallet", () => {
    const msg = buildOrgMessage("accept_invite", "0xABCDEF0000000000000000000000000000000001", 1753900000, { inviteId: "i-1" });
    assert.match(msg, /^roebel-org-v1:accept_invite:0xabcdef0000000000000000000000000000000001:1753900000:[0-9a-f]{64}$/);
  });
  it("payload hash is key-order independent", () => {
    assert.equal(hashPayload({ a: 1, b: "x" }), hashPayload({ b: "x", a: 1 }));
  });
  it("different payloads produce different hashes", () => {
    assert.notEqual(hashPayload({ inviteId: "i-1" }), hashPayload({ inviteId: "i-2" }));
  });
  it("exports the replay window", () => {
    assert.equal(MAX_MESSAGE_AGE_SECONDS, 300);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test:web 2>&1 | grep -A3 "org-membership"`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement**

```ts
// apps/web/src/lib/org-membership/message.ts
// Canonical message spec for the org-membership edge function. The Deno side
// (apps/expo/supabase/functions/org-membership/index.ts) mirrors this format;
// the test file is the shared contract.
import { createHash } from "node:crypto";

export type OrgAction =
  | "create_invite" | "revoke_invite" | "accept_invite" | "decline_invite"
  | "leave" | "remove_member" | "update_account";

export const MAX_MESSAGE_AGE_SECONDS = 300;

export function hashPayload(payload: Record<string, unknown>): string {
  const sorted = Object.fromEntries(Object.entries(payload).sort(([a], [b]) => a.localeCompare(b)));
  return createHash("sha256").update(JSON.stringify(sorted)).digest("hex");
}

export function buildOrgMessage(
  action: OrgAction, wallet: string, timestampSec: number, payload: Record<string, unknown>,
): string {
  return `roebel-org-v1:${action}:${wallet.toLowerCase()}:${timestampSec}:${hashPayload(payload)}`;
}
```

- [ ] **Step 4: Run test to verify it passes** — `pnpm test:web 2>&1 | grep -B1 -A5 "org-membership"` → PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/org-membership/message.ts apps/web/tests/org-membership-message.test.ts
git commit -m "feat(web): org-membership message spec — the signed contract for membership writes"
```

---

### Task 2: Lockdown migration (WRITTEN now, APPLIED at Task 13)

**Files:**
- Create: `supabase/migrations/20260801_account_membership_lockdown.sql`

**Interfaces:**
- Produces ONE anon-callable RPC: `get_invite_by_token(p_token text) returns invite_tokens` (Tasks 5/6 call it via `supabase.rpc(...)`). Account creation and every other invite read are edge-function actions (Task 3) — NOT RPCs.

Design notes (amended after task review, 2026-07-31): the v1 draft granted `create_account_with_owner`, `list_pending_invites` and `has_pending_invite` to anon with a client-supplied `p_wallet` — the reviewer showed that leaks bearer tokens (owner wallets are public in `account_owners`, so anyone can impersonate an owner parameter) and lets anon attach any registered wallet as owner of a new account. **Rule: no anon-granted function may take a wallet parameter as an authorization input.** `get_invite_by_token` survives because knowledge-of-token IS the credential (closes the enumeration hole that `invite_tokens_select USING (true)` is today). Everything else is deny-by-default; the signature-verified edge function reads/writes with service role.

- [ ] **Step 1: Write the migration**

```sql
-- 20260801_account_membership_lockdown.sql
-- Closes SECURITY_FINDINGS_2026-07-28 §1 (+ the forgeable/enumerable invite_tokens
-- corollary) and §2. Anon-key writes on accounts/account_owners/invite_tokens are
-- replaced by SECURITY DEFINER RPCs (below) + the signature-verified org-membership
-- edge function (service role).
-- ⚠️ APPLY ONLY AFTER the org-membership edge function and rewired clients are live.

-- ── RPC ─────────────────────────────────────────────────────────────────────
-- The ONLY anon-callable function. Knowledge of the token is the credential
-- (bearer semantics); it takes no wallet parameter. All other membership
-- reads/writes go through the signature-verified org-membership edge function
-- (service role). Rule: no anon-granted function may take a wallet parameter
-- as an authorization input — owner wallets are public in account_owners, so
-- such a parameter is attacker-controlled.
create or replace function public.get_invite_by_token(p_token text)
returns invite_tokens
language sql security definer set search_path = public, pg_temp stable as $$
  select * from invite_tokens where token = p_token limit 1;
$$;

revoke all on function public.get_invite_by_token(text) from public;
grant execute on function public.get_invite_by_token(text) to anon, authenticated;

-- ── Policy lockdown ─────────────────────────────────────────────────────────
-- accounts: reads stay public; every write becomes service-role/RPC only.
drop policy if exists "accounts_insert" on accounts;                -- 005:25
drop policy if exists "accounts_update" on accounts;                -- 005:26  (finding §2)
drop policy if exists "accounts_delete" on accounts;                -- 20260504_accounts_delete_policy.sql:15

-- account_owners: reads stay public (keystone + UI rely on it); writes locked.
drop policy if exists "account_owners_insert" on account_owners;    -- 005:42  (finding §1)
drop policy if exists "account_owners_delete" on account_owners;    -- 005:43

-- invite_tokens: fully locked; bearer lookup goes through get_invite_by_token.
drop policy if exists "invite_tokens_select" on invite_tokens;      -- 011:58 (enumeration hole)
drop policy if exists "invite_tokens_insert" on invite_tokens;      -- 011:59 (forgery hole)
drop policy if exists "invite_tokens_update" on invite_tokens;      -- 011:60
```

- [ ] **Step 2: Sanity-check the SQL locally** — `node -e "const s=require('fs').readFileSync('supabase/migrations/20260801_account_membership_lockdown.sql','utf8'); if(!/apply only after/i.test(s)) process.exit(1)"` and visually confirm every `drop policy` names a policy quoted in this plan. (No local Postgres in this environment; the MCP applies it at Task 13.)

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260801_account_membership_lockdown.sql
git commit -m "feat(db): membership lockdown migration — RPCs in, USING(true) writes out (NOT yet applied)"
```

---

### Task 3: `org-membership` edge function

**Files:**
- Create: `apps/expo/supabase/functions/org-membership/index.ts`
- Reference (copy the verify shape exactly): `apps/expo/supabase/functions/delete-user-account/index.ts` (parse/staleness at :63–101, verify at :107–133, viem gnosis client at :47–50)

**Interfaces:**
- Consumes: message format from Task 1 (re-implemented in Deno — keep byte-identical output).
- Produces HTTP contract for Tasks 4–6: `POST` JSON `{ action, wallet, timestampSec, payload, signature }` → `200 { ok: true, data? }` | `4xx { ok: false, code, message }`. Actions and payloads:
  - `create_invite` `{ accountId, role: "admin"|"member", invitedWallet: string|null, expiresInDays?: number }` — requires signer to be owner/admin of `accountId`; inserts `invite_tokens` (+ `notifications` row when `invitedWallet` set, matching current `createInAppInvite` shape at `apps/web/src/lib/supabase-invites.ts:55–69`); returns the invite row (incl. `token`).
  - `revoke_invite` `{ inviteId }` — signer owner/admin of the invite's account; sets `status='revoked'`.
  - `accept_invite` `{ inviteId }` — invite must be `pending`, unexpired, and `invited_wallet` NULL (link) or equal to signer; sets `accepted`, inserts `account_owners {account_id, wallet_address: signer, role: invite.role, invited_by: invite.invited_by}` (upsert-ignore on PK conflict), marks the matching notification read.
  - `decline_invite` `{ inviteId }` — same target check; sets `declined`.
  - `leave` `{ accountId }` — deletes signer's own `account_owners` row; refuses when signer is the LAST owner (`role='owner'` count would drop to 0).
  - `remove_member` `{ accountId, memberWallet }` — signer owner/admin; cannot remove an `owner` unless signer is `owner`; deletes the row.
  - `update_account` `{ accountId, updates }` — signer owner/admin; `updates` filtered to `name, bio, avatar_url, cover_url, contact_email, opening_hours`; stamps `updated_at`.
  - `create_account` `{ accountType: "personal"|"organisation", name, subType?, bio?, avatarUrl? }` — creates the account and inserts the SIGNER (never a passed wallet) as its first `owner` row, atomically (insert account, then owner; on owner-insert failure delete the account row). Validate: `name` 1–80 chars after trim, `bio` ≤ 500 chars, `accountType` in the two values, `subType` (when set) in `('restaurant','unternehmen','verein','stadt','fraktion','journalist')`. Returns the account row. (Amended 2026-07-31: replaces the withdrawn `create_account_with_owner` RPC — creation requires the creator's signature so no one can attach a stranger's wallet as owner.)
  - `list_invites` `{ accountId }` — signer owner/admin of `accountId`; returns pending invite rows (incl. tokens — the signer is entitled to them). (Amended: replaces the withdrawn `list_pending_invites` RPC.)
  - `has_pending_invite` `{ accountId }` — returns `{ pending: boolean }` for the SIGNER's wallet only. (Amended: replaces the withdrawn RPC.)

Extend the `ACTIONS` array and `OrgAction` union (here and in Task 1's module) with `create_account`, `list_invites`, `has_pending_invite` — the Task 1 test file is the contract; update it in the same commit as the module.

- [ ] **Step 1: Implement the function.** Skeleton (verify + dispatch; each handler is a small service-role query following the checks above — write them all, they are listed exhaustively in the Interfaces block):

```ts
// apps/expo/supabase/functions/org-membership/index.ts
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { createPublicClient, http, recoverMessageAddress } from "https://esm.sh/viem@2";
import { gnosis } from "https://esm.sh/viem@2/chains";

const MAX_MESSAGE_AGE_SECONDS = 300;
const ACTIONS = ["create_invite","revoke_invite","accept_invite","decline_invite","leave","remove_member","update_account"] as const;
type OrgAction = typeof ACTIONS[number];

const gnosisClient = createPublicClient({ chain: gnosis, transport: http(Deno.env.get("GNOSIS_RPC_URL") ?? "https://rpc.gnosischain.com") });

async function hashPayload(payload: Record<string, unknown>): Promise<string> {
  const sorted = Object.fromEntries(Object.entries(payload).sort(([a],[b]) => a.localeCompare(b)));
  const bytes = new TextEncoder().encode(JSON.stringify(sorted));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2,"0")).join("");
}

function fail(code: string, status: number, message: string) {
  return new Response(JSON.stringify({ ok: false, code, message }), { status, headers: { "content-type": "application/json", ...cors } });
}
const cors = { "access-control-allow-origin": "*", "access-control-allow-headers": "authorization, content-type" };

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  const { action, wallet, timestampSec, payload, signature } = await req.json().catch(() => ({}));
  if (!ACTIONS.includes(action)) return fail("BAD_ACTION", 400, "unknown action");
  if (!/^0x[0-9a-fA-F]{40}$/.test(wallet ?? "")) return fail("BAD_WALLET", 400, "wallet malformed");
  const ageSec = Math.abs(Date.now() / 1000 - Number(timestampSec));
  if (!Number.isFinite(ageSec) || ageSec > MAX_MESSAGE_AGE_SECONDS) return fail("STALE", 400, "message expired");

  const message = `roebel-org-v1:${action}:${wallet.toLowerCase()}:${timestampSec}:${await hashPayload(payload ?? {})}`;
  let verified = false;
  try {
    verified = (await recoverMessageAddress({ message, signature })).toLowerCase() === wallet.toLowerCase();
  } catch { /* not an EOA signature */ }
  if (!verified) verified = await gnosisClient.verifyMessage({ address: wallet as `0x${string}`, message, signature }); // ERC-1271/6492
  if (!verified) return fail("BAD_SIGNATURE", 401, "signer does not match wallet");

  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const signer = wallet.toLowerCase();
  // dispatch to per-action handlers (each: authorize via account_owners lookup, then write)
  // ... implement the seven handlers exactly per the Interfaces contract above ...
});
```

Handler-side authorization queries reuse the repo's owner-gate idiom (`apps/web/src/app/api/mecky/story-draft/route.ts:89–116`): `admin.from("account_owners").select("role").eq("account_id", accountId).eq("wallet_address", signer).maybeSingle()`.

- [ ] **Step 2: Typecheck the function in isolation** — `deno check apps/expo/supabase/functions/org-membership/index.ts` if deno is installed; otherwise rely on review + Step 3's smoke test at rollout. (No edge-function unit harness exists in this repo; the Task 1 test pins the message contract.)

- [ ] **Step 3: Commit**

```bash
git add apps/expo/supabase/functions/org-membership/index.ts
git commit -m "feat(edge): org-membership — signature-verified writes for invites, membership and account updates"
```

---

### Task 4: Web callers — accounts create via RPC, update via edge fn

**Files:**
- Create: `apps/web/src/lib/org-membership/client.ts`
- Modify: `apps/web/src/lib/supabase-accounts.ts` (`createPersonalAccount` :92, `createOrgAccount` :153–190, `updateAccount` :261, `removeOwner` :237–257; DELETE `inviteOwner` :218–229)
- Modify: `apps/web/src/lib/context/AccountContext.tsx` (drop the `inviteCitizen` wiring at :178 or point it at `createInAppInvite`)

**Interfaces:**
- Produces: `callOrgMembership(account: { address: string; signMessage: (m: { message: string }) => Promise<string> }, action: OrgAction, payload: Record<string, unknown>): Promise<{ ok: boolean; data?: unknown; code?: string }>` in `client.ts` — signs with thirdweb's silent `signMessage`, POSTs to `${NEXT_PUBLIC_SUPABASE_URL}/functions/v1/org-membership` with the anon key as `Authorization: Bearer`.
- Consumes: Task 1 (`buildOrgMessage`), Task 2 RPC names, Task 3 HTTP contract.
- Changed signatures downstream tasks rely on: `updateAccount(account, accountId, updates)` and `removeOwner(account, accountId, wallet)` now take the thirdweb `account` as first arg (callers updated in this task: `apps/web/src/app/dashboard/profile/page.tsx:44–49` passes `useActiveAccount()`).

- [ ] **Step 1: Write failing tests** for the pure parts (client message assembly, not the network):

```ts
// append to apps/web/tests/org-membership-message.test.ts
import { requestBody } from "../src/lib/org-membership/client";
it("requestBody signs the canonical message and echoes fields", async () => {
  const fake = { address: "0xABCDEF0000000000000000000000000000000001",
                 signMessage: async ({ message }: { message: string }) => `sig:${message.slice(0, 20)}` };
  const body = await requestBody(fake, "leave", { accountId: "a-1" }, 1753900000);
  assert.equal(body.action, "leave");
  assert.equal(body.wallet, "0xabcdef0000000000000000000000000000000001");
  assert.equal(body.timestampSec, 1753900000);
  assert.match(body.signature, /^sig:roebel-org-v1:leave/);
});
```

- [ ] **Step 2: Run to verify fail** — `pnpm test:web` → FAIL (no `requestBody`).

- [ ] **Step 3: Implement `client.ts`** — `requestBody(account, action, payload, timestampSec = Math.floor(Date.now()/1000))` builds `{action, wallet, timestampSec, payload, signature}` via `buildOrgMessage` + `account.signMessage`; `callOrgMembership` wraps it in `fetch`. Then rewire `supabase-accounts.ts`:
  - `createPersonalAccount(account, …)` / `createOrgAccount(account, …)`: replace the two-step insert (:163–177 + :187–190) with `callOrgMembership(account, "create_account", { accountType, name, subType, bio, avatarUrl })` (amended 2026-07-31 — creation is signature-verified; the signer becomes first owner; keep the existing return shapes by re-fetching or using the returned row). Update the call chains: `apps/web/src/lib/supabase-users.ts:87` (first-login personal account — the thirdweb account object is in scope there) and `AccountContext.createOrgAccount` (`apps/web/src/lib/context/AccountContext.tsx:153,161`).
  - `updateAccount(account, accountId, updates)`: `callOrgMembership(account, "update_account", { accountId, updates })`, then re-fetch the row via the (still open) `accounts_select` for the return value.
  - `removeOwner(account, accountId, wallet)`: `callOrgMembership(account, "remove_member", { accountId, memberWallet: wallet })`.
  - Delete `inviteOwner` entirely (it is the bypass path finding §1 warns about); update `AccountContext.tsx` accordingly.
  - Update caller `apps/web/src/app/dashboard/profile/page.tsx:44–49` to pass `useActiveAccount()`.

- [ ] **Step 4: Verify** — `pnpm test:web` → PASS; `cd apps/web && pnpm tsc --noEmit 2>&1 | head -30` shows no NEW errors in the touched files (repo has ~431 pre-existing errors from the untyped Supabase client — compare against `main`, don't chase them).

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/org-membership/client.ts apps/web/src/lib/supabase-accounts.ts apps/web/src/lib/context/AccountContext.tsx apps/web/src/app/dashboard/profile/page.tsx apps/web/tests/org-membership-message.test.ts
git commit -m "fix(web): account creation moves to the atomic RPC, account updates require the owner's signature"
```

---

### Task 5: Web callers — invites via edge fn + RPC reads

**Files:**
- Modify: `apps/web/src/lib/supabase-invites.ts` (all 8 exports), `apps/web/src/lib/supabase-member-management.ts` (`leaveOrg` :63–86), `apps/web/src/app/invite/[token]/page.tsx` (:67, :80 — pass the thirdweb account)

**Interfaces:**
- Consumes: Task 4's `callOrgMembership`; Task 2 RPCs.
- Produces (changed signatures, expo mirrors them in Task 6): `createInAppInvite(account, accountId, invitedWallet, role, expiresInDays?)`, `createLinkInvite(account, accountId, role, expiresInDays?)`, `acceptInvite(account, inviteId)`, `declineInvite(account, inviteId)`, `revokeInvite(account, inviteId)`, `leaveOrg(account, accountId)` — `invitedBy` is now derived server-side from the verified signer, so the parameter disappears. Reads (amended 2026-07-31): `fetchInviteByToken(token)` → `supabase.rpc("get_invite_by_token", { p_token })` (the one anon RPC); `fetchPendingInvites(account, accountId)` → `callOrgMembership(account, "list_invites", { accountId })`; `hasPendingInvite(account, accountId)` → `callOrgMembership(account, "has_pending_invite", { accountId })` (answers for the signer only).

- [ ] **Step 1: Rewire each export** to the contract above (writes → `callOrgMembership`; reads → RPCs). Update every call site the exploration listed: `apps/web/src/app/invite/[token]/page.tsx:67,80` plus any `fetchPendingInvites` dashboards (`git grep -n "fetchPendingInvites\|createInAppInvite\|createLinkInvite" apps/web/src` and fix all hits).
- [ ] **Step 2: Verify** — `pnpm test:web` still green; `git grep -n 'from("invite_tokens")' apps/web/src` returns ZERO hits (every touchpoint goes through RPC/edge fn now); same for `.from("account_owners").insert` and `.from("accounts").update`.
- [ ] **Step 3: Commit**

```bash
git add apps/web/src/lib/supabase-invites.ts apps/web/src/lib/supabase-member-management.ts apps/web/src/app/invite/[token]/page.tsx
git commit -m "fix(web): invites and membership writes go through the signed edge function; token lookups stop being enumerable"
```

---

### Task 6: Expo callers

**Files:**
- Create: `apps/expo/lib/org-membership.ts` (mirror of web `client.ts` — Expo has no `node:crypto`; use `expo-crypto`'s `digestStringAsync(SHA256, …)` for `hashPayload`)
- Modify: `apps/expo/lib/supabase-accounts.ts` (`createPersonalAccount` :117, `createOrgAccount` :163–202, `updateAccount` :294, `inviteOwner` :230 → delete), `apps/expo/lib/supabase-invites.ts` (accept at :132–143 + the rest), `apps/expo/hooks/useInviteToken.ts` (:66, :81), `apps/expo/hooks/useUserNotifications.ts` (:127, :142), `apps/expo/app/edit-org.tsx` (:159–166), `apps/expo/app/create-org/review.tsx` (:54, :66, :75), `apps/expo/context/AccountContext.tsx` (:212, :220, :232)

**Interfaces:**
- Consumes: Task 3 HTTP contract; Task 2 RPCs; the same changed signatures as Task 5.
- Signing: find the existing silent-sign pattern with `git grep -rn "delete-account:" apps/expo/` (the account-deletion flow signs `delete-account:<wallet>:<ts>` with the thirdweb account) and reuse exactly that account object/hook.

- [ ] **Step 1: Implement `org-membership.ts`** (same `requestBody`/`callOrgMembership` shape; edge fn URL from the existing expo Supabase config — grep `functions/v1/` in `apps/expo/lib` for the established base-URL pattern).
- [ ] **Step 2: Rewire all listed files** to the new signatures; delete `inviteOwner`.
- [ ] **Step 3: Verify** — `cd apps/expo && pnpm tsc --noEmit 2>&1 | head -30` (no NEW errors); `git grep -n 'from("invite_tokens")\|from("account_owners").insert\|from("accounts").update' apps/expo` → zero hits.
- [ ] **Step 4: Commit**

```bash
git add apps/expo/lib/org-membership.ts apps/expo/lib/supabase-accounts.ts apps/expo/lib/supabase-invites.ts apps/expo/hooks/useInviteToken.ts apps/expo/hooks/useUserNotifications.ts apps/expo/app/edit-org.tsx apps/expo/app/create-org/review.tsx apps/expo/context/AccountContext.tsx
git commit -m "fix(expo): membership and account writes ride the signed edge function"
```

---

### Task 7: Admin server actions switch to the service-role client

**Files:**
- Modify: `apps/web/src/app/actions/accounts.ts` (:7–25), `apps/web/src/app/actions/extern-accounts.ts` (:25–33, :65, :105), `apps/web/src/app/actions/admin-businesses.ts` (:133–136, :247, :289, :309, :367, :379), `apps/web/src/app/actions/restaurants.ts` (:729)

These five server files update `accounts` through the ANON server client today — the lockdown would silently break admin approval, verification sync and opening hours. Swap `createClient()` (from `@/lib/supabase/server`) for `createAdminClient()` (from `@/lib/supabase/admin`, exists at :8) **for the `accounts` writes only** — do not convert unrelated reads. Each action already has its own admin/authorization gate above the write; keep those intact.

- [ ] **Step 1: Swap the client on each listed write; run `pnpm test:web` (no regressions) and `git grep -n '\.from("accounts")\.update' apps/web/src/app/actions` to confirm every hit now uses the admin client.**
- [ ] **Step 2: Commit**

```bash
git add apps/web/src/app/actions/accounts.ts apps/web/src/app/actions/extern-accounts.ts apps/web/src/app/actions/admin-businesses.ts apps/web/src/app/actions/restaurants.ts
git commit -m "fix(web): admin account writes move to the service-role client ahead of the RLS lockdown"
```

---

### Task 8: Workspace sessions re-read claims on refresh (finding §4)

**Files:**
- Modify: `apps/web/src/lib/workspace/session-store.ts` (update at :60–67), `apps/web/src/lib/workspace/context.ts` (refresh branch at :156–169)
- Test: `apps/web/tests/workspace-session-refresh.test.ts` (new)

**Interfaces:**
- Consumes: `refreshTokens`, `fetchUserinfo`, `groupsFrom` — all already exported from `apps/web/src/lib/workspace/oidc.ts`.
- Produces: `store.update()` now persists `groups`; `loadSession` re-resolves groups from userinfo after every token refresh (fallback: keep the old groups when userinfo fails — refresh must not lock a user out on a transient error, the stale-claims window then ends at the next successful refresh).

- [ ] **Step 1: Write the failing test** — `loadSession` is exported and takes injectable pieces via module mocking; the repo's precedent is `apps/web/tests/workspace-context.test.ts` which stubs collaborators directly. Extract the decision into a pure function so it is testable:

```ts
// new export in apps/web/src/lib/workspace/context.ts
export function mergeRefreshedSession(
  prev: WorkspaceSession,
  tokens: { accessToken: string; refreshToken: string | null; expiresAt: number },
  freshGroups: string[] | null,
): WorkspaceSession {
  return { ...prev, ...tokens, groups: freshGroups ?? prev.groups };
}
```

```ts
// apps/web/tests/workspace-session-refresh.test.ts
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mergeRefreshedSession } from "../src/lib/workspace/context";

const base = { sub: "0xabc", groups: ["citizen", "org:a-1:member"], accessToken: "old", refreshToken: "r", expiresAt: 1 };
const tokens = { accessToken: "new", refreshToken: "r2", expiresAt: 999 };

describe("mergeRefreshedSession", () => {
  it("adopts fresh groups when userinfo succeeded", () => {
    const s = mergeRefreshedSession(base, tokens, ["citizen"]);
    assert.deepEqual(s.groups, ["citizen"]);           // org:a-1 revoked → gone
    assert.equal(s.accessToken, "new");
  });
  it("keeps old groups when userinfo failed (null)", () => {
    assert.deepEqual(mergeRefreshedSession(base, tokens, null).groups, base.groups);
  });
});
```

- [ ] **Step 2: Run to verify fail** → FAIL (no export).
- [ ] **Step 3: Implement** — add `mergeRefreshedSession`; in `loadSession`'s refresh branch call `fetchUserinfo(cfg, refreshed.accessToken)` in a try/catch, `groupsFrom(info)` with the same sub-match guard as the callback (`route.ts:95–97`), pass through `mergeRefreshedSession`, and `store.update(sessionId, merged)`. In `session-store.ts` add `groups: session.groups` to the update body (:63–67).
- [ ] **Step 4: Verify** — `pnpm test:web` PASS (new + existing workspace tests).
- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/workspace/context.ts apps/web/src/lib/workspace/session-store.ts apps/web/tests/workspace-session-refresh.test.ts
git commit -m "fix(web): workspace sessions re-read group claims on token refresh — revocation now propagates"
```

---

### Task 9: Roles enter the session model — `orgRole` + `canWrite` in scope

**Files:**
- Modify: `apps/web/src/lib/workspace/session.ts` (after `hasOrgAccess` :93), `apps/web/src/lib/workspace/context.ts` (`resolveScope` :86–135, `WorkspaceScope` type)
- Test: extend `apps/web/tests/workspace-session.test.ts` and `apps/web/tests/workspace-context.test.ts`

**Interfaces:**
- Produces: `orgRole(session: WorkspaceSession, accountId: string): OrgRole | null` (highest wins: owner > admin > member); `WorkspaceScope` gains `canWrite: boolean` (personal → `true`; org → `role !== "member"`). Task 10 enforces `scope.canWrite`; Task 11 uses the same owner/admin-write, member-read mapping in Nextcloud.

- [ ] **Step 1: Failing tests**

```ts
// extend apps/web/tests/workspace-session.test.ts
import { orgRole } from "../src/lib/workspace/session";
it("orgRole picks the highest role and ignores other orgs", () => {
  const s = { ...base, groups: ["citizen", "org:a-1:member", "org:a-1:admin", "org:b-2:owner"] };
  assert.equal(orgRole(s, "a-1"), "admin");
  assert.equal(orgRole(s, "b-2"), "owner");
  assert.equal(orgRole(s, "c-3"), null);
});
// extend apps/web/tests/workspace-context.test.ts
it("org scope for a member is read-only; personal is writable", async () => {
  const member = await resolveScope({ session: memberSession, scopeKind: "org", accountId: "a-1" });
  assert.equal(member.canWrite, false);
  const personal = await resolveScope({ session: citizenSession, scopeKind: "personal", accountId: null });
  assert.equal(personal.canWrite, true);
});
```

- [ ] **Step 2: Run to verify fail.** — `pnpm test:web` → FAIL.
- [ ] **Step 3: Implement**

```ts
// session.ts
const ROLE_RANK: Record<OrgRole, number> = { owner: 3, admin: 2, member: 1 };
export function orgRole(session: WorkspaceSession, accountId: string): OrgRole | null {
  const prefix = `org:${accountId}:`;
  let best: OrgRole | null = null;
  for (const g of session.groups) {
    if (!g.startsWith(prefix)) continue;
    const role = g.slice(prefix.length) as OrgRole;
    if (ORG_ROLES.includes(role) && (!best || ROLE_RANK[role] > ROLE_RANK[best])) best = role;
  }
  return best;
}
```
In `resolveScope`: org branch sets `canWrite: orgRole(session, accountId) !== "member"`; personal branch sets `canWrite: true`.

- [ ] **Step 4: Verify** — `pnpm test:web` PASS. **Step 5: Commit**

```bash
git add apps/web/src/lib/workspace/session.ts apps/web/src/lib/workspace/context.ts apps/web/tests/workspace-session.test.ts apps/web/tests/workspace-context.test.ts
git commit -m "feat(web): workspace scope learns roles — owner/admin write, member reads"
```

---

### Task 10: Enforce `canWrite` in all four write routes + read-only UI

**Files:**
- Modify: `apps/web/src/app/api/workspace/editor/route.ts` (:53–58 — `canWrite: true` → `canWrite: scope.canWrite`), `apps/web/src/app/api/workspace/files/upload/route.ts`, `apps/web/src/app/api/workspace/files/folder/route.ts`, `apps/web/src/app/api/workspace/files/route.ts` (DELETE branch + GET response), `apps/web/src/components/workspace/FileBrowser.tsx`

- [ ] **Step 1: Routes** — in upload (PUT), folder (POST) and files (DELETE): after `resolveScope`, `if (!scope.canWrite) return json 403 { reason: "read-only" }`. In files GET: include `canWrite: scope.canWrite` in the response body. Editor route mints the WOPI token with `canWrite: scope.canWrite` (WOPI `PutFile` then 403s on its own via the existing check at `wopi/files/[fileId]/contents/route.ts:73`).
- [ ] **Step 2: UI** — `FileBrowser` reads `canWrite` from the listing response; when `false`, hide upload / new-folder / delete affordances and show a muted `Nur Lesezugriff` hint (German-first). Collabora opens documents normally (view mode comes from the WOPI token).
- [ ] **Step 3: Verify** — `pnpm test:web` green (route logic lives in `resolveScope`, already tested; routes stay thin per repo convention). `git grep -n "canWrite: true" apps/web/src/app/api/workspace` → only the WOPI `personal`-scope path if any; the editor route hit is gone.
- [ ] **Step 4: Commit**

```bash
git add apps/web/src/app/api/workspace/editor/route.ts apps/web/src/app/api/workspace/files/upload/route.ts apps/web/src/app/api/workspace/files/folder/route.ts apps/web/src/app/api/workspace/files/route.ts apps/web/src/components/workspace/FileBrowser.tsx
git commit -m "feat(web): member role becomes read-only across editor, upload, folder and delete"
```

---

### Task 11: Nextcloud per-role groupfolder permissions (defense in depth)

**Files:**
- Modify: `packages/workspace/src/provisioning.ts` (`Provisioner` interface :23–42, `ensureGroupBound` :212–231), `apps/web/src/lib/workspace/context.ts` (`ensureOrgFolder` :265–277)
- Test: `packages/workspace/test/provisioning.test.ts` (stubFetch pattern at :8–33)

**Interfaces:**
- Produces: `ensureGroupFolder(params: { name: string; groupId: string; permissions?: number })` — after binding the group (existing `POST /apps/groupfolders/folders/{id}/groups`), when `permissions` is set, issue `POST /apps/groupfolders/folders/{folderId}/groups/{groupId}?format=json` with body `{ permissions }`. Bitmask: read=1, update=2, create=4, delete=8, share=16, all=31.
- `ensureOrgFolder` maps roles: `owner`/`admin` → 31, `member` → 1.

- [ ] **Step 1: Failing test** — extend `provisioning.test.ts`: stubFetch expects the permissions POST with `31` for an admin bind and `1` for a member bind; assert idempotency (re-run does not re-POST when the folder listing already shows the group).
- [ ] **Step 2: Run** — `pnpm --filter @netizen-labs/workspace test` → FAIL.
- [ ] **Step 3: Implement** (follow `assertOcsOk`/OCS-code conventions at :70–73, :175–184). Wire the role→bitmask map into `ensureOrgFolder`.
- [ ] **Step 4: Verify** — `pnpm --filter @netizen-labs/workspace test` PASS (all 6 files). Note: these tests are NOT in CI (user follow-up; workflows are untouchable from this session).
- [ ] **Step 5: Commit**

```bash
git add packages/workspace/src/provisioning.ts packages/workspace/test/provisioning.test.ts apps/web/src/lib/workspace/context.ts
git commit -m "feat(workspace): groupfolder bindings carry per-role permission bitmasks — members read, admins write"
```

---

### Task 12: Mobile route for the citizen Arbeitsbereich

**Files:**
- Create: `apps/web/src/components/workspace/WorkspaceMobileNav.tsx` (copy the pattern of `apps/web/src/components/app/AppMobileNav.tsx:26–37` — `fixed bottom-0 inset-x-0 z-40 md:hidden`, items from `workspaceNav({ isCitizen })` in `apps/web/src/lib/workspace/nav.ts:34–47`, same `ICONS` mapping as `WorkspaceSidebar.tsx:11–14`)
- Modify: `apps/web/src/app/arbeitsbereich/layout.tsx` (mount below `{children}`, add `pb-16 md:pb-0` to `<main>` so content clears the bar), `apps/web/src/app/arbeitsbereich/page.tsx` (the Übersicht never links to Dateien — add a "Dateien & Dokumente" tile linking `/arbeitsbereich/dateien` in the citizen-gated section :135–201)

- [ ] **Step 1: Implement both.** `workspace-nav.test.ts` already pins nav content; no new test needed beyond it staying green.
- [ ] **Step 2: Verify** — `pnpm test:web` green; manual: `pnpm dev:web`, open `localhost:3000/arbeitsbereich` at 375 px width → bottom nav shows Übersicht/Dateien, tile navigates.
- [ ] **Step 3: Commit**

```bash
git add apps/web/src/components/workspace/WorkspaceMobileNav.tsx apps/web/src/app/arbeitsbereich/layout.tsx apps/web/src/app/arbeitsbereich/page.tsx
git commit -m "feat(web): the Arbeitsbereich reaches phones — bottom nav + Dateien tile"
```

---

### Task 13: State docs + rollout (the only task that touches production)

**Files:**
- Modify: `docs/SECURITY_FINDINGS_2026-07-28.md` (§1, §2, §4 → FIXED with commit refs; add the invite_tokens forgery/enumeration corollary as a recorded-and-fixed note), `docs/SOVEREIGN_ARBEITSBEREICH_STATE.md` (honest-limits §2: role-based write DONE, mobile route DONE; §3 launch gate: RLS fix DONE)

- [ ] **Step 1: Update both docs** (repo rule: a State doc that disagrees with reality is a bug — fix in the same change as the code).
- [ ] **Step 2: Rollout, in this exact order (Supabase MCP; STOP and hand to the user if MCP is unauthenticated):**
  1. Deploy the `org-membership` edge function; set `GNOSIS_RPC_URL` secret (same var the fixed `delete-user-account` uses).
  2. Smoke-test against production: accept a link invite in the web app (signature path), edit an org profile in expo dev build.
  3. **Apply `20260801_account_membership_lockdown.sql`.** Immediately re-test: org creation (RPC), invite create/accept, profile edit, admin approve (service role).
  4. Resolve the `20260728_workspace_sessions_gc.sql` "NOT APPLIED" contradiction (file header vs state doc) while in the MCP — verify with a `select proname from pg_proc where proname = 'reap_workspace_sessions'`.
- [ ] **Step 3: USER-GATED (list verbatim in the final report):**
  - Flip `NEXT_PUBLIC_WORKSPACE_NATIVE_FILES=1` + confirm the nine `REQUIRED` env vars (`apps/web/src/lib/workspace/config.ts:29–39`) on Vercel.
  - Name the two pilot orgs (spec §10 criteria: most-active events Verein + one gastro partner).
  - Add `packages/workspace` tests to CI (workflow scope blocked for agents).
  - Expo: ship the next EAS build so org edits use the edge function (old builds keep failing writes post-lockdown — coordinate the flip with the build).
- [ ] **Step 4: Commit**

```bash
git add docs/SECURITY_FINDINGS_2026-07-28.md docs/SOVEREIGN_ARBEITSBEREICH_STATE.md
git commit -m "docs: findings 1, 2 and 4 close — the workspace launch gate lifts"
```

---

## Self-review notes

- **Spec coverage:** W0 = Tasks 1–8 + 13 (findings §1 §2 §4, invite corollary; offsite backups + firewall stay user one-liners, listed in Task 13). W1 = Tasks 9–12 + 13 (role-based write, mobile route, flag flip). AI-Act disclosure: already shipped 2026-07-30 (parallel session) — excluded on purpose.
- **Ordering constraint restated:** Tasks 3–7 MUST be live in production before the Task 2 migration is applied. The plan encodes this by deferring application to Task 13.
- **Known accepted risks:** (1) old Expo builds break on membership writes after the lockdown until the EAS build ships — coordinated in Task 13; (2) `get_invite_by_token` is bearer-semantics by design — anyone holding a link token can read that one invite row (that IS the link-invite product behavior). (Amendment 2026-07-31: the v1 trusted-wallet RPCs `create_account_with_owner` / `list_pending_invites` / `has_pending_invite` were withdrawn after task review showed the wallet parameter is attacker-controlled; those flows are signature-verified edge-fn actions now.)
