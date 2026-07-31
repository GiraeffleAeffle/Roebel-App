"use server";

import { createAdminClient } from "@/lib/supabase/admin";
import { revalidatePath } from "next/cache";
import type { OpeningHours } from "@/types/business";

export async function updateAccountOpeningHours(
  accountId: string,
  hours: OpeningHours,
): Promise<{ success: boolean; error?: string }> {
  // Service-role client: the account-membership lockdown migration drops
  // anon-key INSERT/UPDATE/DELETE policies on `accounts`, so this write must
  // bypass RLS via the service role rather than the anon server client.
  const supabase = createAdminClient();
  const { error } = await supabase
    .from("accounts")
    .update({ opening_hours: hours, updated_at: new Date().toISOString() })
    .eq("id", accountId);

  if (error) {
    console.error("updateAccountOpeningHours error:", error);
    return { success: false, error: "Öffnungszeiten konnten nicht gespeichert werden." };
  }

  revalidatePath("/dashboard/opening-hours");
  revalidatePath(`/app/orgs/${accountId}`);
  return { success: true };
}
