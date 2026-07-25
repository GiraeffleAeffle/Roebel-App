"use server";

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { createAppNotification } from "@/app/actions/app-notifications";
import { buildStoryTeaserPost } from "@/lib/story/feed-post";

/**
 * Publishes a Plan-B story article: flips the `blog_articles` row to
 * published (stamping `published_at` only on the FIRST publish), inserts a
 * teaser `posts` row (+ `post_links`) into the main feed, fires a
 * `story_new` app notification, and revalidates the affected paths.
 *
 * Owner check mirrors `POST /api/mecky/story-draft` (personal + org — any
 * `account_owners` row for (accountId, wallet) is sufficient; no
 * account_type gate).
 */
export async function publishStory(
  articleId: string,
  accountId: string,
  walletAddress: string,
): Promise<{ success: boolean; error?: string; postId?: string }> {
  try {
    const admin = createAdminClient();
    const wallet = walletAddress.toLowerCase();

    const { data: owner, error: ownerErr } = await admin
      .from("account_owners")
      .select("role")
      .eq("account_id", accountId)
      .eq("wallet_address", wallet)
      .maybeSingle();

    if (ownerErr) {
      console.error("[publishStory] owner check failed", ownerErr);
      return { success: false, error: "Fehler bei der Berechtigungsprüfung." };
    }
    if (!owner) {
      return { success: false, error: "Keine Berechtigung für dieses Konto" };
    }

    const { data: article, error: articleErr } = await admin
      .from("blog_articles")
      .select("id, account_id, title, excerpt, cover_image_url, status")
      .eq("id", articleId)
      .maybeSingle();

    if (articleErr) {
      console.error("[publishStory] article lookup failed", articleErr);
      return { success: false, error: "Fehler beim Laden des Artikels." };
    }
    if (!article) {
      return { success: false, error: "Artikel nicht gefunden" };
    }
    if (article.account_id !== accountId) {
      return { success: false, error: "Artikel gehört nicht zu diesem Konto" };
    }

    const alreadyPublished = article.status === "published";
    const publishedAt = alreadyPublished ? undefined : new Date().toISOString();

    const { error: updateErr } = await admin
      .from("blog_articles")
      .update({
        status: "published",
        ...(publishedAt ? { published_at: publishedAt } : {}),
      })
      .eq("id", articleId);

    if (updateErr) {
      console.error("[publishStory] status update failed", updateErr);
      return { success: false, error: "Artikel konnte nicht veröffentlicht werden." };
    }

    const { post, link } = buildStoryTeaserPost(
      {
        id: articleId,
        title: article.title,
        excerpt: article.excerpt ?? "",
        cover_image_url: article.cover_image_url ?? null,
      },
      { accountId, walletAddress: wallet },
    );

    const { data: insertedPost, error: postErr } = await admin
      .from("posts")
      .insert(post)
      .select("id")
      .single();

    if (postErr || !insertedPost) {
      console.error("[publishStory] teaser post insert failed", postErr);
      return { success: false, error: "Beitrag im Feed konnte nicht erstellt werden." };
    }

    const postId = insertedPost.id as string;

    const { error: linkErr } = await admin.from("post_links").insert({
      post_id: postId,
      ...link,
    });

    if (linkErr) {
      console.error("[publishStory] post_links insert failed", linkErr);
      // Non-fatal — the teaser post already exists in the feed.
    }

    createAppNotification({
      type: "story_new",
      title: "Neue Geschichte aus Röbel",
      link: `/app/blog/${articleId}`,
      image_url: article.cover_image_url ?? undefined,
    }).catch(console.error);

    revalidatePath("/app");
    revalidatePath("/app/blog");

    return { success: true, postId };
  } catch (error) {
    console.error("[publishStory] failed", error);
    return { success: false, error: "Fehler beim Veröffentlichen der Geschichte." };
  }
}

/**
 * Loads the draft `blog_articles` row linked to a Mecky story conversation,
 * for the story editor. Owner-scoped by the conversation's `owner_wallet`.
 */
export async function getStoryDraftArticle(
  conversationId: string,
  walletAddress: string,
): Promise<{ success: boolean; article?: Record<string, unknown>; error?: string }> {
  try {
    const admin = createAdminClient();
    const wallet = walletAddress.toLowerCase();

    const { data: conversation, error: convErr } = await admin
      .from("mecky_conversations")
      .select("id, owner_wallet, draft_article_id")
      .eq("id", conversationId)
      .maybeSingle();

    if (convErr) {
      console.error("[getStoryDraftArticle] conversation lookup failed", convErr);
      return { success: false, error: "Fehler beim Laden der Konversation." };
    }
    if (!conversation) {
      return { success: false, error: "Konversation nicht gefunden" };
    }
    if (conversation.owner_wallet !== wallet) {
      return { success: false, error: "Keine Berechtigung für diese Konversation" };
    }
    if (!conversation.draft_article_id) {
      return { success: false, error: "Noch kein Artikelentwurf vorhanden" };
    }

    const { data: article, error: articleErr } = await admin
      .from("blog_articles")
      .select("*")
      .eq("id", conversation.draft_article_id)
      .maybeSingle();

    if (articleErr) {
      console.error("[getStoryDraftArticle] article lookup failed", articleErr);
      return { success: false, error: "Fehler beim Laden des Artikels." };
    }
    if (!article) {
      return { success: false, error: "Artikel nicht gefunden" };
    }

    return { success: true, article };
  } catch (error) {
    console.error("[getStoryDraftArticle] failed", error);
    return { success: false, error: "Fehler beim Laden des Artikelentwurfs." };
  }
}
