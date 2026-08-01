"use server"

import { createClient } from "@/lib/supabase/server"
import { revalidatePath } from "next/cache"
import type {
  MarketplaceListing,
  ListingWithSeller,
  CreateListingInput,
  UpdateListingInput,
  MarketplaceCategory,
  ServiceCategory,
  BoardCategory,
  ListingCondition,
  ListingStatus,
  ListingType,
} from "@/types/marketplace"
import { createAppNotification } from "@/app/actions/app-notifications"
import { hasSupabase, recordClient } from "@/lib/record"
import { listListings, RecordUnavailableError, type ListingRow } from "@netizen-labs/record-client"

/**
 * Record mode: no `users` table to join a seller profile from, no wallet
 * address to key by (seller_npub is a Nostr identity, not a wallet — a
 * different identity system, and a raw address is never rendered anyway).
 * price_type/views_count have no record equivalent — listingToSpec never
 * publishes price_type, and view counts are a Supabase-only interaction
 * metric. "fixed" is the most common real price_type and, unlike
 * "negotiable"/"free", never changes how the numeric price itself reads.
 */
function toListingWithSeller(l: ListingRow): ListingWithSeller {
  return {
    id: l.id,
    seller_wallet_address: "",
    listing_type: (l.listing_type === "service" || l.listing_type === "schwarzes_brett" ? l.listing_type : "product"),
    title: l.title,
    description: l.description,
    price: l.price !== null && Number.isFinite(Number(l.price)) ? Number(l.price) : 0,
    price_type: "fixed",
    category: (l.category ?? "sonstiges") as ListingWithSeller["category"],
    condition: l.condition as ListingCondition | null,
    neighborhood: l.location,
    media_urls: l.media_urls,
    status: "active",
    views_count: 0,
    created_at: l.created_at,
    updated_at: l.created_at,
    // ListingCard and the detail page both render an icon next to
    // `seller_username || formatWalletAddress(seller_wallet_address)`
    // UNCONDITIONALLY — with both "" (formatWalletAddress("") also returns
    // "" per its own short-address guard), that reads as a bare icon next
    // to empty text on every card. A generic, honest label ("no real name
    // to show, this is a seller") avoids the dead-looking control without
    // fabricating an identity.
    seller_username: "Anbieter",
    seller_profile_picture_url: null,
    seller_neighborhood: null,
  }
}

// ============================================
// Read operations
// ============================================

export async function getActiveListings(
  category?: MarketplaceCategory | ServiceCategory | BoardCategory,
  condition?: ListingCondition,
  search?: string,
  limit = 50,
  listingType?: ListingType
): Promise<{ success: boolean; data?: ListingWithSeller[]; error?: string }> {
  if (!hasSupabase) {
    try {
      const rows = await listListings(recordClient, { limit: 200 })
      let listings = rows.map(toListingWithSeller)
      if (listingType) listings = listings.filter((l) => l.listing_type === listingType)
      if (category) listings = listings.filter((l) => l.category === category)
      if (condition && listingType !== "service" && listingType !== "schwarzes_brett") {
        listings = listings.filter((l) => l.condition === condition)
      }
      if (search) {
        const needle = search.toLowerCase()
        listings = listings.filter(
          (l) =>
            l.title.toLowerCase().includes(needle) ||
            (l.description ?? "").toLowerCase().includes(needle)
        )
      }
      // listListings gives no ordering guarantee — sort desc by the
      // recovered created_at to match the Supabase branch's own ordering.
      listings.sort((a, b) => b.created_at.localeCompare(a.created_at))
      return { success: true, data: listings.slice(0, limit) }
    } catch (error) {
      if (error instanceof RecordUnavailableError) return { success: true, data: [] }
      throw error
    }
  }

  try {
    const supabase = await createClient()

    let query = supabase
      .from("marketplace_listings")
      .select("*")
      .eq("status", "active")
      .order("created_at", { ascending: false })
      .limit(limit)

    if (listingType) {
      query = query.eq("listing_type", listingType)
    }

    if (category) {
      query = query.eq("category", category)
    }

    if (condition && listingType !== "service" && listingType !== "schwarzes_brett") {
      query = query.eq("condition", condition)
    }

    if (search) {
      query = query.or(`title.ilike.%${search}%,description.ilike.%${search}%`)
    }

    const { data, error } = await query

    if (error) throw error

    // Fetch seller info separately (no FK constraint needed)
    const addresses = [...new Set((data || []).map((r: Record<string, unknown>) => r.seller_wallet_address as string))]
    const sellerMap = new Map<string, Record<string, unknown>>()

    if (addresses.length > 0) {
      const { data: sellers } = await supabase
        .from("users")
        .select("wallet_address, username, profile_picture_url, neighborhood")
        .in("wallet_address", addresses)

      for (const s of sellers || []) {
        sellerMap.set(s.wallet_address as string, s as Record<string, unknown>)
      }
    }

    const listings: ListingWithSeller[] = (data || []).map((row: Record<string, unknown>) => {
      const seller = sellerMap.get(row.seller_wallet_address as string) || null
      return {
        id: row.id as string,
        seller_wallet_address: row.seller_wallet_address as string,
        listing_type: (row.listing_type as ListingType) || "product",
        title: row.title as string,
        description: row.description as string | null,
        price: Number(row.price) || 0,
        price_type: row.price_type as ListingWithSeller["price_type"],
        category: row.category as ListingWithSeller["category"],
        condition: (row.condition as ListingWithSeller["condition"]) || null,
        neighborhood: row.neighborhood as string | null,
        media_urls: (row.media_urls as string[]) || [],
        status: row.status as ListingWithSeller["status"],
        views_count: (row.views_count as number) || 0,
        created_at: row.created_at as string,
        updated_at: row.updated_at as string,
        seller_username: (seller?.username as string | null) || null,
        seller_profile_picture_url: (seller?.profile_picture_url as string | null) || null,
        seller_neighborhood: (seller?.neighborhood as string | null) || null,
      }
    })

    return { success: true, data: listings }
  } catch (error) {
    console.error("Error fetching marketplace listings:", error)
    return { success: false, error: "Fehler beim Laden der Inserate" }
  }
}

