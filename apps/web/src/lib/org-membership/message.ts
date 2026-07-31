// Canonical message spec for the org-membership edge function. The Deno side
// (apps/expo/supabase/functions/org-membership/index.ts) mirrors this format;
// the test file is the shared contract.
import { createHash } from "node:crypto";

export type OrgAction =
  | "create_invite" | "revoke_invite" | "accept_invite" | "decline_invite"
  | "leave" | "remove_member" | "update_account";

export const MAX_MESSAGE_AGE_SECONDS = 300;

export function hashPayload(payload: Record<string, unknown>): string {
  const sorted = Object.fromEntries(Object.entries(payload).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
  return createHash("sha256").update(JSON.stringify(sorted)).digest("hex");
}

export function buildOrgMessage(
  action: OrgAction, wallet: string, timestampSec: number, payload: Record<string, unknown>,
): string {
  return `roebel-org-v1:${action}:${wallet.toLowerCase()}:${timestampSec}:${hashPayload(payload)}`;
}
