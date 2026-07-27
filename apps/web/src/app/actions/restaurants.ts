"use server"

import { createClient } from "@/lib/supabase/server"
import { revalidatePath } from "next/cache"
import type {
  Restaurant,
  CreateRestaurantInput,
  UpdateRestaurantInput,
  MenuCategory,
  CreateMenuCategoryInput,
  UpdateMenuCategoryInput,
  MenuItem,
  CreateMenuItemInput,
  UpdateMenuItemInput,
  SpecialMenu,
  CreateSpecialMenuInput,
  UpdateSpecialMenuInput,
  SpecialMenuCategory,
  CreateSpecialMenuCategoryInput,
  UpdateSpecialMenuCategoryInput,
  SpecialMenuItem,
  CreateSpecialMenuItemInput,
  UpdateSpecialMenuItemInput,
  AiImageStyle,
  AiImageModel,
} from "@/types/restaurant"
import { generateSlug } from "@/types/restaurant"

// ============================================
// Restaurant Actions
// ============================================

export async function getRestaurants() {
  try {
    const supabase = await createClient()
    const { data, error } = await supabase
      .from("restaurants")
      .select("*")
      .order("sort_order", { ascending: true })
      .order("created_at", { ascending: false })

    if (error) throw error
    return { success: true, data: data as Restaurant[] }
  } catch (error) {
    console.error("Error fetching restaurants:", error)
    return { success: false, error: "Fehler beim Laden der Restaurants" }
  }
}

export async function getRestaurant(id: string) {
  try {
    const supabase = await createClient()
    const { data, error } = await supabase
      .from("restaurants")
      .select("*")
      .eq("id", id)
      .single()

    if (error) throw error
    return { success: true, data: data as Restaurant }
  } catch (error) {
    console.error("Error fetching restaurant:", error)
    return { success: false, error: "Restaurant nicht gefunden" }
  }
}

export async function createRestaurant(input: CreateRestaurantInput) {
  try {
    const supabase = await createClient()
    const { data, error } = await supabase
      .from("restaurants")
      .insert(input)
      .select()
      .single()

    if (error) throw error

    revalidatePath("/admin/dashboard/speisekarten")
    return { success: true, data: data as Restaurant, message: "Restaurant erstellt" }
  } catch (error) {
    console.error("Error creating restaurant:", error)
    return { success: false, error: "Fehler beim Erstellen des Restaurants" }
  }
}

export async function updateRestaurant(input: UpdateRestaurantInput) {
  try {
    const { id, ...updateData } = input
    const supabase = await createClient()
    const { data, error } = await supabase
      .from("restaurants")
      .update({ ...updateData, updated_at: new Date().toISOString() })
      .eq("id", id)
      .select()
      .single()

    if (error) throw error

    revalidatePath("/admin/dashboard/speisekarten")
    revalidatePath(`/admin/dashboard/speisekarten/${id}`)
    return { success: true, data: data as Restaurant, message: "Restaurant aktualisiert" }
  } catch (error) {
    console.error("Error updating restaurant:", error)
    return { success: false, error: "Fehler beim Aktualisieren des Restaurants" }
  }
}

export async function deleteRestaurant(id: string) {
  try {
    const supabase = await createClient()
    const { error } = await supabase
      .from("restaurants")
      .delete()
      .eq("id", id)

    if (error) throw error

    revalidatePath("/admin/dashboard/speisekarten")
    return { success: true, message: "Restaurant gelöscht" }
  } catch (error) {
    console.error("Error deleting restaurant:", error)
    return { success: false, error: "Fehler beim Löschen des Restaurants" }
  }
}

