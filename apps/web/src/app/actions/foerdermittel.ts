"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { createMatchSources } from "@/lib/foerdermittel/sources";
import { runFundingMatch } from "@/lib/foerdermittel/run-match";
import { generateFitWithClaude } from "@/lib/foerdermittel/fit-generator";
import { computeCompleteness, type ProfileFormInput } from "@/lib/foerdermittel/profile";
import type {
  RankedMatch,
  OrgFundingProfile,
  FundingMatchView,
  FundingLevel,
  ProbabilityBand,
  MatchStatus,
} from "@/types/foerdermittel";

/**
 * Owner/admin guard for a funding action. Mirrors `assertCanWrite` in
 * actions/blog.ts (anon server client — `account_owners` is open-RLS + app-layer
 * enforced). The funding tables themselves are read/written with the admin
 * client AFTER this gate, because they are owner-scoped RLS with no Supabase
 * auth session behind the thirdweb wallet.
 */
async function assertOwner(
  accountId: string,
  walletAddress: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!accountId || !walletAddress) {
    return { ok: false, error: "Pflichtangaben fehlen" };
  }
  const supabase = await createClient();
  const { data: owner, error } = await supabase
    .from("account_owners")
    .select("role")
    .eq("account_id", accountId)
    .eq("wallet_address", walletAddress.toLowerCase())
    .maybeSingle();
  if (error || !owner) {
    return { ok: false, error: "Keine Berechtigung für diese Organisation" };
  }
  if (owner.role !== "owner" && owner.role !== "admin") {
    return { ok: false, error: "Nur Inhaber:innen oder Admins dürfen das Förderprofil bearbeiten" };
  }
  return { ok: true };
}

/** Read the org's funding profile (null if none yet). Owner-gated. */
export async function getFundingProfile(
  accountId: string,
  walletAddress: string,
): Promise<{ success: boolean; error?: string; profile?: OrgFundingProfile | null }> {
  const guard = await assertOwner(accountId, walletAddress);
  if (!guard.ok) return { success: false, error: guard.error };
  try {
    const admin = createAdminClient();
    const { data, error } = await admin
      .from("org_funding_profiles")
      .select("*")
      .eq("account_id", accountId)
      .maybeSingle();
    if (error) {
      console.error("getFundingProfile failed", error);
      return { success: false, error: "Förderprofil konnte nicht geladen werden." };
    }
    return { success: true, profile: (data as OrgFundingProfile) ?? null };
  } catch (error) {
    console.error("getFundingProfile threw", error);
    return { success: false, error: "Förderprofil konnte nicht geladen werden." };
  }
}

/** Create/update the org's funding profile. Owner-gated; recomputes completeness. */
export async function saveFundingProfile(
  accountId: string,
  walletAddress: string,
  input: ProfileFormInput,
): Promise<{ success: boolean; error?: string; profile?: OrgFundingProfile }> {
  const guard = await assertOwner(accountId, walletAddress);
  if (!guard.ok) return { success: false, error: guard.error };
  try {
    const admin = createAdminClient();
    const completeness = computeCompleteness(input);
    const row = {
      account_id: accountId,
      legal_form: input.legal_form,
      is_gemeinnuetzig: input.is_gemeinnuetzig,
      founded_year: input.founded_year,
      member_count: input.member_count,
      budget_band: input.budget_band,
      sector_tags: input.sector_tags ?? [],
      project_needs: input.project_needs ?? "",
      goals: input.goals ?? "",
      region: input.region,
      profile_completeness: completeness,
      last_interviewed_at: new Date().toISOString(),
    };
    const { data, error } = await admin
      .from("org_funding_profiles")
      .upsert(row, { onConflict: "account_id" })
      .select("*")
      .single();
    if (error || !data) {
      console.error("saveFundingProfile failed", error);
      return { success: false, error: "Förderprofil konnte nicht gespeichert werden." };
    }
    revalidatePath("/dashboard/foerdermittel");
    return { success: true, profile: data as OrgFundingProfile };
  } catch (error) {
    console.error("saveFundingProfile threw", error);
    return { success: false, error: "Förderprofil konnte nicht gespeichert werden." };
  }
}

