/**
 * Supabase Edge Function: org-membership
 *
 * The ONLY write path for org membership once
 * 20260801_account_membership_lockdown.sql is applied: creating/revoking
 * invites, accepting/declining them, leaving an org, removing a member,
 * updating account fields, and creating a new account. Also serves two
 * privileged reads (list_invites, has_pending_invite) that the lockdown
 * migration closes off from anon-key access.
 *
 * Auth: every request carries a signed message
 * ("roebel-org-v1:<action>:<wallet>:<timestampSec>:<payloadHash>") signed
 * by the caller's wallet (thirdweb in-app EOA or Gnosis smart account).
 * The signature is verified (EOA recovery, falling back to ERC-1271/6492
 * for smart accounts) before any authorization check or write runs. The
 * verified signer — never a wallet passed in the payload — is the actor
 * for every authorization decision below.
 *
 * Message format mirrors apps/web/src/lib/org-membership/message.ts
 * byte-for-byte: payload keys are sorted with a plain ordinal comparator
 * (NOT localeCompare), then JSON.stringify'd, then SHA-256 hex digested.
 *
 * Deploy: supabase functions deploy org-membership
 * Env: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are platform-injected.
 *      GNOSIS_RPC_URL optional (falls back to the public RPC).
 */

import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.0';
import { recoverMessageAddress, createPublicClient, http } from 'https://esm.sh/viem@2.21.45';
import { gnosis } from 'https://esm.sh/viem@2.21.45/chains';

// ── Contract ──────────────────────────────────────────────────────────

const ACTIONS = [
  'create_invite',
  'revoke_invite',
  'accept_invite',
  'decline_invite',
  'leave',
  'remove_member',
  'update_account',
  'create_account',
  'list_invites',
  'has_pending_invite',
] as const;
type OrgAction = (typeof ACTIONS)[number];

type Body = {
  action: string;
  wallet: string;
  timestampSec: number;
  payload: Record<string, unknown>;
  signature: string;
};

const MAX_MESSAGE_AGE_SECONDS = 300;

const WALLET_RE = /^0x[0-9a-fA-F]{40}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const INVITE_ROLES = ['admin', 'member'] as const;
const ACCOUNT_TYPES = ['personal', 'organisation'] as const;
const SUB_TYPES = ['restaurant', 'unternehmen', 'verein', 'stadt', 'fraktion', 'journalist'] as const;
const UPDATE_WHITELIST = ['name', 'bio', 'avatar_url', 'cover_url', 'contact_email', 'opening_hours'] as const;

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

// ERC-1271/6492 verification needs the chain the smart account lives on.
const gnosisClient = createPublicClient({
  chain: gnosis,
  transport: http(Deno.env.get('GNOSIS_RPC_URL') ?? 'https://rpc.gnosischain.com'),
});

type Admin = ReturnType<typeof createClient>;

// ── Message hashing — MUST mirror apps/web/src/lib/org-membership/message.ts
//    byte-for-byte: ordinal key sort (not localeCompare), JSON.stringify,
//    SHA-256 hex. ──────────────────────────────────────────────────────

