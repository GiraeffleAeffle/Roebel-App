"use server"

import { createClient } from "@/lib/supabase/server"
import type { AppNotificationType, AppNotification, UnifiedNotification } from "@/types/app-notifications"
import {
  cleanNotificationTitle,
  cleanNotificationBody,
  isWalletLike,
} from "@/lib/notification-display"
import { PERSONAL_NOTIFICATION_LOG_FILTER } from "@/lib/notifications/policy"

// ============================================
// Create
// ============================================

export async function createAppNotification(input: {
  type: AppNotificationType
  title: string
  body?: string | null
  link?: string | null
  reference_id?: string | null
  image_url?: string | null
}): Promise<{ success: boolean; error?: string }> {
  try {
    const supabase = await createClient()

    const { error } = await supabase.from("app_notifications").insert({
      type: input.type,
      title: input.title,
      body: input.body || null,
      link: input.link || null,
      reference_id: input.reference_id || null,
      image_url: input.image_url || null,
    })

    if (error) throw error
    return { success: true }
  } catch (error) {
    console.error("Error creating app notification:", error)
    return { success: false, error: "Fehler beim Erstellen der Benachrichtigung" }
  }
}

// ============================================
// Read
// ============================================

export async function getAppNotifications(params?: {
  limit?: number
  offset?: number
}): Promise<{ success: boolean; data?: AppNotification[]; total?: number; error?: string }> {
  try {
    const supabase = await createClient()
    const limit = params?.limit || 20
    const offset = params?.offset || 0

    const { data, error, count } = await supabase
      .from("app_notifications")
      .select("*", { count: "exact" })
      .order("created_at", { ascending: false })
      .range(offset, offset + limit - 1)

    if (error) throw error

    return {
      success: true,
      data: (data || []) as AppNotification[],
      total: count || 0,
    }
  } catch (error) {
    console.error("Error fetching app notifications:", error)
    return { success: false, error: "Fehler beim Laden der Benachrichtigungen" }
  }
}

// ============================================
// Unified (merge push + activity notifications)
// ============================================

