"use server"

import { createClient } from "@/lib/supabase/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { revalidatePath } from "next/cache"
import type { Business, BusinessStatus } from "@/types/business"
import type { OrgSubType, ExternStatus } from "@/types/account"
import { createAppNotification } from "@/app/actions/app-notifications"

export type OrgReviewStatus = "pending" | "published" | "rejected"

export interface OrgRequestRow {
  id: string
  name: string
  sub_type: OrgSubType | null
  is_extern: boolean
  extern_status: ExternStatus | null
  extern_reason: string | null
  is_verified: boolean
  contact_email: string | null
  avatar_url: string | null
  created_at: string
  derived_status: OrgReviewStatus
  business_id: string | null
  business_status: BusinessStatus | null
}

function deriveOrgStatus(row: {
  is_verified: boolean
  extern_status: ExternStatus | null
}): OrgReviewStatus {
  if (row.extern_status === "rejected") return "rejected"
  if (row.is_verified) return "published"
  return "pending"
}

export async function getAdminBusinesses(status?: BusinessStatus) {
  try {
    const supabase = await createClient()
    let query = supabase
      .from("businesses")
      .select("*")
      .order("created_at", { ascending: false })

    if (status) {
      query = query.eq("status", status)
    }

    const { data, error } = await query

    if (error) throw error
    return { success: true, data: data as Business[] }
  } catch (error) {
    console.error("Error fetching admin businesses:", error)
    return { success: false, error: "Fehler beim Laden der Gewerbe" }
  }
}

export async function getAdminBusiness(id: string) {
  try {
    const supabase = await createClient()
    const { data, error } = await supabase
      .from("businesses")
      .select("*")
      .eq("id", id)
      .single()

    if (error) throw error
    return { success: true, data: data as Business }
  } catch (error) {
    console.error("Error fetching business:", error)
    return { success: false, error: "Gewerbe nicht gefunden" }
  }
}

export async function approveBusiness(id: string) {
  try {
    const supabase = await createClient()
    const { data, error } = await supabase
      .from("businesses")
      .update({
        status: "published",
        updated_at: new Date().toISOString(),
      })
      .eq("id", id)
      .select()
      .single()

    if (error) throw error

    await syncBusinessVerification(supabase, data, true)

    // Create activity notification
    createAppNotification({
      type: "business_new",
      title: `Neues Gewerbe: ${data.name}`,
      body: data.description?.substring(0, 120) || null,
      link: `/app/gewerbe/${data.slug}`,
      reference_id: data.id,
      image_url: data.logo_url || null,
    }).catch(console.error)

    revalidatePath("/admin/dashboard/gewerbe")
    revalidatePath(`/admin/dashboard/gewerbe/${id}`)
    revalidatePath("/app/gewerbe")
    return { success: true, data: data as Business, message: "Gewerbe genehmigt" }
  } catch (error) {
    console.error("Error approving business:", error)
    return { success: false, error: "Fehler beim Genehmigen des Gewerbes" }
  }
}

// Mirror approval/rejection state into the new accounts system.
// businesses ↔ accounts have no FK; match by owner wallet + name.
async function syncBusinessVerification(
  supabase: Awaited<ReturnType<typeof createClient>>,
  business: { owner_wallet_address?: string | null; name?: string | null },
  isVerified: boolean
) {
  if (!business.owner_wallet_address || !business.name) return

  const { data: ownerRows } = await supabase
    .from("account_owners")
    .select("account_id, accounts:account_id(id, account_type, name, is_verified)")
    .eq("wallet_address", business.owner_wallet_address.toLowerCase())

  const matchedIds = (ownerRows ?? [])
    .map((r: any) => r.accounts)
    .filter((a: any) => a && a.account_type === "organisation" && a.name === business.name)
    .map((a: any) => a.id)

  if (matchedIds.length === 0) return

  // Service-role client: the account-membership lockdown migration drops
  // anon-key UPDATE policies on `accounts`. The account_owners read above
  // stays on the caller's anon client — only this write needs the swap.
  const admin = createAdminClient()
  await admin
    .from("accounts")
    .update({ is_verified: isVerified, updated_at: new Date().toISOString() })
    .in("id", matchedIds)
}

