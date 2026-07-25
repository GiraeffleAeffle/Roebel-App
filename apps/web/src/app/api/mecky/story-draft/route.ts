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
    const { data } = await admin
      .from("blog_articles")
      .select("id")
      .eq("account_id", accountId)
      .eq("slug", slug)
      .limit(1);
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

    // Owner check: allow BOTH personal + org accounts — any row in
    // account_owners for this (accountId, wallet) is sufficient.
    const { data: owner, error: ownerErr } = await admin
      .from("account_owners")
      .select("role")
      .eq("account_id", accountId)
      .eq("wallet_address", walletAddress.toLowerCase())
      .maybeSingle();

    if (ownerErr || !owner) {
      return NextResponse.json(
        { success: false, error: "Keine Berechtigung für dieses Konto" },
        { status: 403 },
      );
    }

    const sources: DraftSources = {
      async loadTranscript(id) {
        const rows = await getConversationMessages(id);
        return rows.map((r) => ({ role: r.role, content: r.content }));
      },
      async createDraftArticle({ accountId: aId, authorAccountId: authorId, draft }) {
        const slug = await uniqueSlug(admin, aId, generateSlug(draft.title));
        const { data, error } = await admin
          .from("blog_articles")
          .insert({
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
          })
          .select("id, slug")
          .single();

        if (error || !data) {
          throw new Error(error?.message ?? "Artikel konnte nicht erstellt werden");
        }
        return { articleId: data.id, slug: data.slug };
      },
      async linkDraft(id, articleId) {
        await setDraftArticleId(id, articleId);
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

    return NextResponse.json({ success: true, articleId: result.articleId, slug: result.slug });
  } catch (error) {
    console.error("[api/mecky/story-draft] failed", error);
    return NextResponse.json(
      { success: false, error: "Interner Fehler beim Erstellen des Artikels" },
      { status: 500 },
    );
  }
}
