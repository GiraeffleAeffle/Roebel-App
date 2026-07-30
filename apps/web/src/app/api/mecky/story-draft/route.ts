/**
 * POST /api/mecky/story-draft — turn a saved Mecky interview conversation
 * into a `blog_articles` DRAFT via Opus.
 *
 * Body: { conversationId, subject, accountId, authorAccountId, walletAddress }
 * 200 → { success: true, articleId, slug }
 * 4xx/5xx → { success: false, error } (German)
 */
import { NextResponse } from "next/server";
import { generateObject } from "ai";
import { anthropic } from "@ai-sdk/anthropic";
import { createAdminClient } from "@/lib/supabase/admin";
import { createStoryDraft, type DraftSources, type GenerateDraft } from "@/lib/story/draft";
import { getConversationMessages, setDraftArticleId } from "@/lib/mecky/conversation-store";
import { generateSlug } from "@/lib/slug";
import {
  ARTICLE_DRAFT_SCHEMA,
  STORY_INTERVIEW_SYSTEM,
  buildDraftPrompt,
  type StorySubject,
} from "@/lib/story/prompts";

export const runtime = "nodejs";
export const maxDuration = 60;

// NOTE: `uniqueSlug` in app/actions/blog.ts is a private, unexported helper
// (also duplicated in app/actions/documentation.ts) — there is no shared
// export in `@/lib/slug` to import. Mirrored inline here against `blog_articles`
// scoped by account_id, using the admin client (this route has no request-scoped
// server client).
async function uniqueSlug(
  admin: ReturnType<typeof createAdminClient>,
  accountId: string,
  base: string,
): Promise<string> {
  const baseSlug = base || "artikel";
  let slug = baseSlug;
  let n = 1;
  for (;;) {
    const { data, error } = await admin
      .from("blog_articles")
      .select("id")
      .eq("account_id", accountId)
      .eq("slug", slug)
      .limit(1);
    if (error) {
      throw new Error(error.message);
    }
    if (!data || data.length === 0) return slug;
    n += 1;
    slug = `${baseSlug}-${n}`;
  }
}

const generateDraft: GenerateDraft = async (subject, transcript) => {
  const { object } = await generateObject({
    model: anthropic("claude-opus-4-8"),
    schema: ARTICLE_DRAFT_SCHEMA,
    system: STORY_INTERVIEW_SYSTEM,
    prompt: buildDraftPrompt(subject, transcript),
  });
  return object;
};

