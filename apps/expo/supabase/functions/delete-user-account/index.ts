/**
 * Supabase Edge Function: delete-user-account
 *
 * Permanently deletes a personal user account, all org accounts the user
 * solely owns, and every user-scoped row in our schema. Required by
 * App Store Review Guideline 5.1.1(v): apps that support account creation
 * must also offer account deletion.
 *
 * Auth: the body must include a signed message
 * ("delete-account:<wallet>:<unix-minute>") signed by the same wallet's
 * thirdweb in-app wallet. Signature is recovered with viem and compared
 * to the claimed wallet address before any destructive work runs.
 *
 * Deploy: supabase functions deploy delete-user-account
 * Env: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are platform-injected.
 */

import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.0';
import { recoverMessageAddress, isAddress, createPublicClient, http } from 'https://esm.sh/viem@2.21.45';
import { gnosis } from 'https://esm.sh/viem@2.21.45/chains';

type Body = {
  wallet: string;
  message: string;
  signature: string;
};

type ErrorCode =
  | 'BAD_REQUEST'
  | 'NO_WALLET'
  | 'BAD_SIGNATURE'
  | 'STALE_MESSAGE'
  | 'USER_NOT_FOUND'
  | 'DELETE_FAILED'
  | 'INTERNAL';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const MAX_MESSAGE_AGE_SECONDS = 300;

// ERC-1271/6492 verification needs the chain the smart account lives on.
const gnosisClient = createPublicClient({
  chain: gnosis,
  transport: http(Deno.env.get('GNOSIS_RPC_URL') ?? 'https://rpc.gnosischain.com'),
});

