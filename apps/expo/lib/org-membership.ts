/**
 * Expo client for the org-membership edge function
 * (apps/expo/supabase/functions/org-membership/index.ts). Mirrors
 * apps/web/src/lib/org-membership/message.ts + client.ts, combined into one
 * file since Expo has no `node:crypto`.
 *
 * Every write goes through here: sign a canonical "roebel-org-v1:..."
 * message with the caller's thirdweb account (silent — in-app wallets sign
 * without a user prompt) and POST it to the edge function, which
 * re-derives the same message server-side and verifies the signature
 * before authorizing anything. The verified signer is the actor; no
 * wallet passed in the payload is ever trusted for authorization.
 *
 * hashPayload uses expo-crypto's digestStringAsync (SHA-256, default HEX
 * encoding) instead of node:crypto's createHash — same ordinal key sort +
 * JSON.stringify input, same SHA-256-hex output, so it produces
 * byte-identical hex to apps/web/src/lib/org-membership/message.ts and to
 * the Deno edge function's crypto.subtle.digest.
 */
import Constants from 'expo-constants';
import { CryptoDigestAlgorithm, digestStringAsync } from 'expo-crypto';

export type OrgAction =
  | 'create_invite'
  | 'revoke_invite'
  | 'accept_invite'
  | 'decline_invite'
  | 'leave'
  | 'remove_member'
  | 'update_account'
  | 'create_account'
  | 'list_invites'
  | 'has_pending_invite';

export const MAX_MESSAGE_AGE_SECONDS = 300;

/**
 * Structural subset of thirdweb's `Account` (thirdweb/wallets) that this
 * module needs. Defined locally instead of importing thirdweb's type so
 * this file — and anything that only needs to build/sign a request body —
 * has no hard dependency on the thirdweb SDK. Any thirdweb `Account`
 * (in-app EOA or Gnosis smart account) satisfies this structurally.
 */
export interface SigningAccount {
  address: string;
  signMessage: (args: { message: string }) => Promise<string>;
}

export interface OrgMembershipRequestBody {
  action: OrgAction;
  wallet: string;
  timestampSec: number;
  payload: Record<string, unknown>;
  signature: string;
}

export interface OrgMembershipResponse<T = unknown> {
  ok: boolean;
  data?: T;
  code?: string;
  message?: string;
}

async function hashPayload(payload: Record<string, unknown>): Promise<string> {
  const sorted = Object.fromEntries(
    Object.entries(payload).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
  );
  return digestStringAsync(CryptoDigestAlgorithm.SHA256, JSON.stringify(sorted));
}

async function buildOrgMessage(
  action: OrgAction,
  wallet: string,
  timestampSec: number,
  payload: Record<string, unknown>
): Promise<string> {
  return `roebel-org-v1:${action}:${wallet.toLowerCase()}:${timestampSec}:${await hashPayload(payload)}`;
}

/**
 * Build and sign the request body for one org-membership action. Pure
 * apart from the account's own `signMessage` — no network call.
 */
export async function requestBody(
  account: SigningAccount,
  action: OrgAction,
  payload: Record<string, unknown>,
  timestampSec: number = Math.floor(Date.now() / 1000)
): Promise<OrgMembershipRequestBody> {
  const wallet = account.address.toLowerCase();
  const message = await buildOrgMessage(action, wallet, timestampSec, payload);
  const signature = await account.signMessage({ message });
  return { action, wallet, timestampSec, payload, signature };
}

type Extra = { SUPABASE_URL?: string; SUPABASE_ANON_KEY?: string };
const extra = (Constants.expoConfig?.extra ?? (Constants as any).manifest?.extra) as
  | Extra
  | undefined;

const SUPABASE_URL = extra?.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';
const SUPABASE_ANON_KEY = extra?.SUPABASE_ANON_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '';

/**
 * Sign and POST one org-membership action to the edge function. Never
 * throws on an application-level failure — callers inspect `ok`/`code`.
 * Only a network/parse failure or missing config produces a synthetic
 * `NETWORK_ERROR`/`NOT_CONFIGURED`.
 */
export async function callOrgMembership<T = unknown>(
  account: SigningAccount,
  action: OrgAction,
  payload: Record<string, unknown>
): Promise<OrgMembershipResponse<T>> {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    return {
      ok: false,
      code: 'NOT_CONFIGURED',
      message: 'Supabase ist nicht konfiguriert (SUPABASE_URL/ANON_KEY fehlt).',
    };
  }

  const body = await requestBody(account, action, payload);

  try {
    const res = await fetch(`${SUPABASE_URL.replace(/\/$/, '')}/functions/v1/org-membership`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: SUPABASE_ANON_KEY,
        Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
      },
      body: JSON.stringify(body),
    });
    return (await res.json()) as OrgMembershipResponse<T>;
  } catch (err) {
    console.error('callOrgMembership network error:', action, err);
    return {
      ok: false,
      code: 'NETWORK_ERROR',
      message: err instanceof Error ? err.message : 'Netzwerkfehler',
    };
  }
}
