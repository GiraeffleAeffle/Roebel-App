// Restaurant Management Types

export type RestaurantStatus = "pending" | "approved" | "rejected" | "published"
export type SpecialMenuStatus = "draft" | "published" | "archived"

export type AiImageStyle =
  | "dark_stoneware"
  | "italian_gingham"
  | "light_concrete"
  | "wooden_board"

export const AI_IMAGE_STYLE_LABELS: Record<AiImageStyle, string> = {
  dark_stoneware: "Dunkle Steinplatte",
  italian_gingham: "Italienische Trattoria",
  light_concrete: "Heller Beton",
  wooden_board: "Holzbrett",
}

export type AiImageModel = "seedream" | "nano_banana_pro"

export const AI_IMAGE_MODEL_LABELS: Record<AiImageModel, string> = {
  seedream: "Seedream 4.5",
  nano_banana_pro: "Nano Banana Pro",
}

export const AI_IMAGE_MODEL_DESCRIPTIONS: Record<AiImageModel, string> = {
  seedream: "Standard — schnell und zuverlässig.",
  nano_banana_pro: "Google · höhere Detailtreue, etwas langsamer.",
}

export const AI_IMAGE_STYLE_DESCRIPTIONS: Record<AiImageStyle, string> = {
  dark_stoneware:
    "Anthrazitgraue Steinplatte auf mattem dunklem Untergrund — wirkt edel und reduziert.",
  italian_gingham:
    "Weißer Teller auf beige-weiß karierter Tischdecke — klassische Trattoria-Optik.",
  light_concrete:
    "Heller, betongrauer Untergrund — neutral und modern, ähnlich Uber-Eats-Katalog.",
  wooden_board:
    "Warmes Eichenholz-Brett mit sichtbarer Maserung — rustikal, Farm-to-Table.",
}

// ============================================
// Restaurant
// ============================================
export interface Restaurant {
  id: string
  account_id: string | null
  name: string
  slug: string
  description: string | null
  logo_url: string | null
  cover_image_url: string | null
  background_color: string
  address: string | null
  phone: string | null
  website_url: string | null
  latitude: number | null
  longitude: number | null
  status: RestaurantStatus
  is_featured: boolean
  sort_order: number
  ai_image_style: AiImageStyle | null
  created_at: string
  updated_at: string
  // Computed fields from joins
  menu_categories_count?: number
  menu_items_count?: number
  special_menus_count?: number
}

export interface CreateRestaurantInput {
  name: string
  slug: string
  description?: string
  logo_url?: string
  cover_image_url?: string
  background_color?: string
  address?: string
  phone?: string
  website_url?: string
  latitude?: number
  longitude?: number
  status?: RestaurantStatus
  is_featured?: boolean
  sort_order?: number
}

export interface UpdateRestaurantInput extends Partial<Omit<CreateRestaurantInput, 'latitude' | 'longitude'>> {
  id: string
  latitude?: number | null
  longitude?: number | null
}

// ============================================
// Menu Category
// ============================================
export interface MenuCategory {
  id: string
  restaurant_id: string
  name: string
  sort_order: number
  is_active: boolean
  created_at: string
  // Items in this category
  items?: MenuItem[]
}

export interface CreateMenuCategoryInput {
  restaurant_id: string
  name: string
  sort_order?: number
  is_active?: boolean
}

export interface UpdateMenuCategoryInput {
  id: string
  name?: string
  sort_order?: number
  is_active?: boolean
}

// ============================================
// Menu Item
// ============================================
export interface MenuItem {
  id: string
  restaurant_id: string
  category_id: string | null
  name: string
  description: string | null
  price: number
  image_url: string | null
  is_vegetarian: boolean
  is_vegan: boolean
  is_available: boolean
  sort_order: number
  created_at: string
}

export interface CreateMenuItemInput {
  restaurant_id: string
  category_id?: string
  name: string
  description?: string
  price: number
  image_url?: string
  is_vegetarian?: boolean
  is_vegan?: boolean
  is_available?: boolean
  sort_order?: number
}

export interface UpdateMenuItemInput {
  id: string
  category_id?: string | null
  name?: string
  description?: string | null
  price?: number
  image_url?: string | null
  is_vegetarian?: boolean
  is_vegan?: boolean
  is_available?: boolean
  sort_order?: number
}

// ============================================
// Special Menu
// ============================================
export interface SpecialMenu {
  id: string
  restaurant_id: string
  name: string
  description: string | null
  cover_image_url: string | null
  icon_image_url: string | null
  price: number | null
  start_date: string | null
  end_date: string | null
  status: SpecialMenuStatus
  sort_order: number
  created_at: string
  // Categories and items
  categories?: SpecialMenuCategory[]
}