export async function toggleRestaurantFeatured(id: string, is_featured: boolean) {
  try {
    const supabase = await createClient()
    const { data, error } = await supabase
      .from("restaurants")
      .update({ is_featured, updated_at: new Date().toISOString() })
      .eq("id", id)
      .select()
      .single()

    if (error) throw error

    revalidatePath("/admin/dashboard/speisekarten")
    return {
      success: true,
      data: data as Restaurant,
      message: is_featured ? "Als Featured markiert" : "Featured entfernt",
    }
  } catch (error) {
    console.error("Error toggling featured:", error)
    return { success: false, error: "Fehler beim Aktualisieren" }
  }
}

// ============================================
// Menu Category Actions
// ============================================

export async function getMenuCategories(restaurantId: string) {
  try {
    const supabase = await createClient()
    const { data, error } = await supabase
      .from("menu_categories")
      .select("*")
      .eq("restaurant_id", restaurantId)
      .order("sort_order", { ascending: true })

    if (error) throw error
    return { success: true, data: data as MenuCategory[] }
  } catch (error) {
    console.error("Error fetching menu categories:", error)
    return { success: false, error: "Fehler beim Laden der Kategorien" }
  }
}

export async function createMenuCategory(input: CreateMenuCategoryInput) {
  try {
    const supabase = await createClient()

    // Get max sort_order
    const { data: existing } = await supabase
      .from("menu_categories")
      .select("sort_order")
      .eq("restaurant_id", input.restaurant_id)
      .order("sort_order", { ascending: false })
      .limit(1)

    const nextSortOrder = existing && existing.length > 0 ? existing[0].sort_order + 1 : 0

    const { data, error } = await supabase
      .from("menu_categories")
      .insert({ ...input, sort_order: input.sort_order ?? nextSortOrder })
      .select()
      .single()

    if (error) throw error

    revalidatePath(`/admin/dashboard/speisekarten/${input.restaurant_id}`)
    return { success: true, data: data as MenuCategory, message: "Kategorie erstellt" }
  } catch (error) {
    console.error("Error creating menu category:", error)
    return { success: false, error: "Fehler beim Erstellen der Kategorie" }
  }
}

export async function updateMenuCategory(input: UpdateMenuCategoryInput) {
  try {
    const { id, ...updateData } = input
    const supabase = await createClient()
    const { data, error } = await supabase
      .from("menu_categories")
      .update(updateData)
      .eq("id", id)
      .select()
      .single()

    if (error) throw error

    return { success: true, data: data as MenuCategory, message: "Kategorie aktualisiert" }
  } catch (error) {
    console.error("Error updating menu category:", error)
    return { success: false, error: "Fehler beim Aktualisieren der Kategorie" }
  }
}

export async function deleteMenuCategory(id: string, restaurantId: string) {
  try {
    const supabase = await createClient()
    const { error } = await supabase
      .from("menu_categories")
      .delete()
      .eq("id", id)

    if (error) throw error

    revalidatePath(`/admin/dashboard/speisekarten/${restaurantId}`)
    return { success: true, message: "Kategorie gelöscht" }
  } catch (error) {
    console.error("Error deleting menu category:", error)
    return { success: false, error: "Fehler beim Löschen der Kategorie" }
  }
}

export async function reorderMenuCategories(
  restaurantId: string,
  categoryIds: string[]
) {
  try {
    const supabase = await createClient()

    // Update each category's sort_order
    const updates = categoryIds.map((id, index) =>
      supabase
        .from("menu_categories")
        .update({ sort_order: index })
        .eq("id", id)
    )

    await Promise.all(updates)

    revalidatePath(`/admin/dashboard/speisekarten/${restaurantId}`)
    return { success: true, message: "Reihenfolge aktualisiert" }
  } catch (error) {
    console.error("Error reordering categories:", error)
    return { success: false, error: "Fehler beim Aktualisieren der Reihenfolge" }
  }
}

// ============================================
// Menu Item Actions
// ============================================

