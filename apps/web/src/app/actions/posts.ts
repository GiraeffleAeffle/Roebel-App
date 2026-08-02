"use server"

import { createClient } from "@/lib/supabase/server"
import { revalidatePath } from "next/cache"
import type {
  Post,
  PostWithEngagement,
  PostLink,
  PostComment,
  PostCategory,
  PostType,
  FeedType,
  LinkedEventPreview,
  PollWithResults,
  CreatePostInput,
  CreateCommentInput,
} from "@/types/post"
import { createAppNotification } from "@/app/actions/app-notifications"
import { isAccountOwner, fetchAccountById } from "@/lib/supabase-accounts"
import { isVerifiedCitizen } from "@/lib/server/verify-citizen"
import { isOrgAccount } from "@/types/account"
import { hasSupabase, recordClient } from "@/lib/record"
import { listPosts, RecordUnavailableError } from "@netizen-labs/record-client"

// ============================================
// Helper: build poll results for a set of posts
// ============================================

async function buildPollMap(
  supabase: Awaited<ReturnType<typeof createClient>>,
  postIds: string[],
  viewerWallet?: string
): Promise<Map<string, PollWithResults>> {
  const pollMap = new Map<string, PollWithResults>()
  if (postIds.length === 0) return pollMap

  const { data: allPolls } = await supabase
    .from("post_polls")
    .select("*")
    .in("post_id", postIds)

  if (!allPolls || allPolls.length === 0) return pollMap

  const pollIds = allPolls.map((p: Record<string, unknown>) => p.id as string)

  const { data: allVotes } = await supabase
    .from("poll_votes")
    .select("*")
    .in("poll_id", pollIds)

  for (const poll of allPolls) {
    const options = poll.options as string[]
    const pollVotes = (allVotes || []).filter(
      (v: Record<string, unknown>) => v.poll_id === poll.id
    )
    const voteCounts = new Array(options.length).fill(0)

    for (const vote of pollVotes) {
      for (const optIdx of vote.selected_options as number[]) {
        if (optIdx >= 0 && optIdx < voteCounts.length) {
          voteCounts[optIdx]++
        }
      }
    }

    const viewerVote = viewerWallet
      ? pollVotes.find(
          (v: Record<string, unknown>) =>
            (v.wallet_address as string) === viewerWallet.toLowerCase()
        )
      : null

    pollMap.set(poll.post_id as string, {
      id: poll.id as string,
      post_id: poll.post_id as string,
      poll_type: poll.poll_type as "single" | "multi",
      options,
      expires_at: poll.expires_at as string,
      created_at: poll.created_at as string,
      total_votes: pollVotes.length,
      vote_counts: voteCounts,
      viewer_vote: viewerVote ? (viewerVote.selected_options as number[]) : null,
      is_expired: new Date(poll.expires_at as string) < new Date(),
    })
  }

  return pollMap
}

// ============================================
// Read operations
// ============================================

export interface GetPostsForFeedOptions {
  limit?: number
  offset?: number
  viewerWallet?: string
  feedType?: FeedType
  category?: string
}

