// Browser-side helper for the org-membership edge function
// (apps/expo/supabase/functions/org-membership/index.ts). Every write goes
// through here: sign a canonical "roebel-org-v1:..." message with the
// caller's thirdweb account (silent — in-app wallets sign without a user
// prompt) and POST it to the edge function, which re-derives the same
// message server-side and verifies the signature before authorizing
// anything. The verified signer is the actor; no wallet passed in the
// payload is ever trusted for authorization.
import { buildOrgMessage, type OrgAction } from "./message";

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
  const message = buildOrgMessage(action, wallet, timestampSec, payload);
  const signature = await account.signMessage({ message });
  return { action, wallet, timestampSec, payload, signature };
}

/**
 * Sign and POST one org-membership action to the edge function. Never
 * throws on an application-level failure — callers inspect `ok`/`code`.
 * Only a network/parse failure produces a synthetic `NETWORK_ERROR`.
 */
export async function callOrgMembership<T = unknown>(
  account: SigningAccount,
  action: OrgAction,
  payload: Record<string, unknown>
): Promise<OrgMembershipResponse<T>> {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!supabaseUrl || !anonKey) {
    return {
      ok: false,
      code: "NOT_CONFIGURED",
      message: "Supabase ist nicht konfiguriert (NEXT_PUBLIC_SUPABASE_URL/ANON_KEY fehlt).",
    };
  }

  const body = await requestBody(account, action, payload);

  try {
    const res = await fetch(`${supabaseUrl.replace(/\/$/, "")}/functions/v1/org-membership`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${anonKey}`,
      },
      body: JSON.stringify(body),
    });
    return (await res.json()) as OrgMembershipResponse<T>;
  } catch (err) {
    console.error("callOrgMembership network error:", action, err);
    return {
      ok: false,
      code: "NETWORK_ERROR",
      message: err instanceof Error ? err.message : "Netzwerkfehler",
    };
  }
}
