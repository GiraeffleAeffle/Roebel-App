import { createClient } from "@/lib/supabase/server"
import { notFound } from "next/navigation"
import type { Metadata } from "next"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Calendar, User, Eye, ArrowLeft, Share2 } from "lucide-react"
import Link from "next/link"
import { EventsHeader } from "@/components/events/events-header"
import { DeepLinkRedirect } from "@/components/deep-link-redirect"
import { hasSupabase, recordClient } from "@/lib/record"
import { getNewsBySlug, RecordUnavailableError } from "@netizen-labs/record-client"
import { MarkdownRenderer } from "@/components/proposals/MarkdownRenderer"

export const dynamic = "force-dynamic"

interface NewsArticlePageProps {
  params: Promise<{ slug: string }>
}

export async function generateMetadata({ params }: NewsArticlePageProps): Promise<Metadata> {
  const { slug } = await params

  if (!hasSupabase) {
    try {
      const row = await getNewsBySlug(recordClient, slug)
      if (!row) return { title: "Artikel nicht gefunden | Röbel App" }
      const description = row.excerpt?.slice(0, 160) || row.title
      return {
        title: `${row.title} | Röbel App`,
        description,
        openGraph: {
          title: row.title,
          description,
          ...(row.cover_image_url ? { images: [{ url: row.cover_image_url }] } : {}),
          type: "article",
        },
      }
    } catch (err) {
      if (err instanceof RecordUnavailableError) return { title: "Artikel nicht gefunden | Röbel App" }
      throw err
    }
  }

  const supabase = await createClient()
  const { data: article } = await supabase
    .from("news_articles")
    .select("title, excerpt, cover_image_url")
    .eq("slug", slug)
    .eq("status", "published")
    .single()

  if (!article) return { title: "Artikel nicht gefunden | Röbel App" }

  const description = article.excerpt?.slice(0, 160) || article.title
  return {
    title: `${article.title} | Röbel App`,
    description,
    openGraph: {
      title: article.title,
      description,
      ...(article.cover_image_url ? { images: [{ url: article.cover_image_url }] } : {}),
      type: "article",
    },
  }
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
    // rendered with `MarkdownRenderer` instead, so the actual field format
    // is respected rather than injected as unparsed HTML. `author_name`,
    // `tags`, `is_featured` and view counts have no record equivalent
    // (news mapper never publishes them) and are omitted rather than faked.
    return (
      <div className="min-h-screen bg-background">
        <DeepLinkRedirect type="news" id={slug} />
        <EventsHeader />

        <main className="container mx-auto px-4 py-4 md:py-8">
          <div className="mb-4 md:mb-6">
            <Button variant="ghost" asChild className="gap-2 px-0 hover:bg-transparent text-sm md:text-base">
              <Link href="/">
                <ArrowLeft className="h-4 w-4" />
                Zurück zur Startseite
              </Link>
            </Button>
          </div>
          <article className="max-w-4xl mx-auto">
            <div className="mb-6 md:mb-8">
              {row.category && (
                <div className="flex items-center gap-2 mb-3 md:mb-4 flex-wrap">
                  <Badge variant="secondary" className="text-xs">{row.category}</Badge>
                </div>
              )}

              <h1 className="text-2xl md:text-4xl lg:text-5xl font-medium text-foreground mb-3 md:mb-4">
                {row.title}
              </h1>

              {row.excerpt && (
                <p className="text-base md:text-xl text-muted-foreground mb-4 md:mb-6">{row.excerpt}</p>
              )}

              <div className="flex items-center justify-between flex-wrap gap-3 md:gap-4 text-xs md:text-sm text-muted-foreground">
                <div className="flex flex-wrap items-center gap-3 md:gap-4">
                  {row.published_at && (
                    <span className="flex items-center gap-1.5 md:gap-2">
                      <Calendar className="h-3.5 w-3.5 md:h-4 md:w-4" />
                      {new Date(row.published_at).toLocaleDateString("de-DE", {
                        day: "2-digit",
                        month: "short",
                        year: "numeric",
                      })}
                    </span>
                  )}
                </div>

                <Button variant="outline" size="sm" className="text-xs md:text-sm h-8 md:h-9">
                  <Share2 className="h-3.5 w-3.5 md:h-4 md:w-4 mr-1.5 md:mr-2" />
                  Teilen
                </Button>
              </div>
            </div>

            {row.cover_image_url && (
              <div className="mb-6 md:mb-8 rounded-[10px] overflow-hidden aspect-video bg-muted">
                <img
                  src={row.cover_image_url}
                  alt={row.title}
                  className="w-full h-full object-cover"
                />
              </div>
            )}

            <MarkdownRenderer content={row.content_md} />

            <div className="mt-8 md:mt-12 pt-6 md:pt-8 border-t border-border">
              <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
                <div>
                  {row.published_at && (
                    <>
                      <p className="text-xs md:text-sm text-muted-foreground">Veröffentlicht am</p>
                      <p className="font-medium text-sm md:text-base">
                        {new Date(row.published_at).toLocaleDateString("de-DE", {
                          day: "2-digit",
                          month: "long",
                          year: "numeric",
                        })}
                      </p>
                    </>
                  )}
                </div>
                <Link href="/news">
                  <Button variant="outline" className="text-sm md:text-base h-9 md:h-10">
                    Weitere Artikel lesen
                  </Button>
                </Link>
              </div>
            </div>
          </article>
        </main>
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
    <div className="min-h-screen bg-background">
      <DeepLinkRedirect type="news" id={slug} />
      <EventsHeader />

      <main className="container mx-auto px-4 py-4 md:py-8">
        <div className="mb-4 md:mb-6">
          <Button variant="ghost" asChild className="gap-2 px-0 hover:bg-transparent text-sm md:text-base">
            <Link href="/">
              <ArrowLeft className="h-4 w-4" />
              Zurück zur Startseite
            </Link>
          </Button>
        </div>
        <article className="max-w-4xl mx-auto">
          {/* Article Header */}
          <div className="mb-6 md:mb-8">
            <div className="flex items-center gap-2 mb-3 md:mb-4 flex-wrap">
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

            <h1 className="text-2xl md:text-4xl lg:text-5xl font-medium text-foreground mb-3 md:mb-4">
              {article.title}
            </h1>

            {article.excerpt && (
              <p className="text-base md:text-xl text-muted-foreground mb-4 md:mb-6">{article.excerpt}</p>
            )}

            <div className="flex items-center justify-between flex-wrap gap-3 md:gap-4 text-xs md:text-sm text-muted-foreground">
              <div className="flex flex-wrap items-center gap-3 md:gap-4">
                <span className="flex items-center gap-1.5 md:gap-2">
                  <User className="h-3.5 w-3.5 md:h-4 md:w-4" />
                  <span className="truncate max-w-[120px] md:max-w-none">{article.author_name}</span>
                </span>
                <span className="flex items-center gap-1.5 md:gap-2">
                  <Calendar className="h-3.5 w-3.5 md:h-4 md:w-4" />
                  {new Date(article.published_at).toLocaleDateString("de-DE", {
                    day: "2-digit",
                    month: "short",
                    year: "numeric",
                  })}
                </span>
                <span className="flex items-center gap-1.5 md:gap-2">
                  <Eye className="h-3.5 w-3.5 md:h-4 md:w-4" />
                  {article.view_count + 1}
                </span>
              </div>

              <Button variant="outline" size="sm" className="text-xs md:text-sm h-8 md:h-9">
                <Share2 className="h-3.5 w-3.5 md:h-4 md:w-4 mr-1.5 md:mr-2" />
                Teilen
              </Button>
            </div>
          </div>

          {/* Cover Image */}
          {article.cover_image_url && (
            <div className="mb-6 md:mb-8 rounded-[10px] overflow-hidden aspect-video bg-muted">
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
          <div className="mt-8 md:mt-12 pt-6 md:pt-8 border-t border-border">
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
              <div>
                <p className="text-xs md:text-sm text-muted-foreground">Veröffentlicht am</p>
                <p className="font-medium text-sm md:text-base">
                  {new Date(article.published_at).toLocaleDateString("de-DE", {
                    day: "2-digit",
                    month: "long",
                    year: "numeric",
                  })}
                </p>
              </div>
              <Link href="/news">
                <Button variant="outline" className="text-sm md:text-base h-9 md:h-10">
                  Weitere Artikel lesen
                </Button>
              </Link>
            </div>
          </div>
        </article>
      </main>
    </div>
  )
}