export async function getMenuItems(restaurantId: string) {
  try {
    const supabase = await createClient()
    const { data, error } = await supabase
      .from("menu_items")
      .select("*")
      .eq("restaurant_id", restaurantId)
      .order("sort_order", { ascending: true })

    if (error) throw error
    return { success: true, data: data as MenuItem[] }
  } catch (error) {
    console.error("Error fetching menu items:", error)
    return { success: false, error: "Fehler beim Laden der Gerichte" }
  }
}

export async function createMenuItem(input: CreateMenuItemInput) {
  try {
    const supabase = await createClient()

    // Get max sort_order for category or restaurant
    const { data: existing } = await supabase
      .from("menu_items")
      .select("sort_order")
      .eq("restaurant_id", input.restaurant_id)
      .eq("category_id", input.category_id ?? null)
      .order("sort_order", { ascending: false })
      .limit(1)

    const nextSortOrder = existing && existing.length > 0 ? existing[0].sort_order + 1 : 0

    const { data, error } = await supabase
      .from("menu_items")
      .insert({ ...input, sort_order: input.sort_order ?? nextSortOrder })
      .select()
      .single()

    if (error) throw error

    revalidatePath(`/admin/dashboard/speisekarten/${input.restaurant_id}`)
    return { success: true, data: data as MenuItem, message: "Gericht hinzugefügt" }
  } catch (error) {
    console.error("Error creating menu item:", error)
    return { success: false, error: "Fehler beim Hinzufügen des Gerichts" }
  }
}

export async function updateMenuItem(input: UpdateMenuItemInput) {
  try {
    const { id, ...updateData } = input
    const supabase = await createClient()
    const { data, error } = await supabase
      .from("menu_items")
      .update(updateData)
      .eq("id", id)
      .select()
      .single()

    if (error) throw error

    return { success: true, data: data as MenuItem, message: "Gericht aktualisiert" }
  } catch (error) {
    console.error("Error updating menu item:", error)
    return { success: false, error: "Fehler beim Aktualisieren des Gerichts" }
  }
}

export async function deleteMenuItem(id: string, restaurantId: string) {
  try {
    const supabase = await createClient()
    const { error } = await supabase
      .from("menu_items")
      .delete()
      .eq("id", id)

    if (error) throw error

    revalidatePath(`/admin/dashboard/speisekarten/${restaurantId}`)
    return { success: true, message: "Gericht gelöscht" }
  } catch (error) {
    console.error("Error deleting menu item:", error)
    return { success: false, error: "Fehler beim Löschen des Gerichts" }
  }
}

export async function reorderMenuItems(
  restaurantId: string,
  categoryId: string | null,
  itemIds: string[]
) {
  try {
    const supabase = await createClient()

    const updates = itemIds.map((id, index) =>
      supabase
        .from("menu_items")
        .update({ sort_order: index, category_id: categoryId })
        .eq("id", id)
    )

    await Promise.all(updates)

    revalidatePath(`/admin/dashboard/speisekarten/${restaurantId}`)
    return { success: true, message: "Reihenfolge aktualisiert" }
  } catch (error) {
    console.error("Error reordering items:", error)
    return { success: false, error: "Fehler beim Aktualisieren der Reihenfolge" }
  }
}

// ============================================
// Special Menu Actions
// ============================================

export async function getSpecialMenus(restaurantId: string) {
  try {
    const supabase = await createClient()
    const { data, error } = await supabase
      .from("special_menus")
      .select("*")
      .eq("restaurant_id", restaurantId)
      .order("sort_order", { ascending: true })

    if (error) throw error
    return { success: true, data: data as SpecialMenu[] }
  } catch (error) {
    console.error("Error fetching special menus:", error)
    return { success: false, error: "Fehler beim Laden der Spezialmenüs" }
  }
}

export async function getSpecialMenu(id: string) {
  try {
    const supabase = await createClient()
    const { data, error } = await supabase
      .from("special_menus")
      .select("*")
      .eq("id", id)
      .single()

    if (error) throw error
    return { success: true, data: data as SpecialMenu }
  } catch (error) {
    console.error("Error fetching special menu:", error)
    return { success: false, error: "Spezialmenü nicht gefunden" }
  }
}

