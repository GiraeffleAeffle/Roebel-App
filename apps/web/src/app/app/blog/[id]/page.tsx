import { createClient } from "@/lib/supabase/server";
import { notFound } from "next/navigation";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ArrowLeft, Calendar, Eye } from "lucide-react";
import { SUB_TYPE_EMOJI, SUB_TYPE_LABELS, type OrgSubType } from "@/types/account";
import { hasSupabase, recordClient } from "@/lib/record";
import { listArticles, listOrgs, RecordUnavailableError } from "@netizen-labs/record-client";
import { MarkdownRenderer } from "@/components/proposals/MarkdownRenderer";

export const dynamic = "force-dynamic";

const ORG_SUB_TYPES = new Set<string>(Object.keys(SUB_TYPE_LABELS));

interface BlogArticleRow {
  id: string;
  title: string;
  excerpt: string | null;
  content: string;
  cover_image_url: string | null;
  category: string | null;
  tags: string[] | null;
  is_featured: boolean;
  view_count: number;
  published_at: string | null;
  account: {
    id: string;
    name: string;
    slug: string | null;
    avatar_url: string | null;
    sub_type: OrgSubType | null;
    is_verified: boolean;
    is_extern: boolean;
    extern_status: string | null;
  };
}

export default async function BlogArticlePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  if (!hasSupabase) {
    // listArticles has no getArticleById sibling (unlike events/news) — one
    // fetch, find by id, matching the brief's "find by id in the list
    // result" pattern already used for marketplace.
    let article: Awaited<ReturnType<typeof listArticles>>[number] | null = null;
    let orgName: string | null = null;
    let orgSlug: string | null = null;
    let orgSubType: OrgSubType | null = null;
    try {
      const articles = await listArticles(recordClient, { limit: 200 });
      article = articles.find((a) => a.id === id) ?? null;
      if (!article) notFound();
      // ArticleRow carries the signing pubkey, not an account id — resolve
      // the byline by joining back to the org roster (same pubkey rule
      // OrgDetailClient's own blogArticlesForOrg helper uses).
      const orgs = await listOrgs(recordClient);
      const org = orgs.find((o) => o.pubkey === article!.pubkey) ?? null;
      if (org) {
        orgName = org.name;
        orgSlug = org.slug;
        // orgToSpec publishes the real sub_type under `category` for an
        // accounts org (businessToSpec's "business" marker never applies
        // to an org that can publish blog articles) — same recovery rule
        // as orgs/[slug]/page.tsx.
        orgSubType =
          org.category && ORG_SUB_TYPES.has(org.category) ? (org.category as OrgSubType) : null;
      }
    } catch (err) {
      if (!(err instanceof RecordUnavailableError)) throw err;
      notFound();
    }
    if (!article) notFound();

    const subTypeLabel = orgSubType ? SUB_TYPE_LABELS[orgSubType] : "Organisation";

    return (
      <div className="space-y-6">
        <div>
          <Button variant="ghost" asChild className="gap-2 px-0 hover:bg-transparent text-sm">
            <Link href="/app/blog">
              <ArrowLeft className="h-4 w-4" />
              Zurück zum Blog
            </Link>
          </Button>
        </div>

        <article className="max-w-4xl">
          <div className="mb-6">
            <div className="flex items-center gap-2 mb-3 flex-wrap">
              {article.category && (
                <Badge variant="secondary" className="text-xs">
                  {article.category}
                </Badge>
              )}
              {/* is_featured/tags have no record equivalent (articleToSpec
                  never publishes them) — omitted rather than faked. */}
              {article.ai_generated && (
                <Badge variant="outline" className="text-xs text-muted-foreground">
                  Mit KI erstellt
                </Badge>
              )}
            </div>

            <h1 className="text-2xl md:text-3xl font-medium text-foreground mb-3">
              {article.title}
            </h1>

            {article.excerpt && (
              <p className="text-base text-muted-foreground mb-4">{article.excerpt}</p>
            )}

            <div className="flex items-center justify-between flex-wrap gap-3 text-xs text-muted-foreground">
              {orgName && (
                <Link
                  href={orgSlug ? `/app/orgs/${orgSlug}/blog` : `/app/blog`}
                  className="flex items-center gap-2 hover:text-foreground"
                >
                  <span aria-hidden className="text-base">
                    {orgSubType ? SUB_TYPE_EMOJI[orgSubType] : "🏢"}
                  </span>
                  <span className="font-medium">{orgName}</span>
                  <span className="text-muted-foreground">· {subTypeLabel}</span>
                </Link>
              )}
              <div className="flex flex-wrap items-center gap-3">
                {article.published_at && (
                  <span className="flex items-center gap-1.5">
                    <Calendar className="h-3.5 w-3.5" />
                    {new Date(article.published_at).toLocaleDateString("de-DE", {
                      day: "2-digit",
                      month: "short",
                      year: "numeric",
                    })}
                  </span>
                )}
                {/* view_count has no record equivalent (Supabase-only
                    interaction metric) — omitted rather than a fake "0". */}
              </div>
            </div>
          </div>

          {article.cover_image_url && (
            <div className="mb-6 rounded-lg overflow-hidden aspect-video bg-muted">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={article.cover_image_url}
                alt={article.title}
                className="w-full h-full object-cover"
              />
            </div>
          )}

          {/* Record mode: content_md is markdown (articleToSpec's source is
              the same HTML→markdown conversion newsToSpec uses) — rendered
              via MarkdownRenderer rather than dangerouslySetInnerHTML,
              which expects HTML. */}
          <MarkdownRenderer content={article.content_md} />
        </article>
      </div>
    );
  }

  const supabase = await createClient();

  const { data, error } = await supabase
    .from("blog_articles")
    .select(
      `
      id, title, excerpt, content, cover_image_url, category, tags,
      is_featured, view_count, published_at,
      account:account_id (
        id, name, slug, avatar_url, sub_type, is_verified, is_extern, extern_status
      )
    `
    )
    .eq("id", id)
    .eq("status", "published")
    .maybeSingle();

  if (error || !data) notFound();

  const article = data as unknown as BlogArticleRow;

  // AI Act Art. 50(4): visible label for AI-co-written stories. Queried
  // separately and non-fatally so a not-yet-migrated column cannot take the
  // article page down with it.
  let aiGenerated = false;
  {
    const { data: aiRow } = await supabase
      .from("blog_articles")
      .select("ai_generated")
      .eq("id", id)
      .maybeSingle();
    aiGenerated = Boolean((aiRow as { ai_generated?: boolean } | null)?.ai_generated);
  }

  if (article.account.is_extern && article.account.extern_status !== "approved") {
    notFound();
  }

  // Best-effort view count increment
  await supabase.rpc("increment_blog_view_count", { article_id: id });

  const subTypeLabel = article.account.sub_type
    ? SUB_TYPE_LABELS[article.account.sub_type]
    : "Organisation";

  return (
    <div className="space-y-6">
      <div>
        <Button
          variant="ghost"
          asChild
          className="gap-2 px-0 hover:bg-transparent text-sm"
        >
          <Link href="/app/blog">
            <ArrowLeft className="h-4 w-4" />
            Zurück zum Blog
          </Link>
        </Button>
      </div>

      <article className="max-w-4xl">
        <div className="mb-6">
          <div className="flex items-center gap-2 mb-3 flex-wrap">
            {article.category && (
              <Badge variant="secondary" className="text-xs">
                {article.category}
              </Badge>
            )}
            {article.is_featured && (
              <Badge className="bg-yellow-100 text-yellow-800 text-xs">
                Featured
              </Badge>
            )}
            {aiGenerated && (
              <Badge variant="outline" className="text-xs text-muted-foreground">
                Mit KI erstellt
              </Badge>
            )}
            {(article.tags ?? []).slice(0, 3).map((t) => (
              <Badge key={t} variant="outline" className="text-xs">
                {t}
              </Badge>
            ))}
          </div>

          <h1 className="text-2xl md:text-3xl font-medium text-foreground mb-3">
            {article.title}
          </h1>

          {article.excerpt && (
            <p className="text-base text-muted-foreground mb-4">
              {article.excerpt}
            </p>
          )}

          <div className="flex items-center justify-between flex-wrap gap-3 text-xs text-muted-foreground">
            <Link
              href={
                article.account.slug
                  ? `/app/orgs/${article.account.slug}/blog`
                  : `/app/blog`
              }
              className="flex items-center gap-2 hover:text-foreground"
            >
              <span aria-hidden className="text-base">
                {article.account.sub_type
                  ? SUB_TYPE_EMOJI[article.account.sub_type]
                  : "🏢"}
              </span>
              <span className="font-medium">{article.account.name}</span>
              <span className="text-muted-foreground">· {subTypeLabel}</span>
            </Link>
            <div className="flex flex-wrap items-center gap-3">
              {article.published_at && (
                <span className="flex items-center gap-1.5">
                  <Calendar className="h-3.5 w-3.5" />
                  {new Date(article.published_at).toLocaleDateString("de-DE", {
                    day: "2-digit",
                    month: "short",
                    year: "numeric",
                  })}
                </span>
              )}
              <span className="flex items-center gap-1.5">
                <Eye className="h-3.5 w-3.5" />
                {article.view_count + 1}
              </span>
            </div>
          </div>
        </div>

        {article.cover_image_url && (
          <div className="mb-6 rounded-lg overflow-hidden aspect-video bg-muted">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={article.cover_image_url}
              alt={article.title}
              className="w-full h-full object-cover"
            />
          </div>
        )}

        <div
          className="article-content"
          dangerouslySetInnerHTML={{ __html: article.content }}
        />
      </article>
    </div>
  );
}
