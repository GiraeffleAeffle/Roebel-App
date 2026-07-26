import { createAdminClient } from "@/lib/supabase/admin";
import { selectFoerderTargets, type FoerderCandidate } from "./select-foerder-targets";

// Cap invites per run so the first run doesn't blast every existing org at once
// (and to bound the blast radius of any bug); the backfill spreads over days,
// and new registrants are picked up on subsequent runs.
const MAX_PER_RUN = 25;

/**
 * Proactive Fördermittel outreach: invite eligible org accounts (one-time) to
 * run a funding check on the dashboard. Trigger 1 from the Fördermittel Agent
 * spec ("I think there's funding for you"). Reuses the Outbound runtime:
 * dedupe via mecky_outreach_log (type='foerder_match'), consent via
 * accounts.foerder_outreach_opt_in, delivery via per-owner notifications
 * (CTA deep-links to /dashboard/foerdermittel via metadata.link).
 * Best-effort per target: one failure never aborts the whole run.
 */
export async function runFoerderOutreach(): Promise<{
  candidates: number;
  pending: number; // total eligible not-yet-invited (may exceed this run's cap)
  processed: number; // attempted this run (<= MAX_PER_RUN)
  invited: number;
  failed: number;
}> {
  const admin = createAdminClient();

  const { data: accounts, error: accErr } = await admin
    .from("accounts")
    .select("id, account_type, sub_type, foerder_outreach_opt_in")
    .eq("account_type", "organisation");
  if (accErr) console.error("[foerder-outreach] accounts query failed:", accErr.message);
  const candidates = (accounts ?? []) as FoerderCandidate[];

  const { data: log, error: logQErr } = await admin
    .from("mecky_outreach_log")
    .select("account_id")
    .eq("type", "foerder_match");
  if (logQErr) console.error("[foerder-outreach] outreach-log query failed:", logQErr.message);
  const alreadyInvited = new Set(
    ((log ?? []) as { account_id: string | null }[]).map((r) => r.account_id).filter(Boolean) as string[],
  );

  const allTargets = selectFoerderTargets(candidates, alreadyInvited);
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
        type: "foerder_invite",
        title: "Fördermittel für euch? 💶",
        body:
          "Mecky glaubt, es gibt passende Fördermittel für euch. Macht in 5 Minuten den Förder-Check in eurem Dashboard.",
        metadata: { link: "/dashboard/foerdermittel", account_id: accountId },
      }));
      const { error: notifErr } = await admin.from("notifications").insert(rows);
      if (notifErr) throw new Error(notifErr.message);

      // Log once per account (UNIQUE(account_id,type) makes it idempotent).
      const { error: logErr } = await admin.from("mecky_outreach_log").insert({
        account_id: accountId,
        type: "foerder_match",
        recipient_wallet: ownerWallets[0],
        result: "sent",
      });
      if (logErr) throw new Error(logErr.message);
      invited++;
    } catch (e) {
      console.error(`[foerder-outreach] failed for account ${accountId}:`, e);
      failed++;
    }
  }

  return { candidates: candidates.length, pending: allTargets.length, processed: targetIds.length, invited, failed };
}