export async function POST(request: Request) {
  let body: {
    conversationId?: string;
    subject?: StorySubject;
    accountId?: string;
    authorAccountId?: string;
    walletAddress?: string;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ success: false, error: "Ungültige Anfrage" }, { status: 400 });
  }

  const { conversationId, subject, accountId, authorAccountId, walletAddress } = body;
  if (!conversationId || !subject || !accountId || !authorAccountId || !walletAddress) {
    return NextResponse.json({ success: false, error: "Pflichtfelder fehlen" }, { status: 400 });
  }

  try {
    const admin = createAdminClient();

    const wallet = walletAddress.toLowerCase();

    // Owner check: allow BOTH personal + org accounts — any row in
    // account_owners for this (accountId, wallet) is sufficient.
    const { data: owner, error: ownerErr } = await admin
      .from("account_owners")
      .select("role")
      .eq("account_id", accountId)
      .eq("wallet_address", wallet)
      .maybeSingle();

    if (ownerErr) {
      console.error("[api/mecky/story-draft] owner check failed", ownerErr);
      return NextResponse.json(
        { success: false, error: "Fehler bei der Berechtigungsprüfung." },
        { status: 500 },
      );
    }
    if (!owner) {
      return NextResponse.json(
        { success: false, error: "Keine Berechtigung für dieses Konto" },
        { status: 403 },
      );
    }
    if (owner.role !== "owner" && owner.role !== "admin") {
      return NextResponse.json(
        { success: false, error: "Nur Inhaber:innen oder Admins dürfen Artikel erstellen." },
        { status: 403 },
      );
    }

    // Byline check: the caller must ALSO own the account they're bylining the
    // draft to (authorAccountId), not just the account it's published under
    // (accountId) — otherwise a caller could spoof authorship of another
    // account's byline. Skip the second query when they're the same account
    // (already verified above).
    if (authorAccountId !== accountId) {
      const { data: authorOwner, error: authorOwnerErr } = await admin
        .from("account_owners")
        .select("role")
        .eq("account_id", authorAccountId)
        .eq("wallet_address", wallet)
        .maybeSingle();

      if (authorOwnerErr) {
        console.error("[api/mecky/story-draft] author owner check failed", authorOwnerErr);
        return NextResponse.json(
          { success: false, error: "Fehler bei der Berechtigungsprüfung." },
          { status: 500 },
        );
      }
      if (!authorOwner) {
        return NextResponse.json(
          { success: false, error: "Keine Berechtigung für das angegebene Autor:innen-Konto." },
          { status: 403 },
        );
      }
      if (authorOwner.role !== "owner" && authorOwner.role !== "admin") {
        return NextResponse.json(
          { success: false, error: "Keine Berechtigung für das angegebene Autor:innen-Konto." },
          { status: 403 },
        );
      }
    }

    const sources: DraftSources = {
      async loadTranscript(id) {
        const rows = await getConversationMessages(id);
        return rows.map((r) => ({ role: r.role, content: r.content }));
      },
      async createDraftArticle({ accountId: aId, authorAccountId: authorId, draft }) {
        const slug = await uniqueSlug(admin, aId, generateSlug(draft.title));
        const row = {
          account_id: aId,
          author_account_id: authorId,
          title: draft.title,
          slug,
          excerpt: draft.excerpt,
          content: draft.content_html,
          cover_image_url: null,
          category: draft.category,
          tags: draft.tags,
          status: "draft",
          published_at: null,
          // AI Act Art. 50(4): the article is AI-co-written; the flag drives
          // the visible "Mit KI erstellt" label wherever the story renders.
          ai_generated: true,
        };
        let { data, error } = await admin
          .from("blog_articles")
          .insert(row)
          .select("id, slug")
          .single();

        // Column not migrated yet: story creation must not break on the label.
        // The migration's backfill stamps this article once it runs.
        if (error && /ai_generated/.test(error.message)) {
          const { ai_generated: _flag, ...withoutFlag } = row;
          ({ data, error } = await admin
            .from("blog_articles")
            .insert(withoutFlag)
            .select("id, slug")
            .single());
        }

        if (error || !data) {
          throw new Error(error?.message ?? "Artikel konnte nicht erstellt werden");
        }
        return { articleId: data.id, slug: data.slug };
      },
      async linkDraft(id, articleId) {
        const { success, error } = await setDraftArticleId(id, articleId);
        if (!success) {
          console.error("[api/mecky/story-draft] linkDraft failed", error);
          throw new Error(error ?? "Konversation konnte nicht mit dem Artikel verknüpft werden");
        }
      },
    };

    const result = await createStoryDraft(conversationId, subject, accountId, authorAccountId, {
      ...sources,
      generateDraft,
    });

    if (!result.ok) {
      if (result.reason === "empty_transcript") {
        return NextResponse.json(
          { success: false, error: "Das Interview ist noch zu kurz für einen Artikel." },
          { status: 400 },
        );
      }
      return NextResponse.json(
        { success: false, error: "Artikel konnte nicht erstellt werden" },
        { status: 500 },
      );
    }

    // Return the drafted title/excerpt so the client can preview the draft
    // (admin read bypasses the status='draft' RLS the anon client is blocked by).
    const { data: draftRow } = await admin
      .from("blog_articles")
      .select("title, excerpt")
      .eq("id", result.articleId)
      .maybeSingle();
    return NextResponse.json({
      success: true,
      articleId: result.articleId,
      slug: result.slug,
      title: draftRow?.title ?? null,
      excerpt: draftRow?.excerpt ?? null,
    });
  } catch (error) {
    console.error("[api/mecky/story-draft] failed", error);
    return NextResponse.json(
      { success: false, error: "Interner Fehler beim Erstellen des Artikels" },
      { status: 500 },
    );
  }
}
