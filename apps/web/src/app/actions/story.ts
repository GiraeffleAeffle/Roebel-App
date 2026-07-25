"use server";

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { buildStoryTeaserPost } from "@/lib/story/feed-post";
import { createConversation } from "@/lib/mecky/conversation-store";

/**
 * Starts a new "Story mit Mecky" interview conversation for the dashboard
 * flow (`/dashboard/stories`). Thin wrapper around the shared Mecky
 * conversation store, scoped to `kind: "story"` + the org account so the
 * transcript can later be turned into a `blog_articles` draft via
 * `POST /api/mecky/story-draft`.
 */
export async function startStoryConversation(
  accountId: string,
  walletAddress: string,
): Promise<{ success: boolean; conversationId?: string; error?: string }> {
  if (!accountId || !walletAddress) {
    return { success: false, error: "Konto oder Wallet fehlt" };
  }

  const result = await createConversation(walletAddress.toLowerCase(), {
    kind: "story",
    accountId,
  });

  if (!result.success || !result.conversationId) {
    return { success: false, error: result.error ?? "Konversation konnte nicht gestartet werden" };
  }

  return { success: true, conversationId: result.conversationId };
}

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
    if (owner.role !== "owner" && owner.role !== "admin") {
      return { success: false, error: "Nur Inhaber:innen oder Admins dürfen veröffentlichen." };
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

    // Best-effort from here on: the article is ALREADY published at this
    // point (the primary success criterion). The teaser post / post_links /
    // notification are secondary side-effects — a failure in any of them
    // must never turn an already-published article into `{success:false}`.
    // Both are also gated on `!alreadyPublished` so a re-publish (double-tap
    // / re-hitting this action on an already-published article) does not
    // insert a duplicate feed post or fire a second community notification.
    let postId: string | undefined;
    if (!alreadyPublished) {
      try {
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
        } else {
          postId = insertedPost.id as string;

          const { error: linkErr } = await admin.from("post_links").insert({
            post_id: postId,
            ...link,
          });

          if (linkErr) {
            console.error("[publishStory] post_links insert failed", linkErr);
          }
        }
      } catch (teaserError) {
        console.error("[publishStory] teaser post pipeline failed", teaserError);
      }

      // `createAppNotification` reads a cookie/request-scoped Supabase client
      // (`@/lib/supabase/server`). Called server-to-server from Expo (no
      // Next.js session/cookies), that client silently drops the insert — no
      // error surfaces, the notification just never lands. Use the admin
      // client already in scope here instead, writing the same columns
      // `createAppNotification` would. Best-effort: never turn an
      // already-published article into a failure.
      try {
        const { error: notifErr } = await admin.from("app_notifications").insert({
          type: "story_new",
          title: "Neue Geschichte aus Röbel",
          body: null,
          link: `/app/blog/${articleId}`,
          image_url: article.cover_image_url ?? null,
        });
        if (notifErr) {
          console.error("[publishStory] app_notifications insert failed", notifErr);
        }
      } catch (notifError) {
        console.error("[publishStory] notification insert failed", notifError);
      }
    }

    revalidatePath("/app");
    revalidatePath("/app/blog");
    revalidatePath(`/app/blog/${articleId}`);

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