export async function getUnifiedNotifications(params?: {
  /**
   * Wallet of the logged-in user. When omitted (logged-out), only community-wide
   * broadcast notifications are returned — NEVER another user's personal ones.
   */
  walletAddress?: string | null
  limit?: number
  offset?: number
}): Promise<{ success: boolean; data?: UnifiedNotification[]; total?: number; error?: string }> {
  try {
    const supabase = await createClient()
    const limit = params?.limit || 20
    const offset = params?.offset || 0
    const wallet = params?.walletAddress ? params.walletAddress.toLowerCase() : null

    // Fetch extra from each source to allow proper merged sorting
    const fetchLimit = limit + offset

    const [pushResult, activityResult, personalResult] = await Promise.allSettled([
      // Broadcast push log — exclude personal types so we don't leak other
      // people's likes/comments/DMs/invites into everyone's inbox.
      supabase
        .from("notification_log")
        .select("id, title, body, notification_type, created_at, data", { count: "exact" })
        .in("status", ["sent", "partial"])
        .not("notification_type", "in", PERSONAL_NOTIFICATION_LOG_FILTER)
        .order("created_at", { ascending: false })
        .limit(fetchLimit),

      // Broadcast activity feed (new events/news/posts/etc.) — community-wide.
      supabase
        .from("app_notifications")
        .select("*", { count: "exact" })
        .order("created_at", { ascending: false })
        .limit(fetchLimit),

      // Personal notifications — ONLY for the logged-in user, scoped by
      // recipient_wallet. Skipped entirely when logged out.
      wallet
        ? supabase
            .from("notifications")
            .select("id, type, title, body, metadata, created_at", { count: "exact" })
            .eq("recipient_wallet", wallet)
            .order("created_at", { ascending: false })
            .limit(fetchLimit)
        : Promise.resolve({ data: [], count: 0 } as { data: unknown[]; count: number }),
    ])

    const unified: UnifiedNotification[] = []
    let totalPush = 0
    let totalActivity = 0
    let totalPersonal = 0

    // Map push notifications
    if (pushResult.status === "fulfilled" && pushResult.value.data) {
      totalPush = pushResult.value.count || 0
      for (const n of pushResult.value.data) {
        const data = n.data as Record<string, unknown> | null
        let link: string | null = null
        if (data?.type === "event" && data?.eventId) {
          link = `/app/events/${data.eventId}`
        } else if (data?.type === "news" && data?.slug) {
          link = `/app/news/${data.slug}`
        }

        unified.push({
          id: n.id as string,
          source: "push",
          title: n.title as string,
          body: (n.body as string) || null,
          type: n.notification_type as string,
          link,
          image_url: "/mecky/mecky.png",
          created_at: n.created_at as string,
        })
      }
    }

    // Map activity notifications
    if (activityResult.status === "fulfilled" && activityResult.value.data) {
      totalActivity = activityResult.value.count || 0
      for (const n of activityResult.value.data) {
        unified.push({
          id: n.id as string,
          source: "activity",
          title: n.title as string,
          body: (n.body as string) || null,
          type: n.type as string,
          link: (n.link as string) || null,
          image_url: (n.image_url as string) || null,
          created_at: n.created_at as string,
        })
      }
    }

    // Map personal notifications (with actor avatar / display-name resolution)
    if (personalResult.status === "fulfilled" && personalResult.value.data?.length) {
      totalPersonal =
        ("count" in personalResult.value ? personalResult.value.count : 0) || 0
      const rows = personalResult.value.data as Array<{
        id: string
        type: string
        title: string | null
        body: string | null
        metadata: Record<string, unknown> | null
        created_at: string
      }>

      // Collect the actor wallets and org account ids referenced by the batch
      // so we can resolve their avatars/names in two bulk queries.
      const actorWallets = new Set<string>()
      const accountIds = new Set<string>()
      for (const r of rows) {
        const actor = r.metadata?.actor_wallet
        if (typeof actor === "string") actorWallets.add(actor.toLowerCase())
        const accId = r.metadata?.account_id
        if (typeof accId === "string") accountIds.add(accId)
      }

      const [usersRes, accountsRes] = await Promise.all([
        actorWallets.size
          ? supabase
              .from("users")
              .select("wallet_address, username, profile_picture_url")
              .in("wallet_address", Array.from(actorWallets))
          : Promise.resolve({ data: [] as unknown[] }),
        accountIds.size
          ? supabase
              .from("accounts")
              .select("id, name, avatar_url")
              .in("id", Array.from(accountIds))
          : Promise.resolve({ data: [] as unknown[] }),
      ])

      const userByWallet = new Map<string, { username: string | null; profile_picture_url: string | null }>()
      for (const u of (usersRes.data || []) as Array<{
        wallet_address: string
        username: string | null
        profile_picture_url: string | null
      }>) {
        userByWallet.set(u.wallet_address.toLowerCase(), {
          username: u.username,
          profile_picture_url: u.profile_picture_url,
        })
      }

      const accountById = new Map<string, { name: string | null; avatar_url: string | null }>()
      for (const a of (accountsRes.data || []) as Array<{
        id: string
        name: string | null
        avatar_url: string | null
      }>) {
        accountById.set(a.id, { name: a.name, avatar_url: a.avatar_url })
      }

      for (const r of rows) {
        const actor =
          typeof r.metadata?.actor_wallet === "string"
            ? userByWallet.get((r.metadata.actor_wallet as string).toLowerCase())
            : undefined
        const account =
          typeof r.metadata?.account_id === "string"
            ? accountById.get(r.metadata.account_id as string)
            : undefined

        // Prefer the stored (already display-name resolved) title. Only fall
        // back to the resolved actor username / friendly label when the stored
        // title is a raw wallet address — never render a 0x… string.
        let title = (r.title ?? "").trim()
        if (!title || isWalletLike(title)) {
          const actorName = actor?.username && !isWalletLike(actor.username) ? actor.username : null
          const orgName = account?.name && !isWalletLike(account.name) ? account.name : null
          title = actorName || orgName || cleanNotificationTitle(r.title, r.type)
        }

        const postId = r.metadata?.post_id
        const metaLink = r.metadata?.link
        const link =
          typeof postId === "string"
            ? `/app/posts/${postId}`
            : typeof metaLink === "string" && metaLink.startsWith("/")
              ? metaLink
              : null

        unified.push({
          id: r.id,
          source: "personal",
          title,
          body: cleanNotificationBody(r.body) || null,
          type: r.type,
          link,
          image_url: actor?.profile_picture_url || account?.avatar_url || null,
          created_at: r.created_at,
        })
      }
    }

    // Sort by created_at descending and paginate
    unified.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
    const paginated = unified.slice(offset, offset + limit)

    return {
      success: true,
      data: paginated,
      total: totalPush + totalActivity + totalPersonal,
    }
  } catch (error) {
    console.error("Error fetching unified notifications:", error)
    return { success: false, error: "Fehler beim Laden der Benachrichtigungen" }
  }
}
