"use server";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { revalidatePath } from "next/cache";
import { resend, EMAIL_CONFIG } from "@/lib/resend";

/**
 * Admin-side approval queue for org accounts requested by extern (non-resident)
 * users. Extern users connect with a thirdweb wallet and submit an org-account
 * request via /app/org/create — same wallet-gated pattern as the existing
 * business registration flow. This file only handles admin approve/reject.
 */

export async function approveExtern(
  accountId: string,
  reviewerWallet: string
): Promise<{ success: boolean; error?: string }> {
  const supabase = await createClient();
  const { data: account } = await supabase
    .from("accounts")
    .select("contact_email, name")
    .eq("id", accountId)
    .maybeSingle();

  // Service-role client: the account-membership lockdown migration drops
  // anon-key UPDATE policies on `accounts`.
  const admin = createAdminClient();
  const { error } = await admin
    .from("accounts")
    .update({
      extern_status: "approved",
      extern_reviewed_by: reviewerWallet,
      extern_reviewed_at: new Date().toISOString(),
      is_verified: true,
    })
    .eq("id", accountId);

  if (error) {
    console.error("approveExtern error:", error);
    return { success: false, error: "Fehler beim Freigeben" };
  }

  if (resend && account?.contact_email) {
    try {
      await resend.emails.send({
        from: EMAIL_CONFIG.from,
        to: account.contact_email,
        subject: "Konto freigegeben — Röbel App",
        text: `Hallo,\n\ndein externes Organisationskonto („${account.name}") wurde freigegeben. Du kannst jetzt Artikel veröffentlichen und das Dashboard nutzen.\n\nViele Grüße\nRöbel App`,
      });
    } catch (e) {
      console.error("approveExtern email error:", e);
    }
  }

  revalidatePath("/admin/dashboard/extern-accounts");
  revalidatePath("/dashboard");
  return { success: true };
}

export async function rejectExtern(
  accountId: string,
  reviewerWallet: string,
  reason?: string
): Promise<{ success: boolean; error?: string }> {
  const supabase = await createClient();
  const { data: account } = await supabase
    .from("accounts")
    .select("contact_email, name")
    .eq("id", accountId)
    .maybeSingle();

  // Service-role client: the account-membership lockdown migration drops
  // anon-key UPDATE policies on `accounts`.
  const admin = createAdminClient();
  const { error } = await admin
    .from("accounts")
    .update({
      extern_status: "rejected",
      extern_reviewed_by: reviewerWallet,
      extern_reviewed_at: new Date().toISOString(),
      extern_reason: reason ?? null,
    })
    .eq("id", accountId);

  if (error) {
    console.error("rejectExtern error:", error);
    return { success: false, error: "Fehler beim Ablehnen" };
  }

  if (resend && account?.contact_email) {
    try {
      await resend.emails.send({
        from: EMAIL_CONFIG.from,
        to: account.contact_email,
        subject: "Antrag abgelehnt — Röbel App",
        text: `Hallo,\n\ndein Antrag für ein externes Organisationskonto („${account.name}") wurde leider abgelehnt.${reason ? `\n\nGrund: ${reason}` : ""}\n\nViele Grüße\nRöbel App`,
      });
    } catch (e) {
      console.error("rejectExtern email error:", e);
    }
  }

  revalidatePath("/admin/dashboard/extern-accounts");
  return { success: true };
}

export async function listPendingExternAccounts() {
  const supabase = await createClient();
  const { data } = await supabase
    .from("accounts")
    .select(
      "id, name, sub_type, contact_email, extern_reason, extern_status, created_at"
    )
    .eq("is_extern", true)
    .order("created_at", { ascending: false });
  return data || [];
}
