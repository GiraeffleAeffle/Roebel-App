/**
 * Gastronomie (restaurant menu) data layer for the public org page.
 * Ported from apps/expo/hooks/useGastroData.ts + menu-item detail.
 */

import { supabase } from "./supabase";
import type { Restaurant, MenuCategory, MenuItem } from "@/types/restaurant";
import {
  fetchMenuItemVoteSummaries,
  type MenuItemVoteSummary,
} from "./supabase-ratings";
import { hasSupabase, recordClient } from "@/lib/record";
import { getMenuBySlug, RecordUnavailableError, type MenuData } from "@netizen-labs/record-client";

export interface MenuItemWithFlags extends MenuItem {
  has_variants: boolean;
  sides_required?: boolean;
  sides_label?: string | null;
  variants_label?: string | null;
}

export interface CategoryWithItems extends MenuCategory {
  items: MenuItemWithFlags[];
}

export interface GastroData {
  restaurant: Restaurant | null;
  categories: CategoryWithItems[];
  voteSummaries: Record<string, MenuItemVoteSummary>;
}

export interface MenuItemVariant {
  id: string;
  menu_item_id: string;
  name: string;
  price: number;
  is_default: boolean;
  sort_order: number;
}

export interface MenuItemSide {
  id: string;
  menu_item_id: string;
  name: string;
  description: string | null;
  price_delta: number;
  is_default: boolean;
  sort_order: number;
}

export interface MenuItemDetail extends MenuItemWithFlags {
  variants: MenuItemVariant[];
  sides: MenuItemSide[];
  vote_summary: MenuItemVoteSummary | null;
}

/**
 * `MenuData.categories[].items[]` (menuToSpec's content JSON) carries no
 * item/category id at all — only name/description/price/currency. Every
 * record-mode caller here (fetchGastroData, searchMenuItems) needs the SAME
 * synthetic, position-derived ids so a category/item looked up one way
 * matches the other within a single request; this is the one place that
 * derivation happens.
 */
function menuDataToCategories(menu: MenuData): CategoryWithItems[] {
  return menu.categories.map((cat, catIdx) => ({
    id: `cat-${catIdx}`,
    restaurant_id: menu.restaurantId,
    name: cat.name,
    sort_order: catIdx,
    is_active: true,
    created_at: "",
    items: cat.items.map((item, itemIdx) => ({
      id: `item-${catIdx}-${itemIdx}`,
      restaurant_id: menu.restaurantId,
      category_id: `cat-${catIdx}`,
      name: item.name,
      description: item.description ?? null,
      price: item.price !== undefined && Number.isFinite(Number(item.price)) ? Number(item.price) : 0,
      image_url: null,
      is_vegetarian: false,
      is_vegan: false,
      is_available: true,
      sort_order: itemIdx,
      created_at: "",
      // menuToSpec publishes no variants/sides at all — genuinely absent,
      // not merely unmapped (see civic.ts's MenuData doc comment).
      has_variants: false,
    })),
  }));
}

/** Shared by fetchRestaurantByAccount and fetchGastroData's record branches
 * so a single getMenuBySlug fetch covers both instead of two round trips. */
function menuToRestaurant(menu: MenuData): Restaurant {
  return {
    id: menu.restaurantId,
    account_id: null,
    name: menu.name,
    slug: menu.slug ?? "",
    description: null,
    // menuToSpec's single "image" tag is sourced from logo_url, not
    // cover_image_url (mappers.ts:762) — no separate cover is published.
    logo_url: menu.image,
    cover_image_url: null,
    background_color: "#ffffff",
    address: menu.location,
    phone: null,
    website_url: null,
    latitude: null,
    longitude: null,
    status: "approved",
    is_featured: false,
    sort_order: 0,
    ai_image_style: null,
    created_at: "",
    updated_at: "",
  };
}

export async function fetchRestaurantByAccount(
  accountId: string
): Promise<Restaurant | null> {
  if (!hasSupabase) {
    try {
      const menu = await getMenuBySlug(recordClient, accountId);
      return menu ? menuToRestaurant(menu) : null;
    } catch (error) {
      if (error instanceof RecordUnavailableError) return null;
      throw error;
    }
  }

  const { data, error } = await supabase
    .from("restaurants")
    .select("*")
    .eq("account_id", accountId)
    .maybeSingle();
  if (error) {
    console.error("fetchRestaurantByAccount error:", error);
    return null;
  }
  return (data as Restaurant) ?? null;
}