export async function getListingById(
  id: string
): Promise<{ success: boolean; data?: ListingWithSeller; error?: string }> {
  if (!hasSupabase) {
    try {
      // listListings already filters to active/non-withdrawn rows — a
      // separate detail-lookup dataset function does not exist, so the
      // brief's own guidance ("find by id in the list result") applies.
      const rows = await listListings(recordClient, { limit: 200 })
      const row = rows.find((l) => l.id === id)
      if (!row) return { success: false, error: "Inserat nicht gefunden" }
      return { success: true, data: toListingWithSeller(row) }
    } catch (error) {
      if (error instanceof RecordUnavailableError) return { success: false, error: "Inserat nicht gefunden" }
      throw error
    }
  }

  try {
    const supabase = await createClient()

    const { data, error } = await supabase
      .from("marketplace_listings")
      .select("*")
      .eq("id", id)
      .neq("status", "deleted")
      .single()

    if (error) throw error

    // Fetch seller info separately
    const { data: seller } = await supabase
      .from("users")
      .select("username, profile_picture_url, neighborhood")
      .eq("wallet_address", data.seller_wallet_address)
      .maybeSingle()

    const listing: ListingWithSeller = {
      id: data.id,
      seller_wallet_address: data.seller_wallet_address,
      listing_type: data.listing_type || "product",
      title: data.title,
      description: data.description,
      price: Number(data.price) || 0,
      price_type: data.price_type,
      category: data.category,
      condition: data.condition || null,
      neighborhood: data.neighborhood,
      media_urls: data.media_urls || [],
      status: data.status,
      views_count: data.views_count || 0,
      created_at: data.created_at,
      updated_at: data.updated_at,
      seller_username: (seller?.username as string | null) || null,
      seller_profile_picture_url: (seller?.profile_picture_url as string | null) || null,
      seller_neighborhood: (seller?.neighborhood as string | null) || null,
    }

    return { success: true, data: listing }
  } catch (error) {
    console.error("Error fetching listing:", error)
    return { success: false, error: "Inserat nicht gefunden" }
  }
}

export async function getListingsBySeller(
  walletAddress: string
): Promise<{ success: boolean; data?: MarketplaceListing[]; error?: string }> {
  try {
    const supabase = await createClient()

    const { data, error } = await supabase
      .from("marketplace_listings")
      .select("*")
      .eq("seller_wallet_address", walletAddress.toLowerCase())
      .neq("status", "deleted")
      .order("created_at", { ascending: false })

    if (error) throw error

    const listings: MarketplaceListing[] = (data || []).map((row: Record<string, unknown>) => ({
      id: row.id as string,
      seller_wallet_address: row.seller_wallet_address as string,
      listing_type: (row.listing_type as ListingType) || "product",
      title: row.title as string,
      description: row.description as string | null,
      price: Number(row.price) || 0,
      price_type: row.price_type as MarketplaceListing["price_type"],
      category: row.category as MarketplaceListing["category"],
      condition: (row.condition as MarketplaceListing["condition"]) || null,
      neighborhood: row.neighborhood as string | null,
      media_urls: (row.media_urls as string[]) || [],
      status: row.status as MarketplaceListing["status"],
      views_count: (row.views_count as number) || 0,
      created_at: row.created_at as string,
      updated_at: row.updated_at as string,
    }))

    return { success: true, data: listings }
  } catch (error) {
    console.error("Error fetching seller listings:", error)
    return { success: false, error: "Fehler beim Laden der Inserate" }
  }
}

// ============================================
// Write operations
// ============================================