export async function createSpecialMenu(input: CreateSpecialMenuInput) {
  try {
    const supabase = await createClient()

    const { data: existing } = await supabase
      .from("special_menus")
      .select("sort_order")
      .eq("restaurant_id", input.restaurant_id)
      .order("sort_order", { ascending: false })
      .limit(1)

    const nextSortOrder = existing && existing.length > 0 ? existing[0].sort_order + 1 : 0

    const { data, error } = await supabase
      .from("special_menus")
      .insert({ ...input, sort_order: input.sort_order ?? nextSortOrder })
      .select()
      .single()

    if (error) throw error

    revalidatePath(`/admin/dashboard/speisekarten/${input.restaurant_id}`)
    return { success: true, data: data as SpecialMenu, message: "Spezialmenü erstellt" }
  } catch (error) {
    console.error("Error creating special menu:", error)
    return { success: false, error: "Fehler beim Erstellen des Spezialmenüs" }
  }
}

export async function updateSpecialMenu(input: UpdateSpecialMenuInput) {
  try {
    const { id, ...updateData } = input
    const supabase = await createClient()
    const { data, error } = await supabase
      .from("special_menus")
      .update(updateData)
      .eq("id", id)
      .select()
      .single()

    if (error) throw error

    return { success: true, data: data as SpecialMenu, message: "Spezialmenü aktualisiert" }
  } catch (error) {
    console.error("Error updating special menu:", error)
    return { success: false, error: "Fehler beim Aktualisieren des Spezialmenüs" }
  }
}

export async function deleteSpecialMenu(id: string, restaurantId: string) {
  try {
    const supabase = await createClient()
    const { error } = await supabase
      .from("special_menus")
      .delete()
      .eq("id", id)

    if (error) throw error

    revalidatePath(`/admin/dashboard/speisekarten/${restaurantId}`)
    return { success: true, message: "Spezialmenü gelöscht" }
  } catch (error) {
    console.error("Error deleting special menu:", error)
    return { success: false, error: "Fehler beim Löschen des Spezialmenüs" }
  }
}

// ============================================
// Special Menu Category Actions
// ============================================

export async function getSpecialMenuCategories(specialMenuId: string) {
  try {
    const supabase = await createClient()
    const { data, error } = await supabase
      .from("special_menu_categories")
      .select("*")
      .eq("special_menu_id", specialMenuId)
      .order("sort_order", { ascending: true })

    if (error) throw error
    return { success: true, data: data as SpecialMenuCategory[] }
  } catch (error) {
    console.error("Error fetching special menu categories:", error)
    return { success: false, error: "Fehler beim Laden der Kategorien" }
  }
}

export async function createSpecialMenuCategory(input: CreateSpecialMenuCategoryInput) {
  try {
    const supabase = await createClient()

    const { data: existing } = await supabase
      .from("special_menu_categories")
      .select("sort_order")
      .eq("special_menu_id", input.special_menu_id)
      .order("sort_order", { ascending: false })
      .limit(1)

    const nextSortOrder = existing && existing.length > 0 ? existing[0].sort_order + 1 : 0

    const { data, error } = await supabase
      .from("special_menu_categories")
      .insert({ ...input, sort_order: input.sort_order ?? nextSortOrder })
      .select()
      .single()

    if (error) throw error

    return { success: true, data: data as SpecialMenuCategory, message: "Kategorie erstellt" }
  } catch (error) {
    console.error("Error creating special menu category:", error)
    return { success: false, error: "Fehler beim Erstellen der Kategorie" }
  }
}