export async function getPostsForFeed(
  options: GetPostsForFeedOptions = {}
): Promise<{ success: boolean; data?: PostWithEngagement[]; error?: string }> {
  const { limit = 20, offset = 0, feedType } = options

  // Record mode: no account_id/wallet_address/poll/link tables exist — every
  // viewer-specific or Supabase-only field gets an explicit, honest neutral
  // instead of being fabricated. category has no record equivalent (Nostr
  // posts carry no PostCategory tag) so it falls back to "generell", the
  // same "no specific category" value the Supabase branch below already uses
  // — PostCard only shows the category badge when it is NOT "generell", so
  // this neutral is naturally hidden rather than rendering a fake badge.
  // wallet_address doubles as PostCard's existing agent/bot signal
  // (`isMecky = wallet_address === "mecky_bot"`) — is_agent is preserved onto
  // it rather than dropped, so machine speech stays labelled. A real wallet
  // is never fabricated (never render a raw address); personal AND org posts
  // both flow through author_username so the correct display name still
  // shows, at the cost of the org sub-type pill (no on-chain signal exists
  // to pick "Gewerbe"/"Verein"/"Stadt"/"Fraktion" honestly).
  if (!hasSupabase) {
    try {
      const posts = await listPosts(recordClient, { limit: offset + limit })
      // listPosts gives no ordering guarantee — sort desc by created_at to
      // match the Supabase branch's own ordering before slicing the page.
      posts.sort((a, b) => b.created_at.localeCompare(a.created_at))
      const page = posts.slice(offset, offset + limit)
      const data: PostWithEngagement[] = page.map((p) => ({
        id: p.id,
        wallet_address: p.is_agent ? "mecky_bot" : "",
        account_id: null,
        content: p.content,
        media_urls: p.media_urls,
        video_url: null,
        category: "generell" as PostCategory,
        status: "published" as Post["status"],
        likes_count: p.likes_count,
        comments_count: p.comments_count,
        created_at: p.created_at,
        updated_at: p.created_at,
        post_type: "user" as PostType,
        feed_type: (feedType ?? "main") as FeedType,
        linked_event_id: null,
        linked_experience_id: null,
        author_username: p.author_name ?? "Unbekannt",
        author_profile_picture_url: p.author_avatar,
        author_neighborhood: null,
        author_account_name: null,
        author_account_avatar_url: null,
        author_account_type: null,
        links: [],
        is_liked_by_viewer: false,
        is_reported_by_viewer: false,
        poll: null,
        linked_event: null,
      }))
      return { success: true, data }
    } catch (error) {
      if (error instanceof RecordUnavailableError) return { success: true, data: [] }
      throw error
    }
  }

  const { viewerWallet, category } = options
  try {
    const supabase = await createClient()

    let query = supabase
      .from("posts")
      .select("*")
      .eq("status", "published")
      .order("created_at", { ascending: false })
      .range(offset, offset + limit - 1)

    if (feedType) {
      query = query.eq("feed_type", feedType)
    }

    if (category && category !== "all") {
      query = query.eq("category", category)
    }

    const { data: posts, error } = await query

    if (error) throw error
    if (!posts || posts.length === 0) {
      return { success: true, data: [] }
    }

    // Batch fetch author info
    const addresses = [...new Set(posts.map((p: Record<string, unknown>) => p.wallet_address as string))]
    const authorMap = new Map<string, Record<string, unknown>>()

    if (addresses.length > 0) {
      const { data: authors } = await supabase
        .from("users")
        .select("wallet_address, username, profile_picture_url, neighborhood")
        .in("wallet_address", addresses)

      for (const a of authors || []) {
        authorMap.set(a.wallet_address as string, a as Record<string, unknown>)
      }
    }

    // Batch fetch post links
    const postIds = posts.map((p: Record<string, unknown>) => p.id as string)
    const { data: allLinks } = await supabase
      .from("post_links")
      .select("*")
      .in("post_id", postIds)

    const linksMap = new Map<string, PostLink[]>()
    for (const link of allLinks || []) {
      const pid = link.post_id as string
      if (!linksMap.has(pid)) linksMap.set(pid, [])
      linksMap.get(pid)!.push({
        id: link.id as string,
        post_id: pid,
        url: link.url as string,
        og_title: link.og_title as string | null,
        og_description: link.og_description as string | null,
        og_image: link.og_image as string | null,
        og_site_name: link.og_site_name as string | null,
      })
    }

    // Batch check viewer likes
    const likedSet = new Set<string>()
    if (viewerWallet && postIds.length > 0) {
      const { data: likes } = await supabase
        .from("post_likes")
        .select("post_id")
        .eq("wallet_address", viewerWallet.toLowerCase())
        .in("post_id", postIds)

      for (const like of likes || []) {
        likedSet.add(like.post_id as string)
      }
    }

    // Batch check viewer reports
    const reportedSet = new Set<string>()
    if (viewerWallet && postIds.length > 0) {
      const { data: reports } = await supabase
        .from("post_reports")
        .select("post_id")
        .eq("reporter_wallet_address", viewerWallet.toLowerCase())
        .in("post_id", postIds)

      for (const report of reports || []) {
        reportedSet.add(report.post_id as string)
      }
    }

    // Batch fetch polls
    const pollMap = await buildPollMap(supabase, postIds, viewerWallet)

    // Batch fetch account info for posts with account_id
    const accountIds = [...new Set(
      posts
        .map((p: Record<string, unknown>) => p.account_id as string | null)
        .filter(Boolean)
    )] as string[]
    const accountMap = new Map<string, Record<string, unknown>>()

    if (accountIds.length > 0) {
      const { data: accounts } = await supabase
        .from("accounts")
        .select("id, name, avatar_url, account_type")
        .in("id", accountIds)

      for (const acc of accounts || []) {
        accountMap.set(acc.id as string, acc as Record<string, unknown>)
      }
    }

    // Batch fetch linked events for event_experience posts
    const linkedEventIds = [...new Set(
      posts
        .filter(
          (p: Record<string, unknown>) =>
            (p.post_type as string) === "event_experience" && p.linked_event_id
        )
        .map((p: Record<string, unknown>) => p.linked_event_id as string)
    )]
    const eventMap = new Map<string, LinkedEventPreview>()
    if (linkedEventIds.length > 0) {
      const { data: events } = await supabase
        .from("events")
        .select("id, title, date, time, location, image_url")
        .in("id", linkedEventIds)
      for (const e of events || []) {
        eventMap.set(e.id as string, {
          id: e.id as string,
          title: e.title as string,
          date: e.date as string,
          time: (e.time as string) || null,
          location: e.location as string,
          image_url: (e.image_url as string) || null,
        })
      }
    }

    const result: PostWithEngagement[] = posts.map((row: Record<string, unknown>) => {
      const author = authorMap.get(row.wallet_address as string)
      const account = row.account_id ? accountMap.get(row.account_id as string) : null
      const linkedEventId = (row.linked_event_id as string) || null
      return {
        id: row.id as string,
        wallet_address: row.wallet_address as string,
        account_id: (row.account_id as string) || null,
        content: row.content as string,
        media_urls: (row.media_urls as string[]) || [],
        video_url: (row.video_url as string) || null,
        category: ((row.category as string) || "generell") as PostCategory,
        status: row.status as Post["status"],
        likes_count: (row.likes_count as number) || 0,
        comments_count: (row.comments_count as number) || 0,
        created_at: row.created_at as string,
        updated_at: row.updated_at as string,
        post_type: ((row.post_type as string) || "user") as PostType,
        feed_type: ((row.feed_type as string) || "main") as FeedType,
        linked_event_id: linkedEventId,
        linked_experience_id: (row.linked_experience_id as string) || null,
        author_username: (author?.username as string) || null,
        author_profile_picture_url: (author?.profile_picture_url as string) || null,
        author_neighborhood: (author?.neighborhood as string) || null,
        author_account_name: (account?.name as string) || null,
        author_account_avatar_url: (account?.avatar_url as string) || null,
        author_account_type: (account?.account_type as string) || null,
        links: linksMap.get(row.id as string) || [],
        is_liked_by_viewer: likedSet.has(row.id as string),
        is_reported_by_viewer: reportedSet.has(row.id as string),
        poll: pollMap.get(row.id as string) || null,
        linked_event: linkedEventId ? eventMap.get(linkedEventId) ?? null : null,
      }
    })

    return { success: true, data: result }
  } catch (error) {
    console.error("Error fetching posts:", error)
    return { success: false, error: "Fehler beim Laden der Beiträge" }
  }
}