function json(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

function fail(code: ErrorCode, status = 400, error?: string) {
  return json(status, { ok: false, code, ...(error ? { error } : {}) });
}

function parseMessage(message: string): { wallet: string; issuedAtSec: number } | null {
  // Format: "delete-account:0xabc...:<unix-seconds>"
  const m = /^delete-account:(0x[0-9a-fA-F]{40}):(\d{10,})$/.exec(message);
  if (!m) return null;
  return { wallet: m[1].toLowerCase(), issuedAtSec: Number(m[2]) };
}

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

  if (!body || typeof body.wallet !== 'string' || typeof body.message !== 'string' || typeof body.signature !== 'string') {
    return fail('BAD_REQUEST', 400, 'Expected { wallet, message, signature }');
  }
  if (!isAddress(body.wallet)) {
    return fail('NO_WALLET', 400, 'wallet must be a 0x-prefixed 40-char hex address');
  }

  const claimedWallet = body.wallet.toLowerCase();
  const parsed = parseMessage(body.message);
  if (!parsed || parsed.wallet !== claimedWallet) {
    return fail('BAD_REQUEST', 400, 'message body does not match wallet');
  }

  const nowSec = Math.floor(Date.now() / 1000);
  if (Math.abs(nowSec - parsed.issuedAtSec) > MAX_MESSAGE_AGE_SECONDS) {
    return fail('STALE_MESSAGE', 400, 'message timestamp is outside the allowed window');
  }

  // Fast path: plain EOA recovery. Smart accounts (ERC-1271/6492) fall through
  // to viem's universal verifier, which runs the check against the account
  // contract on Gnosis — the client signs with the smart account, so recovery
  // alone would yield the enclave admin EOA and always mismatch.
  let verified = false;
  try {
    const recovered = (
      await recoverMessageAddress({
        message: body.message,
        signature: body.signature as `0x${string}`,
      })
    ).toLowerCase();
    verified = recovered === claimedWallet;
  } catch {
    // not an EOA signature — try the universal path
  }
  if (!verified) {
    try {
      verified = await gnosisClient.verifyMessage({
        address: body.wallet as `0x${string}`,
        message: body.message,
        signature: body.signature as `0x${string}`,
      });
    } catch (err) {
      console.error('signature verification failed', err);
      return fail('BAD_SIGNATURE', 400, 'could not verify signer');
    }
  }
  if (!verified) {
    return fail('BAD_SIGNATURE', 400, 'signer does not match wallet');
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!supabaseUrl || !serviceKey) {
    return fail('INTERNAL', 500, 'Service not configured');
  }
  const db = createClient(supabaseUrl, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  try {
    // 1. Verify the user exists.
    const { data: user, error: userErr } = await db
      .from('users')
      .select('wallet_address')
      .eq('wallet_address', claimedWallet)
      .maybeSingle();
    if (userErr) throw userErr;
    if (!user) return fail('USER_NOT_FOUND', 404);

    // 2. Find solely-owned org accounts and delete them. account_owners,
    //    posts, events, etc. cascade from accounts (005_accounts_system.sql).
    const { data: ownedAccounts, error: ownedErr } = await db
      .from('account_owners')
      .select('account_id')
      .eq('wallet_address', claimedWallet);
    if (ownedErr) throw ownedErr;

    const ownedIds = (ownedAccounts ?? []).map((row) => row.account_id);
    if (ownedIds.length > 0) {
      const { data: ownerCounts, error: countErr } = await db
        .from('account_owners')
        .select('account_id, wallet_address')
        .in('account_id', ownedIds);
      if (countErr) throw countErr;

      const totalByAccount = new Map<string, number>();
      for (const row of ownerCounts ?? []) {
        totalByAccount.set(row.account_id, (totalByAccount.get(row.account_id) ?? 0) + 1);
      }

      // Sole-owner accounts (excluding the personal account, which is always
      // sole-owner and cascades from the user row anyway).
      const { data: personalRows, error: personalErr } = await db
        .from('accounts')
        .select('id, account_type')
        .in('id', ownedIds);
      if (personalErr) throw personalErr;

      const personalAccountIds = new Set(
        (personalRows ?? [])
          .filter((a) => a.account_type === 'personal')
          .map((a) => a.id),
      );

      const orgsToDelete = ownedIds.filter(
        (id) => !personalAccountIds.has(id) && (totalByAccount.get(id) ?? 0) === 1,
      );

      if (orgsToDelete.length > 0) {
        const { error: delOrgsErr } = await db
          .from('accounts')
          .delete()
          .in('id', orgsToDelete);
        if (delOrgsErr) throw delOrgsErr;
      }
    }

    // 3. Tables with wallet_address but no FK / no CASCADE on users. Must
    //    delete manually before the user row goes. Source: information_schema
    //    sweep on 2026-05-22; extended 2026-07-31 from the migrations that
    //    landed since (nostr identity bridge, workspace, muenzen tips, mecky
    //    conversations/outreach). `nostr_identities` is the wallet↔npub
    //    bridge — deleting it is what makes the on-chain/Nostr trail
    //    effectively anonymous (EDPB 02/2025 §103) and drops the npub from
    //    the relay allow-list on the next sync pass. Rows whose stored case
    //    may differ from the lowercased claim use ilike.
    const walletColumnTables: { table: string; column: string; ilike?: boolean }[] = [
      { table: 'citizens_registration', column: 'wallet_address' },
      { table: 'consent_audit_log', column: 'wallet_address' },
      { table: 'conversation_participants', column: 'wallet_address' },
      { table: 'event_interests', column: 'user_wallet' },
      { table: 'event_views', column: 'wallet_address' },
      { table: 'help_requests', column: 'user_wallet' },
      { table: 'mecky_conversations', column: 'owner_wallet' }, // messages cascade
      { table: 'mecky_outreach_log', column: 'recipient_wallet' },
      { table: 'muenzen_tips', column: 'from_wallet' },
      { table: 'muenzen_tips', column: 'to_wallet' },
      { table: 'nostr_identities', column: 'wallet_address' },
      { table: 'phone_verification_sessions', column: 'wallet_address' },
      { table: 'poll_votes', column: 'wallet_address' },
      { table: 'proposal_comment_likes', column: 'wallet_address' },
      { table: 'push_tokens', column: 'wallet_address', ilike: true },
      { table: 'referral_codes', column: 'wallet_address' },
      { table: 'rewards_daily_checkins', column: 'wallet_address' },
      { table: 'rewards_task_completions', column: 'wallet_address' },
      { table: 'roebel_card', column: 'wallet_address' },
      { table: 'tour_completions', column: 'user_wallet' },
      { table: 'user_lootbox_keys', column: 'wallet_address' },
      { table: 'user_lootbox_rewards', column: 'wallet_address' },
      { table: 'verification_audit_log', column: 'wallet_address' },
      { table: 'vote_history', column: 'wallet_address' },
      { table: 'workspace_actions', column: 'actor_sub' }, // sub = lowercased wallet
      { table: 'workspace_sessions', column: 'sub' },
    ];

    for (const { table, column, ilike } of walletColumnTables) {
      const q = db.from(table).delete();
      const { error } = ilike
        ? await q.ilike(column, claimedWallet)
        : await q.eq(column, claimedWallet);
      if (error) {
        // Skip "table not in PostgREST cache" and similar non-fatal errors,
        // but surface real failures so we can debug.
        console.error(`Failed to clear ${table}.${column}:`, error.message);
      }
    }

    // 3b. Detach instead of delete: content that legitimately outlives its
    //     creator (org flyers) keeps the row, loses the person.
    {
      const { error } = await db
        .from('flyers')
        .update({ created_by_wallet: null })
        .eq('created_by_wallet', claimedWallet);
      if (error) console.error('Failed to detach flyers.created_by_wallet:', error.message);
    }

    // 4. Delete the user row. CASCADE handles account_owners (incl. the
    //    personal account, which sole-owners → cascades to accounts itself),
    //    posts, post_likes, post_comments, proposal_comments,
    //    account_ratings, menu_item_votes, event_experiences,
    //    explorer_completions, roebel_points_*, stamp_cards. consent_preferences
    //    gets SET NULL so the wallet_address is detached.
    const { error: delUserErr } = await db
      .from('users')
      .delete()
      .eq('wallet_address', claimedWallet);
    if (delUserErr) {
      console.error('Failed to delete user row', delUserErr);
      return fail('DELETE_FAILED', 500, delUserErr.message);
    }

    return json(200, { ok: true });
  } catch (err) {
    console.error('delete-user-account fatal', err);
    return fail('INTERNAL', 500, (err as Error)?.message);
  }
});