export interface CreateSpecialMenuInput {
  restaurant_id: string
  name: string
  description?: string
  cover_image_url?: string
  icon_image_url?: string
  price?: number
  start_date?: string
  end_date?: string
  status?: SpecialMenuStatus
  sort_order?: number
}

export interface UpdateSpecialMenuInput {
  id: string
  name?: string
  description?: string | null
  cover_image_url?: string | null
  icon_image_url?: string | null
  price?: number | null
  start_date?: string | null
  end_date?: string | null
  status?: SpecialMenuStatus
  sort_order?: number
}

// ============================================
// Special Menu Category
// ============================================
export interface SpecialMenuCategory {
  id: string
  special_menu_id: string
  name: string
  sort_order: number
  // Items in this category
  items?: SpecialMenuItem[]
}

export interface CreateSpecialMenuCategoryInput {
  special_menu_id: string
  name: string
  sort_order?: number
}

export interface UpdateSpecialMenuCategoryInput {
  id: string
  name?: string
  sort_order?: number
}

// ============================================
// Special Menu Item
// ============================================
export interface SpecialMenuItem {
  id: string
  special_menu_id: string
  category_id: string | null
  name: string
  description: string | null
  price: number | null
  image_url: string | null
  is_vegetarian: boolean
  sort_order: number
}

export interface CreateSpecialMenuItemInput {
  special_menu_id: string
  category_id?: string
  name: string
  description?: string
  price?: number
  image_url?: string | null
  is_vegetarian?: boolean
  sort_order?: number
}

export interface UpdateSpecialMenuItemInput {
  id: string
  category_id?: string | null
  name?: string
  description?: string | null
  price?: number | null
  image_url?: string | null
  is_vegetarian?: boolean
  sort_order?: number
}

// ============================================
// Helper Functions
// ============================================

/**
 * Format price in German format: "12,90 €"
 */
export function formatPrice(price: number | null | undefined): string {
  if (price === null || price === undefined) return "-"
  return price.toLocaleString("de-DE", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }) + " €"
}

/**
 * Parse German price string to number: "12,90" -> 12.90
 */
export function parsePrice(priceStr: string): number {
  return parseFloat(priceStr.replace(",", "."))
}

/**
 * Generate slug from restaurant name
 */
export function generateSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[äÄ]/g, "ae")
    .replace(/[öÖ]/g, "oe")
    .replace(/[üÜ]/g, "ue")
    .replace(/ß/g, "ss")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
}

/**
 * Get status badge styling
 */
export function getRestaurantStatusBadge(status: RestaurantStatus): {
  label: string
  className: string
} {
  switch (status) {
    case "published":
      return { label: "Veröffentlicht", className: "bg-green-100 text-green-800" }
    case "approved":
      return { label: "Freigegeben", className: "bg-blue-100 text-blue-800" }
    case "pending":
      return { label: "Ausstehend", className: "bg-yellow-100 text-yellow-800" }
    case "rejected":
      return { label: "Abgelehnt", className: "bg-red-100 text-red-800" }
  }
}

/**
 * Get special menu status badge styling
 */
export function getSpecialMenuStatusBadge(status: SpecialMenuStatus): {
  label: string
  className: string
} {
  switch (status) {
    case "published":
      return { label: "Veröffentlicht", className: "bg-green-100 text-green-800" }
    case "draft":
      return { label: "Entwurf", className: "bg-muted text-foreground" }
    case "archived":
      return { label: "Archiviert", className: "bg-orange-100 text-orange-800" }
  }
}

/**
 * Check if special menu is currently active based on dates
 */
export function isSpecialMenuActive(menu: SpecialMenu): boolean {
  if (menu.status !== "published") return false

  const today = new Date()
  today.setHours(0, 0, 0, 0)

  if (menu.start_date) {
    const startDate = new Date(menu.start_date)
    if (today < startDate) return false
  }

  if (menu.end_date) {
    const endDate = new Date(menu.end_date)
    if (today > endDate) return false
  }

  return true
}

/**
 * Format date range for special menu display
 */
export function formatDateRange(startDate: string | null, endDate: string | null): string {
  const options: Intl.DateTimeFormatOptions = { day: "2-digit", month: "2-digit", year: "numeric" }

  if (!startDate && !endDate) return "Dauerhaft"

  const start = startDate ? new Date(startDate).toLocaleDateString("de-DE", options) : null
  const end = endDate ? new Date(endDate).toLocaleDateString("de-DE", options) : null

  if (start && end) return `${start} - ${end}`
  if (start) return `Ab ${start}`
  if (end) return `Bis ${end}`

  return "Dauerhaft"
}