export async function getPostById(
  postId: string,
  viewerWallet?: string
): Promise<{ success: boolean; data?: PostWithEngagement; error?: string }> {
  try {
    const supabase = await createClient()

    const { data: post, error } = await supabase
      .from("posts")
      .select("*")
      .eq("id", postId)
      .eq("status", "published")
      .single()

    if (error || !post) return { success: false, error: "Beitrag nicht gefunden" }

    // Fetch author
    const { data: author } = await supabase
      .from("users")
      .select("wallet_address, username, profile_picture_url, neighborhood")
      .eq("wallet_address", post.wallet_address as string)
      .single()

    // Fetch links
    const { data: links } = await supabase
      .from("post_links")
      .select("*")
      .eq("post_id", postId)

    const postLinks: PostLink[] = (links || []).map((link: Record<string, unknown>) => ({
      id: link.id as string,
      post_id: link.post_id as string,
      url: link.url as string,
      og_title: link.og_title as string | null,
      og_description: link.og_description as string | null,
      og_image: link.og_image as string | null,
      og_site_name: link.og_site_name as string | null,
    }))

    // Fetch poll
    const pollMap = await buildPollMap(supabase, [postId], viewerWallet)

    // Fetch account info if post has account_id
    let accountData: Record<string, unknown> | null = null
    if (post.account_id) {
      const { data: acc } = await supabase
        .from("accounts")
        .select("id, name, avatar_url, account_type")
        .eq("id", post.account_id as string)
        .single()
      accountData = acc as Record<string, unknown> | null
    }

    // Fetch linked event preview for event_experience posts
    let linkedEvent: LinkedEventPreview | null = null
    if (
      (post.post_type as string) === "event_experience" &&
      post.linked_event_id
    ) {
      const { data: ev } = await supabase
        .from("events")
        .select("id, title, date, time, location, image_url")
        .eq("id", post.linked_event_id as string)
        .single()
      if (ev) {
        linkedEvent = {
          id: ev.id as string,
          title: ev.title as string,
          date: ev.date as string,
          time: (ev.time as string) || null,
          location: ev.location as string,
          image_url: (ev.image_url as string) || null,
        }
      }
    }

    // Check viewer like
    let isLiked = false
    let isReported = false
    if (viewerWallet) {
      const [likeResult, reportResult] = await Promise.all([
        supabase
          .from("post_likes")
          .select("id")
          .eq("post_id", postId)
          .eq("wallet_address", viewerWallet.toLowerCase())
          .single(),
        supabase
          .from("post_reports")
          .select("id")
          .eq("post_id", postId)
          .eq("reporter_wallet_address", viewerWallet.toLowerCase())
          .single(),
      ])
      isLiked = !!likeResult.data
      isReported = !!reportResult.data
    }

    return {
      success: true,
      data: {
        id: post.id as string,
        wallet_address: post.wallet_address as string,
        account_id: (post.account_id as string) || null,
        content: post.content as string,
        media_urls: (post.media_urls as string[]) || [],
        video_url: (post.video_url as string) || null,
        category: ((post.category as string) || "generell") as PostCategory,
        status: post.status as Post["status"],
        likes_count: (post.likes_count as number) || 0,
        comments_count: (post.comments_count as number) || 0,
        created_at: post.created_at as string,
        updated_at: post.updated_at as string,
        post_type: ((post.post_type as string) || "user") as PostType,
        feed_type: ((post.feed_type as string) || "main") as FeedType,
        linked_event_id: (post.linked_event_id as string) || null,
        linked_experience_id: (post.linked_experience_id as string) || null,
        author_username: (author?.username as string) || null,
        author_profile_picture_url: (author?.profile_picture_url as string) || null,
        author_neighborhood: (author?.neighborhood as string) || null,
        author_account_name: (accountData?.name as string) || null,
        author_account_avatar_url: (accountData?.avatar_url as string) || null,
        author_account_type: (accountData?.account_type as string) || null,
        links: postLinks,
        is_liked_by_viewer: isLiked,
        is_reported_by_viewer: isReported,
        poll: pollMap.get(postId) || null,
        linked_event: linkedEvent,
      },
    }
  } catch (error) {
    console.error("Error fetching post:", error)
    return { success: false, error: "Fehler beim Laden des Beitrags" }
  }
}