export async function updateSpecialMenuCategory(input: UpdateSpecialMenuCategoryInput) {
  try {
    const { id, ...updateData } = input
    const supabase = await createClient()
    const { data, error } = await supabase
      .from("special_menu_categories")
      .update(updateData)
      .eq("id", id)
      .select()
      .single()

    if (error) throw error

    return { success: true, data: data as SpecialMenuCategory, message: "Kategorie aktualisiert" }
  } catch (error) {
    console.error("Error updating special menu category:", error)
    return { success: false, error: "Fehler beim Aktualisieren der Kategorie" }
  }
}

export async function deleteSpecialMenuCategory(id: string) {
  try {
    const supabase = await createClient()
    const { error } = await supabase
      .from("special_menu_categories")
      .delete()
      .eq("id", id)

    if (error) throw error

    return { success: true, message: "Kategorie gelöscht" }
  } catch (error) {
    console.error("Error deleting special menu category:", error)
    return { success: false, error: "Fehler beim Löschen der Kategorie" }
  }
}

export async function reorderSpecialMenuCategories(
  specialMenuId: string,
  categoryIds: string[]
) {
  try {
    const supabase = await createClient()

    const updates = categoryIds.map((id, index) =>
      supabase
        .from("special_menu_categories")
        .update({ sort_order: index })
        .eq("id", id)
    )

    await Promise.all(updates)

    return { success: true, message: "Reihenfolge aktualisiert" }
  } catch (error) {
    console.error("Error reordering special menu categories:", error)
    return { success: false, error: "Fehler beim Aktualisieren der Reihenfolge" }
  }
}

// ============================================
// Special Menu Item Actions
// ============================================

export async function getSpecialMenuItems(specialMenuId: string) {
  try {
    const supabase = await createClient()
    const { data, error } = await supabase
      .from("special_menu_items")
      .select("*")
      .eq("special_menu_id", specialMenuId)
      .order("sort_order", { ascending: true })

    if (error) throw error
    return { success: true, data: data as SpecialMenuItem[] }
  } catch (error) {
    console.error("Error fetching special menu items:", error)
    return { success: false, error: "Fehler beim Laden der Gerichte" }
  }
}

export async function createSpecialMenuItem(input: CreateSpecialMenuItemInput) {
  try {
    const supabase = await createClient()

    const { data: existing } = await supabase
      .from("special_menu_items")
      .select("sort_order")
      .eq("special_menu_id", input.special_menu_id)
      .eq("category_id", input.category_id ?? null)
      .order("sort_order", { ascending: false })
      .limit(1)

    const nextSortOrder = existing && existing.length > 0 ? existing[0].sort_order + 1 : 0

    const { data, error } = await supabase
      .from("special_menu_items")
      .insert({ ...input, sort_order: input.sort_order ?? nextSortOrder })
      .select()
      .single()

    if (error) throw error

    return { success: true, data: data as SpecialMenuItem, message: "Gericht hinzugefügt" }
  } catch (error) {
    console.error("Error creating special menu item:", error)
    return { success: false, error: "Fehler beim Hinzufügen des Gerichts" }
  }
}

export async function updateSpecialMenuItem(input: UpdateSpecialMenuItemInput) {
  try {
    const { id, ...updateData } = input
    const supabase = await createClient()
    const { data, error } = await supabase
      .from("special_menu_items")
      .update(updateData)
      .eq("id", id)
      .select()
      .single()

    if (error) throw error

    return { success: true, data: data as SpecialMenuItem, message: "Gericht aktualisiert" }
  } catch (error) {
    console.error("Error updating special menu item:", error)
    return { success: false, error: "Fehler beim Aktualisieren des Gerichts" }
  }
}

export async function deleteSpecialMenuItem(id: string) {
  try {
    const supabase = await createClient()
    const { error } = await supabase
      .from("special_menu_items")
      .delete()
      .eq("id", id)

    if (error) throw error

    return { success: true, message: "Gericht gelöscht" }
  } catch (error) {
    console.error("Error deleting special menu item:", error)
    return { success: false, error: "Fehler beim Löschen des Gerichts" }
  }
}

