import { createAdminClient } from "@/lib/supabase/admin";
import { selectOutreachTargets, type OutreachCandidate } from "./select-targets";

// Cap invites per run so the first run doesn't blast every existing org at once
// (and to bound the blast radius of any bug); the backfill spreads over days,
// and new registrants are picked up on subsequent runs.
const MAX_PER_RUN = 25;

/**
 * Proactive story outreach: invite new eligible org accounts (one-time) to tell
 * their story. Reusable Outbound-runtime slice — dedupe via mecky_outreach_log,
 * consent via accounts.story_outreach_opt_in, delivery via per-owner notifications.
 * Best-effort per target: one failure never aborts the whole run.
 */
export async function runStoryOutreach(): Promise<{
  candidates: number;
  pending: number; // total eligible not-yet-invited (may exceed this run's cap)
  processed: number; // attempted this run (<= MAX_PER_RUN)
  invited: number;
  failed: number;
}> {
  const admin = createAdminClient();

  const { data: accounts } = await admin
    .from("accounts")
    .select("id, account_type, sub_type, story_outreach_opt_in")
    .eq("account_type", "organisation");
  const candidates = (accounts ?? []) as OutreachCandidate[];

  const { data: log } = await admin
    .from("mecky_outreach_log")
    .select("account_id")
    .eq("type", "story_invite");
  const alreadyInvited = new Set(
    ((log ?? []) as { account_id: string | null }[]).map((r) => r.account_id).filter(Boolean) as string[],
  );

  const allTargets = selectOutreachTargets(candidates, alreadyInvited);
  const targetIds = allTargets.slice(0, MAX_PER_RUN);

  let invited = 0;
  let failed = 0;
  for (const accountId of targetIds) {
    try {
      const { data: owners } = await admin
        .from("account_owners")
        .select("wallet_address, role")
        .eq("account_id", accountId);
      const ownerWallets = ((owners ?? []) as { wallet_address: string; role: string }[])
        .filter((o) => o.role === "owner" || o.role === "admin")
        .map((o) => o.wallet_address.toLowerCase());
      if (ownerWallets.length === 0) continue;

      const rows = ownerWallets.map((w) => ({
        recipient_wallet: w,
        type: "story_invite",
        title: "Erzählt ihr eure Geschichte? 💛",
        body:
          "Ihr seid neu in Röbel — Mecky hilft euch, eure Geschichte zu erzählen und mit der Community zu teilen.",
        metadata: { link: "/dashboard/stories", account_id: accountId },
      }));
      const { error: notifErr } = await admin.from("notifications").insert(rows);
      if (notifErr) throw new Error(notifErr.message);

      // Log once per account (UNIQUE(account_id,type) makes it idempotent).
      const { error: logErr } = await admin.from("mecky_outreach_log").insert({
        account_id: accountId,
        type: "story_invite",
        recipient_wallet: ownerWallets[0],
        result: "sent",
      });
      if (logErr) throw new Error(logErr.message);
      invited++;
    } catch (e) {
      console.error(`[story-outreach] failed for account ${accountId}:`, e);
      failed++;
    }
  }

  return { candidates: candidates.length, pending: allTargets.length, processed: targetIds.length, invited, failed };
}