// ============================================
// Write operations
// ============================================

export async function createPost(
  input: CreatePostInput
): Promise<{ success: boolean; data?: Post; error?: string }> {
  try {
    const supabase = await createClient()

    // Authoritative gate: only verified citizens (or attesters) may post.
    // Org accounts can post if the caller owns the org — the org itself is a
    // verified entity. This mirrors the client-side gate in PostComposer but
    // is the real boundary, since the server action is directly callable.
    if (!input.wallet_address) {
      return { success: false, error: "Nicht angemeldet" }
    }

    let allowed = await isVerifiedCitizen(input.wallet_address)

    if (!allowed && input.account_id) {
      const account = await fetchAccountById(input.account_id)
      allowed =
        !!account &&
        isOrgAccount(account) &&
        (await isAccountOwner(input.account_id, input.wallet_address))
    }

    if (!allowed) {
      return {
        success: false,
        error: "Nur verifizierte Bürger können Beiträge erstellen",
      }
    }

    const { data: post, error } = await supabase
      .from("posts")
      .insert({
        wallet_address: input.wallet_address.toLowerCase(),
        account_id: input.account_id || null,
        content: input.content,
        category: input.category || "generell",
        feed_type: input.feed_type || "main",
        media_urls: input.media_urls || [],
        video_url: input.video_url || null,
      })
      .select()
      .single()

    if (error) throw error

    // Create poll if provided
    if (input.poll) {
      const expiresAt = new Date()
      expiresAt.setDate(expiresAt.getDate() + input.poll.duration_days)

      await supabase.from("post_polls").insert({
        post_id: post.id,
        poll_type: input.poll.poll_type,
        options: input.poll.options,
        expires_at: expiresAt.toISOString(),
      })
    }

    // Fetch and store OG metadata for any URLs
    if (input.link_urls && input.link_urls.length > 0) {
      const ogPromises = input.link_urls.map(async (url) => {
        try {
          const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || "http://localhost:3000"
          const res = await fetch(`${baseUrl}/api/og-metadata?url=${encodeURIComponent(url)}`)
          const json = await res.json()
          if (json.success && json.data) {
            await supabase.from("post_links").insert({
              post_id: post.id,
              url: json.data.url,
              og_title: json.data.title,
              og_description: json.data.description,
              og_image: json.data.image,
              og_site_name: json.data.siteName,
            })
          }
        } catch (err) {
          console.error("Error fetching OG metadata for", url, err)
        }
      })

      await Promise.allSettled(ogPromises)
    }

    // Fetch author profile picture for notification
    const { data: author } = await supabase
      .from("users")
      .select("profile_picture_url")
      .eq("wallet_address", input.wallet_address.toLowerCase())
      .single()

    // Create activity notification
    createAppNotification({
      type: "post_new",
      title: "Neuer Beitrag",
      body: post.content?.substring(0, 120) || null,
      link: `/app/posts/${post.id}`,
      reference_id: post.id,
      image_url: author?.profile_picture_url || null,
    }).catch(console.error)

    revalidatePath("/app")

    return {
      success: true,
      data: {
        id: post.id,
        wallet_address: post.wallet_address,
        account_id: post.account_id || null,
        content: post.content,
        media_urls: post.media_urls || [],
        video_url: post.video_url,
        category: post.category || "generell",
        status: post.status,
        likes_count: post.likes_count,
        comments_count: post.comments_count,
        created_at: post.created_at,
        updated_at: post.updated_at,
        post_type: (post.post_type as PostType) || "user",
        feed_type: ((post.feed_type as string) || "main") as FeedType,
        linked_event_id: post.linked_event_id || null,
        linked_experience_id: post.linked_experience_id || null,
      },
    }
  } catch (error) {
    console.error("Error creating post:", error)
    return { success: false, error: "Fehler beim Erstellen des Beitrags" }
  }
}

