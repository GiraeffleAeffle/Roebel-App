"use server"

import { createClient } from "@/lib/supabase/server"
import { revalidatePath } from "next/cache"
import type {
  Business,
  BusinessDeal,
  BusinessCategory,
  OpeningHours,
  CreateBusinessInput,
  UpdateBusinessInput,
  CreateDealInput,
  UpdateDealInput,
} from "@/types/business"
import { createAppNotification } from "@/app/actions/app-notifications"
import { hasSupabase, recordClient } from "@/lib/record"
import {
  getOrgBySlug,
  listDeals,
  listOrgs,
  RecordUnavailableError,
  type OrgRow,
  type DealRow,
} from "@netizen-labs/record-client"

/** businesses-table entries are `OrgRow`s with `is_business` true (see
 * datasets.ts's own doc comment) — this is the join back to the Gewerbe
 * shape the app already renders. `id` reuses the slug (kind 0 carries no
 * Supabase UUID); every field with no on-wire equivalent (phone, email,
 * gallery, moderation state, timestamps, an owning wallet) gets an explicit,
 * never-fabricated neutral. A raw wallet is never rendered — owner_wallet_
 * address is only ever compared for equality (isOwner checks), never shown. */
function toBusiness(o: OrgRow): Business {
  return {
    id: o.slug,
    owner_wallet_address: "",
    name: o.name,
    slug: o.slug,
    description: o.bio,
    category: (o.business_category ?? "sonstiges") as BusinessCategory,
    // businessToSpec (mappers.ts) never publishes contact-person data —
    // phone/email are privacy-guarded, not merely unmapped.
    phone: null,
    email: null,
    website_url: o.website,
    address: o.address,
    latitude: null,
    longitude: null,
    opening_hours: parseOpeningHours(o.opening_hours),
    cover_image_url: o.cover_url,
    logo_url: o.avatar_url,
    // businessToSpec never publishes a gallery — genuinely absent, not
    // merely unmapped.
    gallery_images: [],
    // Only published businesses are ever on the record (businessToSpec's
    // own status gate) — safe to hardcode, not an assumption.
    status: "published",
    admin_notes: null,
    is_featured: false,
    created_at: "",
    updated_at: "",
  }
}

function parseOpeningHours(raw: string | null): OpeningHours {
  if (!raw) return {}
  try {
    return JSON.parse(raw) as OpeningHours
  } catch {
    return {}
  }
}

// ============================================
// Image Upload
// ============================================

export async function uploadBusinessImage(formData: FormData) {
  try {
    const supabase = await createClient()
    const file = formData.get("file") as File
    const type = formData.get("type") as string // "logo" or "cover"

    if (!file || file.size === 0) {
      return { success: false, error: "Keine Datei ausgewählt." }
    }

    const fileExt = file.name.split(".").pop()
    const fileName = `${Date.now()}-${type}-${Math.random().toString(36).substring(2)}.${fileExt}`
    const filePath = `business-images/${fileName}`

    const { error: uploadError } = await supabase.storage
      .from("images")
      .upload(filePath, file, { cacheControl: "3600", upsert: false })

    if (uploadError) {
      console.error("Upload error:", uploadError)
      return { success: false, error: "Fehler beim Hochladen." }
    }

    const { data: urlData } = supabase.storage.from("images").getPublicUrl(filePath)
    return { success: true, url: urlData.publicUrl }
  } catch (error) {
    console.error("Upload error:", error)
    return { success: false, error: "Fehler beim Hochladen." }
  }
}

// ============================================
// Business Actions
// ============================================

export async function getApprovedBusinesses(
  category?: BusinessCategory,
  search?: string
) {
  if (!hasSupabase) {
    try {
      const orgs = await listOrgs(recordClient)
      let businesses = orgs.filter((o) => o.is_business).map(toBusiness)
      if (category) businesses = businesses.filter((b) => b.category === category)
      if (search) {
        const needle = search.toLowerCase()
        businesses = businesses.filter((b) => b.name.toLowerCase().includes(needle))
      }
      businesses.sort((a, b) => a.name.localeCompare(b.name, "de"))
      return { success: true, data: businesses }
    } catch (error) {
      if (error instanceof RecordUnavailableError) return { success: true, data: [] }
      throw error
    }
  }

  try {
    const supabase = await createClient()
    let query = supabase
      .from("businesses")
      .select("*")
      .eq("status", "published")
      .order("is_featured", { ascending: false })
      .order("name", { ascending: true })

    if (category) {
      query = query.eq("category", category)
    }

    if (search) {
      query = query.ilike("name", `%${search}%`)
    }

    const { data, error } = await query

    if (error) throw error
    return { success: true, data: data as Business[] }
  } catch (error) {
    console.error("Error fetching businesses:", error)
    return { success: false, error: "Fehler beim Laden der Gewerbe" }
  }
}