export async function createListing(
  input: CreateListingInput
): Promise<{ success: boolean; data?: MarketplaceListing; error?: string }> {
  try {
    const supabase = await createClient()

    const { data, error } = await supabase
      .from("marketplace_listings")
      .insert([
        {
          seller_wallet_address: input.seller_wallet_address.toLowerCase(),
          account_id: input.account_id ?? null,
          listing_type: input.listing_type || "product",
          title: input.title,
          description: input.description || null,
          price: input.price,
          price_type: input.price_type,
          category: input.category,
          condition: input.condition || null,
          neighborhood: input.neighborhood || null,
          media_urls: input.media_urls || [],
        },
      ])
      .select()
      .single()

    if (error) throw error

    // Create activity notification
    createAppNotification({
      type: "listing_new",
      title: input.listing_type === "schwarzes_brett"
        ? `Neuer Aushang: ${input.title}`
        : input.listing_type === "service"
          ? `Neue Dienstleistung: ${input.title}`
          : `Neues Inserat: ${input.title}`,
      body: input.description?.substring(0, 120) || null,
      link: `/app/marktplatz/${data.id}`,
      reference_id: data.id,
      image_url: input.media_urls?.[0] || null,
    }).catch(console.error)

    revalidatePath("/app/marktplatz")

    return { success: true, data: data as MarketplaceListing }
  } catch (error) {
    console.error("Error creating listing:", error)
    return { success: false, error: "Fehler beim Erstellen des Inserats" }
  }
}

export async function updateListing(
  input: UpdateListingInput,
  walletAddress: string
): Promise<{ success: boolean; data?: MarketplaceListing; error?: string }> {
  try {
    const supabase = await createClient()

    // Verify ownership
    const { data: existing } = await supabase
      .from("marketplace_listings")
      .select("seller_wallet_address")
      .eq("id", input.id)
      .single()

    if (!existing || existing.seller_wallet_address !== walletAddress.toLowerCase()) {
      return { success: false, error: "Nicht autorisiert" }
    }

    const updateData: Record<string, unknown> = { updated_at: new Date().toISOString() }
    if (input.title !== undefined) updateData.title = input.title
    if (input.description !== undefined) updateData.description = input.description || null
    if (input.price !== undefined) updateData.price = input.price
    if (input.price_type !== undefined) updateData.price_type = input.price_type
    if (input.category !== undefined) updateData.category = input.category
    if (input.condition !== undefined) updateData.condition = input.condition
    if (input.neighborhood !== undefined) updateData.neighborhood = input.neighborhood || null
    if (input.media_urls !== undefined) updateData.media_urls = input.media_urls
    if (input.status !== undefined) updateData.status = input.status

    const { data, error } = await supabase
      .from("marketplace_listings")
      .update(updateData)
      .eq("id", input.id)
      .select()
      .single()

    if (error) throw error

    revalidatePath("/app/marktplatz")
    revalidatePath(`/app/marktplatz/${input.id}`)

    return { success: true, data: data as MarketplaceListing }
  } catch (error) {
    console.error("Error updating listing:", error)
    return { success: false, error: "Fehler beim Aktualisieren des Inserats" }
  }
}

export async function deleteListing(
  id: string,
  walletAddress: string
): Promise<{ success: boolean; error?: string }> {
  try {
    const supabase = await createClient()

    // Verify ownership
    const { data: existing } = await supabase
      .from("marketplace_listings")
      .select("seller_wallet_address")
      .eq("id", id)
      .single()

    if (!existing || existing.seller_wallet_address !== walletAddress.toLowerCase()) {
      return { success: false, error: "Nicht autorisiert" }
    }

    const { error } = await supabase
      .from("marketplace_listings")
      .update({ status: "deleted", updated_at: new Date().toISOString() })
      .eq("id", id)

    if (error) throw error

    revalidatePath("/app/marktplatz")

    return { success: true }
  } catch (error) {
    console.error("Error deleting listing:", error)
    return { success: false, error: "Fehler beim Löschen des Inserats" }
  }
}

export async function updateListingStatus(
  id: string,
  walletAddress: string,
  status: ListingStatus
): Promise<{ success: boolean; data?: MarketplaceListing; error?: string }> {
  try {
    const supabase = await createClient()

    // Verify ownership
    const { data: existing } = await supabase
      .from("marketplace_listings")
      .select("seller_wallet_address")
      .eq("id", id)
      .single()

    if (!existing || existing.seller_wallet_address !== walletAddress.toLowerCase()) {
      return { success: false, error: "Nicht autorisiert" }
    }

    const { data, error } = await supabase
      .from("marketplace_listings")
      .update({ status, updated_at: new Date().toISOString() })
      .eq("id", id)
      .select()
      .single()

    if (error) throw error

    revalidatePath("/app/marktplatz")
    revalidatePath(`/app/marktplatz/${id}`)

    return { success: true, data: data as MarketplaceListing }
  } catch (error) {
    console.error("Error updating listing status:", error)
    return { success: false, error: "Fehler beim Aktualisieren des Status" }
  }
}

// ============================================
// Analytics
// ============================================

export async function trackListingView(listingId: string) {
  try {
    const supabase = await createClient()
    await supabase.rpc("increment_listing_views", { listing_id: listingId })
  } catch {
    // Fire-and-forget
  }
}