export async function deletePost(
  postId: string,
  walletAddress: string
): Promise<{ success: boolean; error?: string }> {
  try {
    const supabase = await createClient()
    const wallet = walletAddress.toLowerCase()

    // Fetch the post to check ownership
    const { data: post } = await supabase
      .from("posts")
      .select("id, wallet_address, account_id")
      .eq("id", postId)
      .single()

    if (!post) {
      return { success: false, error: "Beitrag nicht gefunden" }
    }

    // Allow deletion if caller owns the wallet OR is an owner of the post's account
    let canDelete = post.wallet_address === wallet
    if (!canDelete && post.account_id) {
      canDelete = await isAccountOwner(post.account_id, wallet)
    }

    if (!canDelete) {
      return { success: false, error: "Keine Berechtigung zum Löschen" }
    }

    const { error } = await supabase
      .from("posts")
      .update({ status: "deleted", updated_at: new Date().toISOString() })
      .eq("id", postId)

    if (error) throw error

    revalidatePath("/app")
    return { success: true }
  } catch (error) {
    console.error("Error deleting post:", error)
    return { success: false, error: "Fehler beim Löschen des Beitrags" }
  }
}

// ============================================
// Polls
// ============================================

export async function votePoll(
  pollId: string,
  walletAddress: string,
  selectedOptions: number[]
): Promise<{ success: boolean; error?: string }> {
  try {
    const supabase = await createClient()
    const wallet = walletAddress.toLowerCase()

    // Check poll exists and not expired
    const { data: poll, error: pollError } = await supabase
      .from("post_polls")
      .select("*")
      .eq("id", pollId)
      .single()

    if (pollError || !poll) return { success: false, error: "Umfrage nicht gefunden" }
    if (new Date(poll.expires_at as string) < new Date()) {
      return { success: false, error: "Umfrage ist abgelaufen" }
    }

    // Validate selection
    const options = poll.options as string[]
    if (selectedOptions.length === 0) {
      return { success: false, error: "Bitte wähle mindestens eine Option" }
    }
    if (poll.poll_type === "single" && selectedOptions.length !== 1) {
      return { success: false, error: "Bitte wähle genau eine Option" }
    }
    if (selectedOptions.some((i) => i < 0 || i >= options.length)) {
      return { success: false, error: "Ungültige Auswahl" }
    }

    // Insert vote (unique constraint handles duplicates)
    const { error: voteError } = await supabase.from("poll_votes").insert({
      poll_id: pollId,
      wallet_address: wallet,
      selected_options: selectedOptions,
    })

    if (voteError) {
      if (voteError.code === "23505") {
        return { success: false, error: "Du hast bereits abgestimmt" }
      }
      throw voteError
    }

    return { success: true }
  } catch (error) {
    console.error("Error voting:", error)
    return { success: false, error: "Fehler bei der Abstimmung" }
  }
}

