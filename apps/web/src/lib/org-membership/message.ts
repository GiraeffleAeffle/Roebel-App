// Canonical message spec for the org-membership edge function. The Deno side
// (apps/expo/supabase/functions/org-membership/index.ts) mirrors this format;
// the test file is the shared contract.
//
// The digest comes from @noble/hashes, not node:crypto, because this module is
// reachable from a "use client" component (AccountContext -> supabase-accounts
// -> org-membership/client) and webpack cannot bundle a `node:` scheme import
// for the browser — it fails the whole build with UnhandledSchemeError. noble
// is pure JS and isomorphic, and the contract test pins its output against
// node:crypto's, so the hash stays byte-identical to what the edge function
// (crypto.subtle) computes.
import { sha256 } from "@noble/hashes/sha256";
import { bytesToHex, utf8ToBytes } from "@noble/hashes/utils";

export type OrgAction =
  | "create_invite" | "revoke_invite" | "accept_invite" | "decline_invite"
  | "leave" | "remove_member" | "update_member_role" | "update_account"
  | "create_account" | "list_invites" | "has_pending_invite";

export const MAX_MESSAGE_AGE_SECONDS = 300;

export function hashPayload(payload: Record<string, unknown>): string {
  const sorted = Object.fromEntries(Object.entries(payload).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
  return bytesToHex(sha256(utf8ToBytes(JSON.stringify(sorted))));
}

export function buildOrgMessage(
  action: OrgAction, wallet: string, timestampSec: number, payload: Record<string, unknown>,
): string {
  return `roebel-org-v1:${action}:${wallet.toLowerCase()}:${timestampSec}:${hashPayload(payload)}`;
}