export async function reorderSpecialMenuItems(
  specialMenuId: string,
  categoryId: string | null,
  itemIds: string[]
) {
  try {
    const supabase = await createClient()

    const updates = itemIds.map((id, index) =>
      supabase
        .from("special_menu_items")
        .update({ sort_order: index, category_id: categoryId })
        .eq("id", id)
    )

    await Promise.all(updates)

    return { success: true, message: "Reihenfolge aktualisiert" }
  } catch (error) {
    console.error("Error reordering special menu items:", error)
    return { success: false, error: "Fehler beim Aktualisieren der Reihenfolge" }
  }
}

// ============================================
// Org-facing menu management
// ============================================

const IMAGE_BUCKET = "images"

/**
 * Look up the restaurant row tied to the given org account.
 * If none exists, create a minimal pending row so the dashboard can render
 * the menu UI on first visit.
 */
export async function getOrCreateRestaurantForAccount(accountId: string) {
  try {
    const supabase = await createClient()

    const { data: existing, error: selectErr } = await supabase
      .from("restaurants")
      .select("*")
      .eq("account_id", accountId)
      .maybeSingle()

    if (selectErr) throw selectErr
    if (existing) return { success: true, data: existing as Restaurant }

    const { data: account, error: accErr } = await supabase
      .from("accounts")
      .select("id, name, slug, sub_type")
      .eq("id", accountId)
      .single()
    if (accErr || !account) {
      return { success: false, error: "Konto nicht gefunden" }
    }
    if (account.sub_type !== "restaurant") {
      return { success: false, error: "Nur für Gastronomie-Konten verfügbar" }
    }

    const baseSlug = account.slug || generateSlug(account.name || "restaurant")
    const slug = `${baseSlug}-${Date.now().toString(36)}`

    const { data: created, error: insertErr } = await supabase
      .from("restaurants")
      .insert({
        account_id: account.id,
        name: account.name,
        slug,
        status: "pending",
      })
      .select()
      .single()

    if (insertErr) throw insertErr
    return { success: true, data: created as Restaurant }
  } catch (error) {
    console.error("Error resolving restaurant for account:", error)
    return { success: false, error: "Fehler beim Laden des Restaurants" }
  }
}

export async function updateRestaurantAiStyle(
  restaurantId: string,
  style: AiImageStyle | null
) {
  try {
    const supabase = await createClient()
    const { error } = await supabase
      .from("restaurants")
      .update({ ai_image_style: style, updated_at: new Date().toISOString() })
      .eq("id", restaurantId)

    if (error) throw error

    revalidatePath("/dashboard/speisekarte")
    return { success: true, message: "Bildstil gespeichert" }
  } catch (error) {
    console.error("Error updating restaurant ai_image_style:", error)
    return { success: false, error: "Fehler beim Speichern des Bildstils" }
  }
}

export type ItemKind = "menu_item" | "special_menu_item"

function tableFor(kind: ItemKind): "menu_items" | "special_menu_items" {
  return kind === "menu_item" ? "menu_items" : "special_menu_items"
}

function storageFolderFor(kind: ItemKind): "menu-items" | "special-menu-items" {
  return kind === "menu_item" ? "menu-items" : "special-menu-items"
}

async function resolveRestaurantIdForItem(
  supabase: Awaited<ReturnType<typeof createClient>>,
  kind: ItemKind,
  itemId: string
): Promise<string | null> {
  if (kind === "menu_item") {
    const { data } = await supabase
      .from("menu_items")
      .select("restaurant_id")
      .eq("id", itemId)
      .single()
    return (data?.restaurant_id as string | undefined) ?? null
  }
  const { data } = await supabase
    .from("special_menu_items")
    .select("special_menu_id, special_menus:special_menu_id(restaurant_id)")
    .eq("id", itemId)
    .single()
  if (!data) return null
  const restaurantId = (data as unknown as {
    special_menus?: { restaurant_id?: string }
  }).special_menus?.restaurant_id
  return restaurantId ?? null
}