// ============================================
// Comments
// ============================================

export async function getComments(
  postId: string,
  limit = 20,
  offset = 0
): Promise<{ success: boolean; data?: PostComment[]; error?: string }> {
  try {
    const supabase = await createClient()

    const { data: comments, error } = await supabase
      .from("post_comments")
      .select("*")
      .eq("post_id", postId)
      .eq("status", "published")
      .order("created_at", { ascending: true })
      .range(offset, offset + limit - 1)

    if (error) throw error
    if (!comments || comments.length === 0) {
      return { success: true, data: [] }
    }

    // Batch fetch author info
    const addresses = [...new Set(comments.map((c: Record<string, unknown>) => c.wallet_address as string))]
    const authorMap = new Map<string, Record<string, unknown>>()

    if (addresses.length > 0) {
      const { data: authors } = await supabase
        .from("users")
        .select("wallet_address, username, profile_picture_url")
        .in("wallet_address", addresses)

      for (const a of authors || []) {
        authorMap.set(a.wallet_address as string, a as Record<string, unknown>)
      }
    }

    const result: PostComment[] = comments.map((row: Record<string, unknown>) => {
      const author = authorMap.get(row.wallet_address as string)
      return {
        id: row.id as string,
        post_id: row.post_id as string,
        wallet_address: row.wallet_address as string,
        account_id: (row.account_id as string) || null,
        content: row.content as string,
        media_urls: (row.media_urls as string[]) || [],
        video_url: (row.video_url as string) || null,
        status: row.status as PostComment["status"],
        created_at: row.created_at as string,
        author_username: (author?.username as string) || null,
        author_profile_picture_url: (author?.profile_picture_url as string) || null,
      }
    })

    return { success: true, data: result }
  } catch (error) {
    console.error("Error fetching comments:", error)
    return { success: false, error: "Fehler beim Laden der Kommentare" }
  }
}

