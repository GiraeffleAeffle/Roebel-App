import { createClient } from "@/lib/supabase/server"
import { notFound } from "next/navigation"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Calendar, User, Eye, ArrowLeft, Share2 } from "lucide-react"
import Link from "next/link"
import { DeepLinkRedirect } from "@/components/deep-link-redirect"
import { hasSupabase, recordClient } from "@/lib/record"
import { getNewsBySlug, RecordUnavailableError } from "@netizen-labs/record-client"
import { MarkdownRenderer } from "@/components/proposals/MarkdownRenderer"

export const dynamic = "force-dynamic"

interface NewsArticlePageProps {
  params: Promise<{ slug: string }>
}

export default async function NewsArticlePage({ params }: NewsArticlePageProps) {
  const { slug } = await params

  if (!hasSupabase) {
    let row: Awaited<ReturnType<typeof getNewsBySlug>> = null
    try {
      row = await getNewsBySlug(recordClient, slug)
    } catch (err) {
      if (!(err instanceof RecordUnavailableError)) throw err
      row = null
    }

    if (!row) {
      notFound()
    }

    // Record mode: `content_md` is markdown (the publisher converts HTML to
    // markdown before publishing — mappers.ts `newsToSpec`), unlike the
    // Supabase column which stores HTML for `dangerouslySetInnerHTML`. It is
    // rendered with `MarkdownRenderer` instead. `author_name`, `tags`,
    // `is_featured` and view counts have no record equivalent (news mapper
    // never publishes them) and are omitted rather than faked.
    return (
      <div className="space-y-6">
        <DeepLinkRedirect type="news" id={slug} />

        <div className="mb-4">
          <Button variant="ghost" asChild className="gap-2 px-0 hover:bg-transparent text-sm">
            <Link href="/app/news">
              <ArrowLeft className="h-4 w-4" />
              Zurück zu News
            </Link>
          </Button>
        </div>

        <article className="max-w-4xl">
          <div className="mb-6">
            <div className="flex items-center gap-2 mb-3 flex-wrap">
              {row.category && (
                <Badge variant="secondary" className="text-xs">{row.category}</Badge>
              )}
            </div>

            <h1 className="text-2xl md:text-3xl font-medium text-foreground mb-3">
              {row.title}
            </h1>

            {row.excerpt && (
              <p className="text-base text-muted-foreground mb-4">{row.excerpt}</p>
            )}

            <div className="flex items-center justify-between flex-wrap gap-3 text-xs text-muted-foreground">
              <div className="flex flex-wrap items-center gap-3">
                {row.published_at && (
                  <span className="flex items-center gap-1.5">
                    <Calendar className="h-3.5 w-3.5" />
                    {new Date(row.published_at).toLocaleDateString("de-DE", {
                      day: "2-digit",
                      month: "short",
                      year: "numeric",
                    })}
                  </span>
                )}
              </div>

              <Button variant="outline" size="sm" className="text-xs h-8">
                <Share2 className="h-3.5 w-3.5 mr-1.5" />
                Teilen
              </Button>
            </div>
          </div>

          {row.cover_image_url && (
            <div className="mb-6 rounded-lg overflow-hidden aspect-video bg-muted">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={row.cover_image_url}
                alt={row.title}
                className="w-full h-full object-cover"
              />
            </div>
          )}

          <MarkdownRenderer content={row.content_md} />

          <div className="mt-8 pt-6 border-t border-border">
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
              <div>
                {row.published_at && (
                  <>
                    <p className="text-xs text-muted-foreground">Veröffentlicht am</p>
                    <p className="font-medium text-sm">
                      {new Date(row.published_at).toLocaleDateString("de-DE", {
                        day: "2-digit",
                        month: "long",
                        year: "numeric",
                      })}
                    </p>
                  </>
                )}
              </div>
              <Link href="/app/news">
                <Button variant="outline" className="text-sm h-9">
                  Weitere Artikel lesen
                </Button>
              </Link>
            </div>
          </div>
        </article>
      </div>
    )
  }

  const supabase = await createClient()

  const { data: article, error } = await supabase
    .from("news_articles")
    .select("*")
    .eq("slug", slug)
    .eq("status", "published")
    .single()

  if (error || !article) {
    notFound()
  }

  // Increment view count
  await supabase
    .from("news_articles")
    .update({ view_count: article.view_count + 1 })
    .eq("id", article.id)

  return (
    <div className="space-y-6">
      <DeepLinkRedirect type="news" id={slug} />

      <div className="mb-4">
        <Button variant="ghost" asChild className="gap-2 px-0 hover:bg-transparent text-sm">
          <Link href="/app/news">
            <ArrowLeft className="h-4 w-4" />
            Zurück zu News
          </Link>
        </Button>
      </div>

      <article className="max-w-4xl">
        {/* Article Header */}
        <div className="mb-6">
          <div className="flex items-center gap-2 mb-3 flex-wrap">
            {article.category && (
              <Badge variant="secondary" className="text-xs">{article.category}</Badge>
            )}
            {article.is_featured && (
              <Badge className="bg-yellow-100 text-yellow-800 border-yellow-200 text-xs">
                Featured
              </Badge>
            )}
            {article.tags && article.tags.length > 0 && (
              article.tags.slice(0, 3).map((tag: string) => (
                <Badge key={tag} variant="outline" className="text-xs">
                  {tag}
                </Badge>
              ))
            )}
          </div>

          <h1 className="text-2xl md:text-3xl font-medium text-foreground mb-3">
            {article.title}
          </h1>

          {article.excerpt && (
            <p className="text-base text-muted-foreground mb-4">{article.excerpt}</p>
          )}

          <div className="flex items-center justify-between flex-wrap gap-3 text-xs text-muted-foreground">
            <div className="flex flex-wrap items-center gap-3">
              <span className="flex items-center gap-1.5">
                <User className="h-3.5 w-3.5" />
                {article.author_name}
              </span>
              <span className="flex items-center gap-1.5">
                <Calendar className="h-3.5 w-3.5" />
                {new Date(article.published_at).toLocaleDateString("de-DE", {
                  day: "2-digit",
                  month: "short",
                  year: "numeric",
                })}
              </span>
              <span className="flex items-center gap-1.5">
                <Eye className="h-3.5 w-3.5" />
                {article.view_count + 1}
              </span>
            </div>

            <Button variant="outline" size="sm" className="text-xs h-8">
              <Share2 className="h-3.5 w-3.5 mr-1.5" />
              Teilen
            </Button>
          </div>
        </div>

        {/* Cover Image */}
        {article.cover_image_url && (
          <div className="mb-6 rounded-lg overflow-hidden aspect-video bg-muted">
            <img
              src={article.cover_image_url}
              alt={article.title}
              className="w-full h-full object-cover"
            />
          </div>
        )}

        {/* Article Content */}
        <div
          className="article-content"
          dangerouslySetInnerHTML={{ __html: article.content }}
        />

        {/* Article Footer */}
        <div className="mt-8 pt-6 border-t border-border">
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
            <div>
              <p className="text-xs text-muted-foreground">Veröffentlicht am</p>
              <p className="font-medium text-sm">
                {new Date(article.published_at).toLocaleDateString("de-DE", {
                  day: "2-digit",
                  month: "long",
                  year: "numeric",
                })}
              </p>
            </div>
            <Link href="/app/news">
              <Button variant="outline" className="text-sm h-9">
                Weitere Artikel lesen
              </Button>
            </Link>
          </div>
        </div>
      </article>
    </div>
  )
}