/**
 * Upload a manually-chosen image for a menu item (regular or special).
 * Mirrors the Edge Function's storage path scheme.
 */
export async function uploadItemImage(
  kind: ItemKind,
  itemId: string,
  formData: FormData
) {
  try {
    const file = formData.get("file") as File | null
    if (!file) return { success: false, error: "Keine Datei ausgewählt" }
    if (!file.type.startsWith("image/")) {
      return { success: false, error: "Nur Bilddateien sind erlaubt" }
    }

    const supabase = await createClient()
    const restaurantId = await resolveRestaurantIdForItem(supabase, kind, itemId)
    if (!restaurantId) return { success: false, error: "Gericht nicht gefunden" }

    const ext = file.name.includes(".")
      ? file.name.split(".").pop()!.toLowerCase()
      : (file.type.split("/")[1] ?? "jpg")
    const folder = storageFolderFor(kind)
    const objectPath = `${folder}/${restaurantId}/${itemId}_upload_${Date.now()}.${ext}`
    const arrayBuffer = await file.arrayBuffer()

    const { error: uploadErr } = await supabase.storage
      .from(IMAGE_BUCKET)
      .upload(objectPath, new Uint8Array(arrayBuffer), {
        contentType: file.type || "image/jpeg",
        upsert: true,
      })
    if (uploadErr) throw uploadErr

    const { data: pub } = supabase.storage
      .from(IMAGE_BUCKET)
      .getPublicUrl(objectPath)
    const publicUrl = pub.publicUrl

    const { error: updateErr } = await supabase
      .from(tableFor(kind))
      .update({ image_url: publicUrl })
      .eq("id", itemId)
    if (updateErr) throw updateErr

    revalidatePath("/dashboard/speisekarte")
    return { success: true, image_url: publicUrl, message: "Bild hochgeladen" }
  } catch (error) {
    console.error("Error uploading item image:", error)
    return { success: false, error: "Fehler beim Hochladen des Bildes" }
  }
}

export async function clearItemImage(kind: ItemKind, itemId: string) {
  try {
    const supabase = await createClient()
    const { error } = await supabase
      .from(tableFor(kind))
      .update({ image_url: null })
      .eq("id", itemId)
    if (error) throw error

    revalidatePath("/dashboard/speisekarte")
    return { success: true, message: "Bild entfernt" }
  } catch (error) {
    console.error("Error clearing item image:", error)
    return { success: false, error: "Fehler beim Entfernen des Bildes" }
  }
}

/**
 * Commit a previously-generated variant URL as the item's saved image.
 */
export async function commitItemImage(
  kind: ItemKind,
  itemId: string,
  url: string
) {
  try {
    const supabase = await createClient()
    const { error } = await supabase
      .from(tableFor(kind))
      .update({ image_url: url })
      .eq("id", itemId)
    if (error) throw error

    revalidatePath("/dashboard/speisekarte")
    return { success: true, image_url: url, message: "Bild übernommen" }
  } catch (error) {
    console.error("Error committing item image:", error)
    return { success: false, error: "Fehler beim Übernehmen des Bildes" }
  }
}

/**
 * Upload a reference image used to "beautify" a dish via the AI edit model.
 * Stored under `ai-references/{restaurantId}/...` in the same `images` bucket;
 * does NOT touch the item's `image_url`. Returns the public URL so the client
 * can pass it as `reference_image_urls` to `regenerateItemImageWithAi`.
 */