async function hashPayload(payload: Record<string, unknown>): Promise<string> {
  const sorted = Object.fromEntries(
    Object.entries(payload).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
  );
  const bytes = new TextEncoder().encode(JSON.stringify(sorted));
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function buildOrgMessage(
  action: string,
  wallet: string,
  timestampSec: number,
  payloadHash: string,
): string {
  return `roebel-org-v1:${action}:${wallet.toLowerCase()}:${timestampSec}:${payloadHash}`;
}

// ── Response helpers ─────────────────────────────────────────────────

function json(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

function ok(data?: unknown) {
  return json(200, { ok: true, ...(data === undefined ? {} : { data }) });
}

function fail(code: string, status: number, message: string) {
  return json(status, { ok: false, code, message });
}

// ── Authorization idiom (apps/web/src/app/api/mecky/story-draft/route.ts:89-116) ──

async function requireOwnerOrAdmin(
  admin: Admin,
  accountId: string,
  signer: string,
): Promise<{ role: string } | Response> {
  const { data, error } = await admin
    .from('account_owners')
    .select('role')
    .eq('account_id', accountId)
    .eq('wallet_address', signer)
    .maybeSingle();
  if (error) return fail('INTERNAL', 500, error.message);
  if (!data) return fail('FORBIDDEN', 403, 'not a member of this account');
  const role = (data as { role: string }).role;
  if (role !== 'owner' && role !== 'admin') {
    return fail('FORBIDDEN', 403, 'requires owner or admin role');
  }
  return { role };
}

async function countOwners(admin: Admin, accountId: string): Promise<number | Response> {
  const { count, error } = await admin
    .from('account_owners')
    .select('wallet_address', { count: 'exact', head: true })
    .eq('account_id', accountId)
    .eq('role', 'owner');
  if (error) return fail('INTERNAL', 500, error.message);
  return count ?? 0;
}

// ── Validation helpers ───────────────────────────────────────────────

function asString(v: unknown): string | null {
  return typeof v === 'string' ? v : null;
}

function requireUuid(v: unknown, field: string): string | Response {
  const s = asString(v);
  if (!s || !UUID_RE.test(s)) return fail('BAD_REQUEST', 400, `invalid ${field}`);
  return s;
}

// ── Handlers ─────────────────────────────────────────────────────────

async function handleCreateInvite(
  admin: Admin,
  signer: string,
  payload: Record<string, unknown>,
): Promise<Response> {
  const accountId = requireUuid(payload.accountId, 'accountId');
  if (accountId instanceof Response) return accountId;

  const role = asString(payload.role);
  if (!role || !(INVITE_ROLES as readonly string[]).includes(role)) {
    return fail('BAD_REQUEST', 400, 'role must be "admin" or "member"');
  }

  let invitedWallet: string | null = null;
  if (payload.invitedWallet !== null && payload.invitedWallet !== undefined) {
    const w = asString(payload.invitedWallet);
    if (!w || !WALLET_RE.test(w)) return fail('BAD_REQUEST', 400, 'invalid invitedWallet');
    invitedWallet = w.toLowerCase();
  }

  let expiresInDays = 7;
  if (payload.expiresInDays !== undefined) {
    const n = Number(payload.expiresInDays);
    if (!Number.isInteger(n) || n < 1 || n > 90) {
      return fail('BAD_REQUEST', 400, 'expiresInDays must be an integer between 1 and 90');
    }
    expiresInDays = n;
  }

  const gate = await requireOwnerOrAdmin(admin, accountId, signer);
  if (gate instanceof Response) return gate;

  const { data: invite, error: inviteErr } = await admin
    .from('invite_tokens')
    .insert({
      account_id: accountId,
      role,
      invited_by: signer,
      invited_wallet: invitedWallet,
      expires_at: new Date(Date.now() + expiresInDays * 24 * 60 * 60 * 1000).toISOString(),
    })
    .select()
    .single();
  if (inviteErr) return fail('INTERNAL', 500, inviteErr.message);

  // Matches apps/web/src/lib/supabase-invites.ts:55-69 (createInAppInvite).
  // Notification failure does not roll back the invite — a missing in-app
  // ping is recoverable via list_invites; a lost invite row is not.
  if (invitedWallet) {
    const { data: account } = await admin.from('accounts').select('name').eq('id', accountId).maybeSingle();
    const orgName = (account as { name?: string } | null)?.name || 'Organisation';
    const roleLabel = role === 'admin' ? 'Admin' : 'Mitglied';
    const { error: notifErr } = await admin.from('notifications').insert({
      recipient_wallet: invitedWallet,
      type: 'org_invite',
      title: `Einladung von ${orgName}`,
      body: `Du wurdest als ${roleLabel} eingeladen`,
      metadata: {
        account_id: accountId,
        role,
        invitation_id: (invite as { id: string }).id,
      },
    });
    if (notifErr) {
      console.error('org-membership create_invite: notification insert failed', notifErr.message);
    }
  }

  return ok(invite);
}

async function handleRevokeInvite(
  admin: Admin,
  signer: string,
  payload: Record<string, unknown>,
): Promise<Response> {
  const inviteId = requireUuid(payload.inviteId, 'inviteId');
  if (inviteId instanceof Response) return inviteId;

  const { data: invite, error } = await admin
    .from('invite_tokens')
    .select('id, account_id')
    .eq('id', inviteId)
    .maybeSingle();
  if (error) return fail('INTERNAL', 500, error.message);
  if (!invite) return fail('NOT_FOUND', 404, 'invite not found');

  const gate = await requireOwnerOrAdmin(admin, (invite as { account_id: string }).account_id, signer);
  if (gate instanceof Response) return gate;

  const { data: updated, error: updErr } = await admin
    .from('invite_tokens')
    .update({ status: 'revoked' })
    .eq('id', inviteId)
    .select()
    .single();
  if (updErr) return fail('INTERNAL', 500, updErr.message);

  await admin.from('notifications').delete().eq('type', 'org_invite').contains('metadata', { invitation_id: inviteId });

  return ok(updated);
}

async function handleAcceptInvite(
  admin: Admin,
  signer: string,
  payload: Record<string, unknown>,
): Promise<Response> {
  const inviteId = requireUuid(payload.inviteId, 'inviteId');
  if (inviteId instanceof Response) return inviteId;

  const { data: inviteRow, error } = await admin.from('invite_tokens').select('*').eq('id', inviteId).maybeSingle();
  if (error) return fail('INTERNAL', 500, error.message);
  if (!inviteRow) return fail('NOT_FOUND', 404, 'invite not found');
  const invite = inviteRow as {
    id: string;
    account_id: string;
    role: string;
    invited_by: string;
    invited_wallet: string | null;
    status: string;
    expires_at: string;
  };

  if (invite.status !== 'pending') return fail('CONFLICT', 409, 'invite is not pending');
  if (invite.invited_wallet && invite.invited_wallet.toLowerCase() !== signer) {
    return fail('FORBIDDEN', 403, 'invite is not addressed to this wallet');
  }
  if (new Date(invite.expires_at).getTime() < Date.now()) {
    await admin.from('invite_tokens').update({ status: 'expired' }).eq('id', inviteId);
    return fail('EXPIRED', 409, 'invite has expired');
  }

  const { error: updErr } = await admin.from('invite_tokens').update({ status: 'accepted' }).eq('id', inviteId);
  if (updErr) return fail('INTERNAL', 500, updErr.message);

  const { error: ownerErr } = await admin.from('account_owners').upsert(
    {
      account_id: invite.account_id,
      wallet_address: signer,
      role: invite.role,
      invited_by: invite.invited_by,
    },
    { onConflict: 'account_id,wallet_address', ignoreDuplicates: true },
  );
  if (ownerErr) return fail('INTERNAL', 500, ownerErr.message);

  if (invite.invited_wallet) {
    await admin
      .from('notifications')
      .update({ is_read: true })
      .eq('type', 'org_invite')
      .contains('metadata', { invitation_id: inviteId });
  }

  return ok({ accountId: invite.account_id, role: invite.role });
}

async function handleDeclineInvite(
  admin: Admin,
  signer: string,
  payload: Record<string, unknown>,
): Promise<Response> {
  const inviteId = requireUuid(payload.inviteId, 'inviteId');
  if (inviteId instanceof Response) return inviteId;

  const { data: inviteRow, error } = await admin.from('invite_tokens').select('*').eq('id', inviteId).maybeSingle();
  if (error) return fail('INTERNAL', 500, error.message);
  if (!inviteRow) return fail('NOT_FOUND', 404, 'invite not found');
  const invite = inviteRow as {
    id: string;
    invited_wallet: string | null;
    status: string;
    expires_at: string;
  };

  if (invite.status !== 'pending') return fail('CONFLICT', 409, 'invite is not pending');
  if (invite.invited_wallet && invite.invited_wallet.toLowerCase() !== signer) {
    return fail('FORBIDDEN', 403, 'invite is not addressed to this wallet');
  }
  if (new Date(invite.expires_at).getTime() < Date.now()) {
    await admin.from('invite_tokens').update({ status: 'expired' }).eq('id', inviteId);
    return fail('EXPIRED', 409, 'invite has expired');
  }

  const { data: updated, error: updErr } = await admin
    .from('invite_tokens')
    .update({ status: 'declined' })
    .eq('id', inviteId)
    .select()
    .single();
  if (updErr) return fail('INTERNAL', 500, updErr.message);

  await admin
    .from('notifications')
    .update({ is_read: true })
    .eq('type', 'org_invite')
    .contains('metadata', { invitation_id: inviteId });

  return ok(updated);
}

async function handleLeave(
  admin: Admin,
  signer: string,
  payload: Record<string, unknown>,
): Promise<Response> {
  const accountId = requireUuid(payload.accountId, 'accountId');
  if (accountId instanceof Response) return accountId;

  const { data: membership, error } = await admin
    .from('account_owners')
    .select('role')
    .eq('account_id', accountId)
    .eq('wallet_address', signer)
    .maybeSingle();
  if (error) return fail('INTERNAL', 500, error.message);
  if (!membership) return fail('NOT_FOUND', 404, 'not a member of this account');

  if ((membership as { role: string }).role === 'owner') {
    const ownerCount = await countOwners(admin, accountId);
    if (ownerCount instanceof Response) return ownerCount;
    if (ownerCount <= 1) return fail('LAST_OWNER', 409, 'cannot leave: you are the last owner');
  }

  const { error: delErr } = await admin
    .from('account_owners')
    .delete()
    .eq('account_id', accountId)
    .eq('wallet_address', signer);
  if (delErr) return fail('INTERNAL', 500, delErr.message);

  return ok({ left: true });
}

async function handleRemoveMember(
  admin: Admin,
  signer: string,
  payload: Record<string, unknown>,
): Promise<Response> {
  const accountId = requireUuid(payload.accountId, 'accountId');
  if (accountId instanceof Response) return accountId;

  const rawMemberWallet = asString(payload.memberWallet);
  if (!rawMemberWallet || !WALLET_RE.test(rawMemberWallet)) {
    return fail('BAD_REQUEST', 400, 'invalid memberWallet');
  }
  const memberWallet = rawMemberWallet.toLowerCase();

  const gate = await requireOwnerOrAdmin(admin, accountId, signer);
  if (gate instanceof Response) return gate;

  const { data: targetRow, error } = await admin
    .from('account_owners')
    .select('role')
    .eq('account_id', accountId)
    .eq('wallet_address', memberWallet)
    .maybeSingle();
  if (error) return fail('INTERNAL', 500, error.message);
  if (!targetRow) return fail('NOT_FOUND', 404, 'member not found');
  const target = targetRow as { role: string };

  if (target.role === 'owner') {
    if (gate.role !== 'owner') return fail('FORBIDDEN', 403, 'only an owner can remove an owner');
    // Covers self-removal too: an owner calling remove_member on their own
    // wallet must not be able to bypass leave's last-owner protection.
    const ownerCount = await countOwners(admin, accountId);
    if (ownerCount instanceof Response) return ownerCount;
    if (ownerCount <= 1) return fail('LAST_OWNER', 409, 'cannot remove the last owner');
  }

  const { error: delErr } = await admin
    .from('account_owners')
    .delete()
    .eq('account_id', accountId)
    .eq('wallet_address', memberWallet);
  if (delErr) return fail('INTERNAL', 500, delErr.message);

  return ok({ removed: true });
}

async function handleUpdateAccount(
  admin: Admin,
  signer: string,
  payload: Record<string, unknown>,
): Promise<Response> {
  const accountId = requireUuid(payload.accountId, 'accountId');
  if (accountId instanceof Response) return accountId;

  const updates = payload.updates;
  if (!updates || typeof updates !== 'object' || Array.isArray(updates)) {
    return fail('BAD_REQUEST', 400, 'updates must be an object');
  }

  const gate = await requireOwnerOrAdmin(admin, accountId, signer);
  if (gate instanceof Response) return gate;

  const patch: Record<string, unknown> = {};
  for (const key of UPDATE_WHITELIST) {
    if (Object.prototype.hasOwnProperty.call(updates, key)) {
      patch[key] = (updates as Record<string, unknown>)[key];
    }
  }

  if (typeof patch.name === 'string') {
    const trimmed = patch.name.trim();
    if (trimmed.length < 1 || trimmed.length > 80) {
      return fail('BAD_REQUEST', 400, 'name must be 1-80 chars');
    }
    patch.name = trimmed;
  } else if ('name' in patch) {
    return fail('BAD_REQUEST', 400, 'name must be a string');
  }

  if ('bio' in patch && patch.bio !== null) {
    if (typeof patch.bio !== 'string' || patch.bio.length > 500) {
      return fail('BAD_REQUEST', 400, 'bio must be a string of at most 500 chars');
    }
  }

  if (Object.keys(patch).length === 0) {
    return fail('BAD_REQUEST', 400, 'no valid fields to update');
  }
  patch.updated_at = new Date().toISOString();

  const { data: updated, error } = await admin.from('accounts').update(patch).eq('id', accountId).select().single();
  if (error) return fail('INTERNAL', 500, error.message);

  return ok(updated);
}

async function handleCreateAccount(
  admin: Admin,
  signer: string,
  payload: Record<string, unknown>,
): Promise<Response> {
  const accountType = asString(payload.accountType);
  if (!accountType || !(ACCOUNT_TYPES as readonly string[]).includes(accountType)) {
    return fail('BAD_REQUEST', 400, 'accountType must be "personal" or "organisation"');
  }

  const rawName = asString(payload.name);
  if (rawName === null) return fail('BAD_REQUEST', 400, 'name required');
  const name = rawName.trim();
  if (name.length < 1 || name.length > 80) return fail('BAD_REQUEST', 400, 'name must be 1-80 chars');

  let subType: string | null = null;
  if (payload.subType !== undefined && payload.subType !== null) {
    const s = asString(payload.subType);
    if (!s || !(SUB_TYPES as readonly string[]).includes(s)) {
      return fail('BAD_REQUEST', 400, 'invalid subType');
    }
    subType = s;
  }

  let bio: string | null = null;
  if (payload.bio !== undefined && payload.bio !== null) {
    const b = asString(payload.bio);
    if (b === null || b.length > 500) return fail('BAD_REQUEST', 400, 'bio must be a string of at most 500 chars');
    bio = b;
  }

  let avatarUrl: string | null = null;
  if (payload.avatarUrl !== undefined && payload.avatarUrl !== null) {
    const a = asString(payload.avatarUrl);
    if (a === null) return fail('BAD_REQUEST', 400, 'invalid avatarUrl');
    avatarUrl = a;
  }

  const { data: accountRow, error: accountErr } = await admin
    .from('accounts')
    .insert({ account_type: accountType, name, sub_type: subType, bio, avatar_url: avatarUrl })
    .select()
    .single();
  if (accountErr) return fail('INTERNAL', 500, accountErr.message);
  const account = accountRow as { id: string };

  // Signer becomes the first owner — never a wallet from the payload,
  // otherwise anyone could attach a stranger's wallet as owner of a
  // brand-new account.
  const { error: ownerErr } = await admin
    .from('account_owners')
    .insert({ account_id: account.id, wallet_address: signer, role: 'owner', invited_by: null });
  if (ownerErr) {
    // Roll back the orphaned account row rather than leaving an
    // ownerless account behind.
    await admin.from('accounts').delete().eq('id', account.id);
    return fail('INTERNAL', 500, ownerErr.message);
  }

  return ok(accountRow);
}

async function handleListInvites(
  admin: Admin,
  signer: string,
  payload: Record<string, unknown>,
): Promise<Response> {
  const accountId = requireUuid(payload.accountId, 'accountId');
  if (accountId instanceof Response) return accountId;

  const gate = await requireOwnerOrAdmin(admin, accountId, signer);
  if (gate instanceof Response) return gate;

  const { data, error } = await admin
    .from('invite_tokens')
    .select('*')
    .eq('account_id', accountId)
    .eq('status', 'pending')
    .order('created_at', { ascending: false });
  if (error) return fail('INTERNAL', 500, error.message);

  return ok(data ?? []);
}

async function handleHasPendingInvite(
  admin: Admin,
  signer: string,
  payload: Record<string, unknown>,
): Promise<Response> {
  const accountId = requireUuid(payload.accountId, 'accountId');
  if (accountId instanceof Response) return accountId;

  const { data, error } = await admin
    .from('invite_tokens')
    .select('id')
    .eq('account_id', accountId)
    .eq('invited_wallet', signer)
    .eq('status', 'pending')
    .maybeSingle();
  if (error) return fail('INTERNAL', 500, error.message);

  return ok({ pending: !!data });
}

// ── Entry point ──────────────────────────────────────────────────────

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }
  if (req.method !== 'POST') {
    return fail('BAD_REQUEST', 405, 'Method not allowed');
  }

  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return fail('BAD_REQUEST', 400, 'Invalid JSON');
  }
  if (!body || typeof body !== 'object') {
    return fail('BAD_REQUEST', 400, 'Expected { action, wallet, timestampSec, payload, signature }');
  }

  const { action, wallet, timestampSec, payload, signature } = body;

  if (typeof action !== 'string' || !(ACTIONS as readonly string[]).includes(action)) {
    return fail('BAD_ACTION', 400, 'unknown action');
  }
  if (typeof wallet !== 'string' || !WALLET_RE.test(wallet)) {
    return fail('BAD_WALLET', 400, 'wallet malformed');
  }
  if (typeof signature !== 'string' || signature.length === 0) {
    return fail('BAD_REQUEST', 400, 'signature required');
  }

  const ts = Number(timestampSec);
  const ageSec = Math.abs(Date.now() / 1000 - ts);
  if (!Number.isFinite(ts) || !Number.isFinite(ageSec) || ageSec > MAX_MESSAGE_AGE_SECONDS) {
    return fail('STALE', 400, 'message expired');
  }

  const payloadObj: Record<string, unknown> =
    payload && typeof payload === 'object' && !Array.isArray(payload) ? payload : {};

  const message = buildOrgMessage(action, wallet, ts, await hashPayload(payloadObj));
  const claimedWallet = wallet.toLowerCase();

  // Fast path: plain EOA recovery. Smart accounts (ERC-1271/6492) fall
  // through to viem's universal verifier, which checks against the
  // account contract on Gnosis.
  let verified = false;
  try {
    const recovered = (
      await recoverMessageAddress({ message, signature: signature as `0x${string}` })
    ).toLowerCase();
    verified = recovered === claimedWallet;
  } catch {
    // not an EOA signature — try the universal path
  }
  if (!verified) {
    try {
      verified = await gnosisClient.verifyMessage({
        address: wallet as `0x${string}`,
        message,
        signature: signature as `0x${string}`,
      });
    } catch (err) {
      console.error('signature verification failed', err);
      return fail('BAD_SIGNATURE', 401, 'could not verify signer');
    }
  }
  if (!verified) {
    return fail('BAD_SIGNATURE', 401, 'signer does not match wallet');
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!supabaseUrl || !serviceKey) return fail('INTERNAL', 500, 'Service not configured');
  const admin = createClient(supabaseUrl, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const signer = claimedWallet;

  try {
    switch (action as OrgAction) {
      case 'create_invite':
        return await handleCreateInvite(admin, signer, payloadObj);
      case 'revoke_invite':
        return await handleRevokeInvite(admin, signer, payloadObj);
      case 'accept_invite':
        return await handleAcceptInvite(admin, signer, payloadObj);
      case 'decline_invite':
        return await handleDeclineInvite(admin, signer, payloadObj);
      case 'leave':
        return await handleLeave(admin, signer, payloadObj);
      case 'remove_member':
        return await handleRemoveMember(admin, signer, payloadObj);
      case 'update_account':
        return await handleUpdateAccount(admin, signer, payloadObj);
      case 'create_account':
        return await handleCreateAccount(admin, signer, payloadObj);
      case 'list_invites':
        return await handleListInvites(admin, signer, payloadObj);
      case 'has_pending_invite':
        return await handleHasPendingInvite(admin, signer, payloadObj);
      default:
        return fail('BAD_ACTION', 400, 'unknown action');
    }
  } catch (err) {
    console.error(`org-membership ${action} fatal`, err);
    return fail('INTERNAL', 500, (err as Error)?.message ?? 'internal error');
  }
});