export async function getBusinessBySlug(slug: string) {
  if (!hasSupabase) {
    try {
      const org = await getOrgBySlug(recordClient, slug)
      if (!org || !org.is_business) return { success: false, error: "Gewerbe nicht gefunden" }
      return { success: true, data: toBusiness(org) }
    } catch (error) {
      if (error instanceof RecordUnavailableError) return { success: false, error: "Gewerbe nicht gefunden" }
      throw error
    }
  }

  try {
    const supabase = await createClient()
    const { data, error } = await supabase
      .from("businesses")
      .select("*")
      .eq("slug", slug)
      .single()

    if (error) throw error
    return { success: true, data: data as Business }
  } catch (error) {
    console.error("Error fetching business:", error)
    return { success: false, error: "Gewerbe nicht gefunden" }
  }
}

export async function getBusinessesByOwner(walletAddress: string) {
  try {
    const supabase = await createClient()
    const { data, error } = await supabase
      .from("businesses")
      .select("*")
      .eq("owner_wallet_address", walletAddress.toLowerCase())
      .order("created_at", { ascending: false })

    if (error) throw error
    return { success: true, data: data as Business[] }
  } catch (error) {
    console.error("Error fetching owner businesses:", error)
    return { success: false, error: "Fehler beim Laden der Gewerbe" }
  }
}

export async function createBusiness(input: CreateBusinessInput) {
  try {
    const supabase = await createClient()
    const { data, error } = await supabase
      .from("businesses")
      .insert({
        ...input,
        owner_wallet_address: input.owner_wallet_address.toLowerCase(),
        status: "pending",
      })
      .select()
      .single()

    if (error) throw error

    revalidatePath("/app/gewerbe")
    revalidatePath("/app/profile")
    return { success: true, data: data as Business, message: "Gewerbe eingereicht" }
  } catch (error) {
    console.error("Error creating business:", error)
    return { success: false, error: "Fehler beim Erstellen des Gewerbes" }
  }
}

export async function updateBusiness(input: UpdateBusinessInput) {
  try {
    const { id, ...updateData } = input
    const supabase = await createClient()
    const { data, error } = await supabase
      .from("businesses")
      .update({ ...updateData, updated_at: new Date().toISOString() })
      .eq("id", id)
      .select()
      .single()

    if (error) throw error

    revalidatePath("/app/gewerbe")
    revalidatePath(`/app/gewerbe/${data.slug}`)
    revalidatePath("/app/gewerbe/bearbeiten")
    return { success: true, data: data as Business, message: "Gewerbe aktualisiert" }
  } catch (error) {
    console.error("Error updating business:", error)
    return { success: false, error: "Fehler beim Aktualisieren des Gewerbes" }
  }
}

// ============================================
// Deal Actions
// ============================================

export async function getBusinessDeals(businessId: string) {
  try {
    const supabase = await createClient()
    const { data, error } = await supabase
      .from("business_deals")
      .select("*")
      .eq("business_id", businessId)
      .order("created_at", { ascending: false })

    if (error) throw error
    return { success: true, data: data as BusinessDeal[] }
  } catch (error) {
    console.error("Error fetching deals:", error)
    return { success: false, error: "Fehler beim Laden der Angebote" }
  }
}

const KNOWN_DEAL_TYPES = new Set(["discount", "special", "event", "new_product", "promotion"])

/** listDeals only ever returns deals the index currently serves under an
 * active status (see its own doc comment) — status/is_active are safe to
 * hardcode, not an assumption. business_id is the caller's own slug-as-id
 * (kind 0 carries no Supabase UUID); video_url/boost/view-click counters
 * have no record equivalent. */
function toBusinessDeal(d: DealRow, businessId: string): BusinessDeal {
  return {
    id: d.id,
    business_id: businessId,
    title: d.title,
    description: d.description,
    deal_type: (d.deal_type && KNOWN_DEAL_TYPES.has(d.deal_type) ? d.deal_type : "promotion") as BusinessDeal["deal_type"],
    deal_value: d.deal_value,
    start_date: d.start_date,
    end_date: d.end_date,
    image_url: d.image_url,
    media_urls: Array.from(new Set(d.media_urls)),
    video_url: null,
    status: "active",
    is_active: true,
    is_boosted: false,
    boost_expires_at: null,
    views_count: 0,
    clicks_count: 0,
    created_at: "",
    updated_at: "",
  }
}