export async function rejectBusiness(id: string, notes?: string) {
  try {
    const supabase = await createClient()
    const { data, error } = await supabase
      .from("businesses")
      .update({
        status: "rejected",
        admin_notes: notes || null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", id)
      .select()
      .single()

    if (error) throw error

    await syncBusinessVerification(supabase, data, false)

    revalidatePath("/admin/dashboard/gewerbe")
    revalidatePath(`/admin/dashboard/gewerbe/${id}`)
    return { success: true, data: data as Business, message: "Gewerbe abgelehnt" }
  } catch (error) {
    console.error("Error rejecting business:", error)
    return { success: false, error: "Fehler beim Ablehnen des Gewerbes" }
  }
}

export async function updateAdminBusinessLocation(
  id: string,
  data: { latitude: number | null; longitude: number | null }
) {
  try {
    const supabase = await createClient()
    const { data: updated, error } = await supabase
      .from("businesses")
      .update({
        latitude: data.latitude,
        longitude: data.longitude,
        updated_at: new Date().toISOString(),
      })
      .eq("id", id)
      .select()
      .single()

    if (error) throw error

    revalidatePath("/admin/dashboard/gewerbe")
    revalidatePath(`/admin/dashboard/gewerbe/${id}`)
    return { success: true, data: updated as Business, message: "Standort aktualisiert" }
  } catch (error) {
    console.error("Error updating business location:", error)
    return { success: false, error: "Fehler beim Aktualisieren des Standorts" }
  }
}

export async function getPendingBusinessCount() {
  try {
    const supabase = await createClient()
    const { count, error } = await supabase
      .from("businesses")
      .select("*", { count: "exact", head: true })
      .eq("status", "pending")

    if (error) throw error
    return { success: true, count: count || 0 }
  } catch (error) {
    console.error("Error counting pending businesses:", error)
    return { success: false, count: 0 }
  }
}

// ── Account-driven org review (covers every Expo create-org type) ────────

// Match an `accounts` row to a `businesses` row by owner wallet + name,
// same heuristic as syncBusinessVerification (the two tables have no FK).
async function findMatchingBusiness(
  supabase: Awaited<ReturnType<typeof createClient>>,
  accountId: string,
  name: string
): Promise<{ id: string; status: BusinessStatus } | null> {
  const { data: owners } = await supabase
    .from("account_owners")
    .select("wallet_address")
    .eq("account_id", accountId)

  const wallets = (owners ?? [])
    .map((o: { wallet_address: string }) => o.wallet_address?.toLowerCase())
    .filter(Boolean)

  if (wallets.length === 0) return null

  const { data: biz } = await supabase
    .from("businesses")
    .select("id, status")
    .in("owner_wallet_address", wallets)
    .eq("name", name)
    .limit(1)
    .maybeSingle()

  return biz ? { id: biz.id as string, status: biz.status as BusinessStatus } : null
}

export async function getAdminOrgRequests(
  status?: OrgReviewStatus
): Promise<{ success: boolean; data?: OrgRequestRow[]; error?: string }> {
  try {
    const supabase = await createClient()
    const { data, error } = await supabase
      .from("accounts")
      .select(
        "id, name, sub_type, is_extern, extern_status, extern_reason, is_verified, contact_email, avatar_url, created_at"
      )
      .eq("account_type", "organisation")
      .order("created_at", { ascending: false })

    if (error) throw error

    const rows = (data ?? []) as Array<Omit<OrgRequestRow, "derived_status" | "business_id" | "business_status">>

    const enriched: OrgRequestRow[] = await Promise.all(
      rows.map(async (r) => {
        const biz = await findMatchingBusiness(supabase, r.id, r.name)
        return {
          ...r,
          derived_status: deriveOrgStatus(r),
          business_id: biz?.id ?? null,
          business_status: biz?.status ?? null,
        }
      })
    )

    const filtered = status
      ? enriched.filter((r) => r.derived_status === status)
      : enriched

    return { success: true, data: filtered }
  } catch (error) {
    console.error("Error fetching admin org requests:", error)
    return { success: false, error: "Fehler beim Laden der Konto-Anträge" }
  }
}

export async function approveOrgRequest(
  accountId: string,
  reviewerWallet?: string
): Promise<{ success: boolean; data?: OrgRequestRow; error?: string }> {
  try {
    const supabase = await createClient()

    const { data: account, error: fetchErr } = await supabase
      .from("accounts")
      .select(
        "id, name, sub_type, is_extern, extern_status, extern_reason, is_verified, contact_email, avatar_url, created_at"
      )
      .eq("id", accountId)
      .single()

    if (fetchErr || !account) throw fetchErr ?? new Error("Account nicht gefunden")

    const update: Record<string, unknown> = {
      is_verified: true,
      updated_at: new Date().toISOString(),
    }
    if (account.is_extern) {
      update.extern_status = "approved"
      update.extern_reviewed_by = reviewerWallet ?? null
      update.extern_reviewed_at = new Date().toISOString()
    }

    // Service-role client: the account-membership lockdown migration drops
    // anon-key UPDATE policies on `accounts`.
    const admin = createAdminClient()
    const { error: updateErr } = await admin
      .from("accounts")
      .update(update)
      .eq("id", accountId)

    if (updateErr) throw updateErr

    // If a matching businesses row exists (restaurant/unternehmen), publish it
    // so the public /app/gewerbe directory shows the storefront.
    const biz = await findMatchingBusiness(supabase, account.id, account.name)
    if (biz && biz.status !== "published") {
      const { data: updatedBiz } = await supabase
        .from("businesses")
        .update({ status: "published", updated_at: new Date().toISOString() })
        .eq("id", biz.id)
        .select()
        .single()

      if (updatedBiz) {
        createAppNotification({
          type: "business_new",
          title: `Neues Gewerbe: ${updatedBiz.name}`,
          body: updatedBiz.description?.substring(0, 120) || null,
          link: `/app/gewerbe/${updatedBiz.slug}`,
          reference_id: updatedBiz.id,
          image_url: updatedBiz.logo_url || null,
        }).catch(console.error)
      }
    }

    revalidatePath("/admin/dashboard/gewerbe")
    revalidatePath("/admin/dashboard/extern-accounts")
    revalidatePath("/app/gewerbe")

    const refreshed = await findMatchingBusiness(supabase, account.id, account.name)
    const row: OrgRequestRow = {
      ...(account as Omit<OrgRequestRow, "derived_status" | "business_id" | "business_status">),
      is_verified: true,
      extern_status: account.is_extern ? "approved" : account.extern_status,
      derived_status: "published",
      business_id: refreshed?.id ?? null,
      business_status: refreshed?.status ?? null,
    }
    return { success: true, data: row }
  } catch (error) {
    console.error("Error approving org request:", error)
    return { success: false, error: "Fehler beim Freigeben" }
  }
}

export async function rejectOrgRequest(
  accountId: string,
  reviewerWallet?: string,
  notes?: string
): Promise<{ success: boolean; data?: OrgRequestRow; error?: string }> {
  try {
    const supabase = await createClient()

    const { data: account, error: fetchErr } = await supabase
      .from("accounts")
      .select(
        "id, name, sub_type, is_extern, extern_status, extern_reason, is_verified, contact_email, avatar_url, created_at"
      )
      .eq("id", accountId)
      .single()

    if (fetchErr || !account) throw fetchErr ?? new Error("Account nicht gefunden")

    // extern_status is the only review-state column on `accounts` today.
    // Widening it to cover non-extern rejections avoids a schema migration.
    // Service-role client: the account-membership lockdown migration drops
    // anon-key UPDATE policies on `accounts`.
    const admin = createAdminClient()
    const { error: updateErr } = await admin
      .from("accounts")
      .update({
        extern_status: "rejected",
        extern_reason: notes ?? account.extern_reason ?? null,
        extern_reviewed_by: reviewerWallet ?? null,
        extern_reviewed_at: new Date().toISOString(),
        is_verified: false,
        updated_at: new Date().toISOString(),
      })
      .eq("id", accountId)

    if (updateErr) throw updateErr

    const biz = await findMatchingBusiness(supabase, account.id, account.name)
    if (biz) {
      await supabase
        .from("businesses")
        .update({
          status: "rejected",
          admin_notes: notes ?? null,
          updated_at: new Date().toISOString(),
        })
        .eq("id", biz.id)
    }

    revalidatePath("/admin/dashboard/gewerbe")
    revalidatePath("/admin/dashboard/extern-accounts")
    revalidatePath("/app/gewerbe")

    const refreshed = await findMatchingBusiness(supabase, account.id, account.name)
    const row: OrgRequestRow = {
      ...(account as Omit<OrgRequestRow, "derived_status" | "business_id" | "business_status">),
      extern_status: "rejected",
      extern_reason: notes ?? account.extern_reason ?? null,
      is_verified: false,
      derived_status: "rejected",
      business_id: refreshed?.id ?? null,
      business_status: refreshed?.status ?? null,
    }
    return { success: true, data: row }
  } catch (error) {
    console.error("Error rejecting org request:", error)
    return { success: false, error: "Fehler beim Ablehnen" }
  }
}