export async function createComment(
  input: CreateCommentInput
): Promise<{ success: boolean; data?: PostComment; error?: string }> {
  try {
    const supabase = await createClient()

    const { data: comment, error } = await supabase
      .from("post_comments")
      .insert({
        post_id: input.post_id,
        wallet_address: input.wallet_address.toLowerCase(),
        account_id: input.account_id || null,
        content: input.content,
        media_urls: input.media_urls || [],
        video_url: input.video_url || null,
      })
      .select()
      .single()

    if (error) throw error

    // Increment comments count
    await supabase.rpc("increment_post_comments", { p_post_id: input.post_id })

    // Fetch author info
    const { data: author } = await supabase
      .from("users")
      .select("username, profile_picture_url")
      .eq("wallet_address", input.wallet_address.toLowerCase())
      .single()

    return {
      success: true,
      data: {
        id: comment.id,
        post_id: comment.post_id,
        wallet_address: comment.wallet_address,
        account_id: comment.account_id || null,
        content: comment.content,
        media_urls: comment.media_urls || [],
        video_url: comment.video_url || null,
        status: comment.status,
        created_at: comment.created_at,
        author_username: author?.username || null,
        author_profile_picture_url: author?.profile_picture_url || null,
      },
    }
  } catch (error) {
    console.error("Error creating comment:", error)
    return { success: false, error: "Fehler beim Erstellen des Kommentars" }
  }
}

// ============================================
// Reports
// ============================================

export async function reportPost(
  postId: string,
  walletAddress: string,
  reason?: string
): Promise<{ success: boolean; error?: string }> {
  try {
    const supabase = await createClient()
    const { data, error } = await supabase.rpc("report_post", {
      p_post_id: postId,
      p_wallet_address: walletAddress,
      p_reason: reason || null,
    })

    if (error) {
      if (error.code === "23505") {
        return { success: false, error: "Du hast diesen Beitrag bereits gemeldet" }
      }
      throw error
    }

    revalidatePath("/app")
    return { success: true }
  } catch (error) {
    console.error("Error reporting post:", error)
    return { success: false, error: "Fehler beim Melden des Beitrags" }
  }
}

// ============================================
// Likes
// ============================================

export async function toggleLike(
  postId: string,
  walletAddress: string
): Promise<{ success: boolean; data?: { liked: boolean; newCount: number }; error?: string }> {
  try {
    const supabase = await createClient()
    const wallet = walletAddress.toLowerCase()

    // Check if already liked
    const { data: existing } = await supabase
      .from("post_likes")
      .select("id")
      .eq("post_id", postId)
      .eq("wallet_address", wallet)
      .single()

    if (existing) {
      // Unlike
      await supabase
        .from("post_likes")
        .delete()
        .eq("post_id", postId)
        .eq("wallet_address", wallet)

      await supabase.rpc("decrement_post_likes", { p_post_id: postId })

      const { data: post } = await supabase
        .from("posts")
        .select("likes_count")
        .eq("id", postId)
        .single()

      return { success: true, data: { liked: false, newCount: post?.likes_count || 0 } }
    } else {
      // Like
      await supabase
        .from("post_likes")
        .insert({ post_id: postId, wallet_address: wallet })

      await supabase.rpc("increment_post_likes", { p_post_id: postId })

      const { data: post } = await supabase
        .from("posts")
        .select("likes_count")
        .eq("id", postId)
        .single()

      return { success: true, data: { liked: true, newCount: post?.likes_count || 0 } }
    }
  } catch (error) {
    console.error("Error toggling like:", error)
    return { success: false, error: "Fehler beim Liken" }
  }
}