/**
 * Full menu (categories + items + variant flag + vote summaries) for an
 * account. Record mode: `accountId` is the org's SLUG (see
 * supabase-org-content.ts's own doc comment) — `getMenuBySlug` matches
 * directly on it, no pubkey join needed. voteSummaries is always {} — no
 * thumbs-up/down data exists on the record.
 */
export async function fetchGastroData(accountId: string): Promise<GastroData> {
  if (!hasSupabase) {
    try {
      const menu = await getMenuBySlug(recordClient, accountId);
      if (!menu) return { restaurant: null, categories: [], voteSummaries: {} };
      return { restaurant: menuToRestaurant(menu), categories: menuDataToCategories(menu), voteSummaries: {} };
    } catch (error) {
      if (error instanceof RecordUnavailableError) return { restaurant: null, categories: [], voteSummaries: {} };
      throw error;
    }
  }

  const restaurant = await fetchRestaurantByAccount(accountId);
  if (!restaurant) {
    return { restaurant: null, categories: [], voteSummaries: {} };
  }

  const { data: catData, error } = await supabase
    .from("menu_categories")
    .select("*, menu_items(*, menu_item_variants(id))")
    .eq("restaurant_id", restaurant.id)
    .eq("is_active", true)
    .order("sort_order", { ascending: true });

  if (error) {
    console.error("fetchGastroData categories error:", error);
    return { restaurant, categories: [], voteSummaries: {} };
  }

  const categories: CategoryWithItems[] = ((catData as any[]) ?? []).map(
    (cat) => {
      const items: MenuItemWithFlags[] = (cat.menu_items ?? [])
        .filter((it: any) => it.is_available !== false)
        .sort((a: any, b: any) => (a.sort_order ?? 0) - (b.sort_order ?? 0))
        .map((it: any) => ({
          ...it,
          has_variants: Array.isArray(it.menu_item_variants)
            ? it.menu_item_variants.length > 0
            : false,
        }));
      return { ...cat, items };
    }
  );

  const allItemIds = categories.flatMap((c) => c.items.map((i) => i.id));
  const voteSummaries = await fetchMenuItemVoteSummaries(allItemIds);

  return { restaurant, categories, voteSummaries };
}

export async function fetchMenuItemDetail(
  itemId: string
): Promise<MenuItemDetail | null> {
  const { data, error } = await supabase
    .from("menu_items")
    .select("*, menu_item_variants(*), menu_item_sides(*)")
    .eq("id", itemId)
    .maybeSingle();
  if (error || !data) {
    if (error) console.error("fetchMenuItemDetail error:", error);
    return null;
  }
  const row = data as any;
  const summaries = await fetchMenuItemVoteSummaries([itemId]);
  const variants = ((row.menu_item_variants as MenuItemVariant[]) ?? []).sort(
    (a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0)
  );
  const sides = ((row.menu_item_sides as MenuItemSide[]) ?? []).sort(
    (a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0)
  );
  return {
    ...row,
    has_variants: variants.length > 0,
    variants,
    sides,
    vote_summary: summaries[itemId] ?? null,
  };
}

export async function fetchRelatedMenuItems(
  restaurantId: string,
  excludeId: string,
  limit = 6
): Promise<MenuItem[]> {
  const { data, error } = await supabase
    .from("menu_items")
    .select("*")
    .eq("restaurant_id", restaurantId)
    .neq("id", excludeId)
    .eq("is_available", true)
    .limit(limit);
  if (error) {
    console.error("fetchRelatedMenuItems error:", error);
    return [];
  }
  return (data as MenuItem[]) ?? [];
}

/** Free-text menu search via the `search_menu_items` RPC. Record mode does
 * the equivalent filter client-side over the same menu fetchGastroData
 * already reads, rather than an RPC that does not exist without Supabase. */
export async function searchMenuItems(
  accountId: string,
  query: string
): Promise<MenuItem[]> {
  const trimmed = query.trim();
  if (trimmed.length < 2) return [];

  if (!hasSupabase) {
    try {
      const menu = await getMenuBySlug(recordClient, accountId);
      if (!menu) return [];
      const needle = trimmed.toLowerCase();
      return menuDataToCategories(menu)
        .flatMap((cat) => cat.items)
        .filter(
          (item) =>
            item.name.toLowerCase().includes(needle) ||
            (item.description ?? "").toLowerCase().includes(needle)
        );
    } catch (error) {
      if (error instanceof RecordUnavailableError) return [];
      throw error;
    }
  }

  const { data, error } = await supabase.rpc("search_menu_items", {
    p_account_id: accountId,
    p_query: trimmed,
  });
  if (error) {
    console.error("searchMenuItems error:", error);
    return [];
  }
  return (data as MenuItem[]) ?? [];
}