export async function uploadReferenceImage(
  kind: ItemKind,
  itemId: string,
  formData: FormData
) {
  try {
    const file = formData.get("file") as File | null
    if (!file) return { success: false, error: "Keine Datei ausgewählt" }
    if (!file.type.startsWith("image/")) {
      return { success: false, error: "Nur Bilddateien sind erlaubt" }
    }

    const supabase = await createClient()
    const restaurantId = await resolveRestaurantIdForItem(supabase, kind, itemId)
    if (!restaurantId) return { success: false, error: "Gericht nicht gefunden" }

    const ext = file.name.includes(".")
      ? file.name.split(".").pop()!.toLowerCase()
      : (file.type.split("/")[1] ?? "jpg")
    const folder = storageFolderFor(kind)
    const objectPath = `ai-references/${folder}/${restaurantId}/${itemId}_ref_${Date.now()}.${ext}`
    const arrayBuffer = await file.arrayBuffer()

    const { error: uploadErr } = await supabase.storage
      .from(IMAGE_BUCKET)
      .upload(objectPath, new Uint8Array(arrayBuffer), {
        contentType: file.type || "image/jpeg",
        upsert: true,
      })
    if (uploadErr) throw uploadErr

    const { data: pub } = supabase.storage
      .from(IMAGE_BUCKET)
      .getPublicUrl(objectPath)

    return { success: true, url: pub.publicUrl, message: "Referenzbild hochgeladen" }
  } catch (error) {
    console.error("Error uploading reference image:", error)
    return { success: false, error: "Fehler beim Hochladen des Referenzbildes" }
  }
}

/**
 * Call the deployed generate-menu-image Edge Function. With `preview=true`,
 * the function uploads a variant to storage but does NOT update the row;
 * the client gets the URL back and can show it as a variant. With `preview`
 * unset/false, the function commits directly (one-shot regeneration).
 * When `reference_image_urls` is passed, the function runs the image-to-image
 * edit model to restyle the gastro's real photo into the branded look.
 * SUPABASE_SEED_TOKEN is read on the server only — never expose to the browser.
 */
export async function regenerateItemImageWithAi(
  kind: ItemKind,
  itemId: string,
  opts?: {
    prompt_hint?: string
    style_preset?: AiImageStyle
    model?: AiImageModel
    preview?: boolean
    reference_image_urls?: string[]
  }
) {
  try {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
    const seedToken = process.env.SUPABASE_SEED_TOKEN
    if (!supabaseUrl || !seedToken) {
      return {
        success: false,
        error: "AI-Bilderzeugung ist aktuell nicht konfiguriert (SEED_TOKEN fehlt).",
      }
    }

    const endpoint = `${supabaseUrl}/functions/v1/generate-menu-image`
    const payload: Record<string, unknown> =
      kind === "menu_item"
        ? { menu_item_id: itemId }
        : { special_menu_item_id: itemId }
    if (opts?.prompt_hint) payload.prompt_hint = opts.prompt_hint
    if (opts?.style_preset) payload.style_preset = opts.style_preset
    if (opts?.model) payload.model = opts.model
    if (opts?.preview) payload.preview = true
    if (opts?.reference_image_urls?.length)
      payload.reference_image_urls = opts.reference_image_urls

    const resp = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-seed-token": seedToken,
      },
      body: JSON.stringify(payload),
    })

    const body = (await resp.json().catch(() => null)) as
      | { ok?: boolean; image_url?: string; code?: string; error?: string; preview?: boolean }
      | null

    if (!resp.ok || !body?.ok || !body.image_url) {
      console.error("Edge Function generate-menu-image failed:", resp.status, body)
      const code = body?.code ?? `HTTP_${resp.status}`
      return { success: false, error: `KI-Bilderzeugung fehlgeschlagen: ${code}` }
    }

    if (!opts?.preview) revalidatePath("/dashboard/speisekarte")
    return {
      success: true,
      image_url: body.image_url,
      preview: !!body.preview,
      message: opts?.preview ? "Variante erstellt" : "Bild generiert",
    }
  } catch (error) {
    console.error("Error regenerating item image:", error)
    return { success: false, error: "Fehler bei der KI-Bilderzeugung" }
  }
}