/** Read the persisted ranked matches (joined with their programs). Owner-gated. */
export async function getFundingMatches(
  accountId: string,
  walletAddress: string,
): Promise<{ success: boolean; error?: string; matches?: FundingMatchView[] }> {
  const guard = await assertOwner(accountId, walletAddress);
  if (!guard.ok) return { success: false, error: guard.error };
  try {
    const admin = createAdminClient();
    const { data, error } = await admin
      .from("org_funding_matches")
      .select(
        "id, program_id, score, probability_band, rationale, requirements, red_flags, collapsed, status, created_at, program:funding_programs(name, provider, level, source_url, deadline, amount_min, amount_max)",
      )
      .eq("account_id", accountId)
      .neq("status", "dismissed")
      .order("score", { ascending: false });
    if (error) {
      console.error("getFundingMatches failed", error);
      return { success: false, error: "Förderergebnisse konnten nicht geladen werden." };
    }
    const matches: FundingMatchView[] = (data ?? []).map((r) => {
      const row = r as Record<string, unknown>;
      const p = (row.program ?? {}) as Record<string, unknown>;
      return {
        id: String(row.id),
        program_id: String(row.program_id),
        program_name: (p.name as string) ?? "Förderprogramm",
        provider: (p.provider as string) ?? "",
        level: (p.level as FundingLevel) ?? "sonstiges",
        source_url: (p.source_url as string) ?? "",
        deadline: (p.deadline as string) ?? null,
        amount_min: (p.amount_min as number) ?? null,
        amount_max: (p.amount_max as number) ?? null,
        score: Number(row.score ?? 0),
        probability_band: (row.probability_band as ProbabilityBand) ?? "niedrig",
        rationale: (row.rationale as string) ?? "",
        requirements: (row.requirements as string) ?? "",
        red_flags: (row.red_flags as string) ?? "",
        collapsed: Boolean(row.collapsed),
        status: (row.status as MatchStatus) ?? "new",
        created_at: String(row.created_at ?? ""),
      };
    });
    return { success: true, matches };
  } catch (error) {
    console.error("getFundingMatches threw", error);
    return { success: false, error: "Förderergebnisse konnten nicht geladen werden." };
  }
}

const ALLOWED_MATCH_STATUS: MatchStatus[] = ["new", "seen", "saved", "dismissed", "applying"];

/** Update a match's status (save / dismiss / request-help). Owner-gated + scoped to the account. */
export async function updateFundingMatchStatus(
  accountId: string,
  walletAddress: string,
  matchId: string,
  status: MatchStatus,
): Promise<{ success: boolean; error?: string }> {
  const guard = await assertOwner(accountId, walletAddress);
  if (!guard.ok) return { success: false, error: guard.error };
  if (!ALLOWED_MATCH_STATUS.includes(status)) {
    return { success: false, error: "Ungültiger Status" };
  }
  try {
    const admin = createAdminClient();
    // Scope the update to this account so an owner can never touch another org's match.
    const { error } = await admin
      .from("org_funding_matches")
      .update({ status })
      .eq("id", matchId)
      .eq("account_id", accountId);
    if (error) {
      console.error("updateFundingMatchStatus failed", error);
      return { success: false, error: "Status konnte nicht gespeichert werden." };
    }
    revalidatePath("/dashboard/foerdermittel");
    return { success: true };
  } catch (error) {
    console.error("updateFundingMatchStatus threw", error);
    return { success: false, error: "Status konnte nicht gespeichert werden." };
  }
}

/** Read the org's proactive-outreach opt-in flag. Owner-gated. */
export async function getFoerderOutreachOptIn(
  accountId: string,
  walletAddress: string,
): Promise<{ success: boolean; error?: string; optIn?: boolean }> {
  const guard = await assertOwner(accountId, walletAddress);
  if (!guard.ok) return { success: false, error: guard.error };
  try {
    const admin = createAdminClient();
    const { data, error } = await admin
      .from("accounts")
      .select("foerder_outreach_opt_in")
      .eq("id", accountId)
      .maybeSingle();
    if (error) {
      console.error("getFoerderOutreachOptIn failed", error);
      return { success: false, error: "Einstellung konnte nicht geladen werden." };
    }
    // Default to opted-in (matches the DB default for org accounts).
    return { success: true, optIn: data?.foerder_outreach_opt_in !== false };
  } catch (error) {
    console.error("getFoerderOutreachOptIn threw", error);
    return { success: false, error: "Einstellung konnte nicht geladen werden." };
  }
}

/** Toggle the org's proactive-outreach opt-in. Owner-gated. */
export async function setFoerderOutreachOptIn(
  accountId: string,
  walletAddress: string,
  optIn: boolean,
): Promise<{ success: boolean; error?: string }> {
  const guard = await assertOwner(accountId, walletAddress);
  if (!guard.ok) return { success: false, error: guard.error };
  try {
    const admin = createAdminClient();
    const { error } = await admin
      .from("accounts")
      .update({ foerder_outreach_opt_in: optIn })
      .eq("id", accountId);
    if (error) {
      console.error("setFoerderOutreachOptIn failed", error);
      return { success: false, error: "Einstellung konnte nicht gespeichert werden." };
    }
    return { success: true };
  } catch (error) {
    console.error("setFoerderOutreachOptIn threw", error);
    return { success: false, error: "Einstellung konnte nicht gespeichert werden." };
  }
}

export async function runFundingMatchAction(
  accountId: string,
  walletAddress: string,
): Promise<{ success: boolean; error?: string; matches?: RankedMatch[] }> {
  try {
    const guard = await assertOwner(accountId, walletAddress);
    if (!guard.ok) return { success: false, error: guard.error };

    const result = await runFundingMatch(accountId, {
      ...createMatchSources(),
      generateFit: generateFitWithClaude,
    });
    if (!result.ok) {
      const error = result.reason === "no_profile"
        ? "Bitte zuerst das Förderprofil ausfüllen."
        : "Das Förderprofil ist noch zu unvollständig für einen Abgleich.";
      return { success: false, error };
    }
    revalidatePath("/dashboard/foerdermittel");
    return { success: true, matches: result.matches };
  } catch (error) {
    console.error("runFundingMatchAction failed", error);
    return { success: false, error: "Der Förderabgleich ist fehlgeschlagen." };
  }
}