export async function getActiveDeals(businessId: string) {
  if (!hasSupabase) {
    try {
      const org = await getOrgBySlug(recordClient, businessId)
      if (!org) return { success: true, data: [] }
      const today = new Date().toISOString().split("T")[0]
      const deals = (await listDeals(recordClient, { limit: 200 }))
        .filter((d) => d.pubkey === org.pubkey)
        .filter((d) => !d.end_date || d.end_date >= today)
        .sort((a, b) => (b.start_date ?? "").localeCompare(a.start_date ?? ""))
        .map((d) => toBusinessDeal(d, businessId))
      return { success: true, data: deals }
    } catch (error) {
      if (error instanceof RecordUnavailableError) return { success: true, data: [] }
      throw error
    }
  }

  try {
    const supabase = await createClient()
    const today = new Date().toISOString().split("T")[0]
    const { data, error } = await supabase
      .from("business_deals")
      .select("*")
      .eq("business_id", businessId)
      .eq("is_active", true)
      .or(`end_date.is.null,end_date.gte.${today}`)
      .order("created_at", { ascending: false })

    if (error) throw error
    return { success: true, data: data as BusinessDeal[] }
  } catch (error) {
    console.error("Error fetching active deals:", error)
    return { success: false, error: "Fehler beim Laden der Angebote" }
  }
}

export async function createDeal(input: CreateDealInput) {
  try {
    const supabase = await createClient()
    const status = input.status || "active"
    const { data, error } = await supabase
      .from("business_deals")
      .insert({
        ...input,
        media_urls: input.media_urls || [],
        video_url: input.video_url || null,
        status,
        image_url: input.media_urls?.[0] || input.image_url || null,
        is_active: status === "active",
      })
      .select()
      .single()

    if (error) throw error

    // Create activity notification
    createAppNotification({
      type: "deal_new",
      title: `Neues Angebot: ${data.title}`,
      body: data.description?.substring(0, 120) || null,
      link: `/app/angebote/${data.id}`,
      reference_id: data.id,
      image_url: data.image_url || null,
    }).catch(console.error)

    revalidatePath("/dashboard/ads")
    return { success: true, data: data as BusinessDeal, message: "Angebot erstellt" }
  } catch (error) {
    console.error("Error creating deal:", error)
    return { success: false, error: "Fehler beim Erstellen des Angebots" }
  }
}

export async function updateDeal(input: UpdateDealInput) {
  try {
    const { id, ...updateData } = input
    // Sync backward-compat fields
    const syncedData: Record<string, unknown> = { ...updateData, updated_at: new Date().toISOString() }
    if (updateData.media_urls !== undefined) {
      syncedData.image_url = updateData.media_urls[0] || null
    }
    if (updateData.status !== undefined) {
      syncedData.is_active = updateData.status === "active"
    }

    const supabase = await createClient()
    const { data, error } = await supabase
      .from("business_deals")
      .update(syncedData)
      .eq("id", id)
      .select()
      .single()

    if (error) throw error

    revalidatePath("/dashboard/ads")
    return { success: true, data: data as BusinessDeal, message: "Angebot aktualisiert" }
  } catch (error) {
    console.error("Error updating deal:", error)
    return { success: false, error: "Fehler beim Aktualisieren des Angebots" }
  }
}

export async function getDealById(dealId: string) {
  try {
    const supabase = await createClient()
    const { data, error } = await supabase
      .from("business_deals")
      .select("*")
      .eq("id", dealId)
      .single()

    if (error) throw error
    return { success: true, data: data as BusinessDeal }
  } catch (error) {
    console.error("Error fetching deal:", error)
    return { success: false, error: "Angebot nicht gefunden" }
  }
}

export async function deleteDeal(id: string) {
  try {
    const supabase = await createClient()
    const { error } = await supabase
      .from("business_deals")
      .delete()
      .eq("id", id)

    if (error) throw error

    revalidatePath("/dashboard/ads")
    return { success: true, message: "Angebot gelöscht" }
  } catch (error) {
    console.error("Error deleting deal:", error)
    return { success: false, error: "Fehler beim Löschen des Angebots" }
  }
}
