import { createClient } from "@/lib/supabase/server"
import Link from "next/link"
import { Badge } from "@/components/ui/badge"
import { Calendar, User, Eye, Star } from "lucide-react"
import { hasSupabase, recordClient } from "@/lib/record"
import { listNews, RecordUnavailableError } from "@netizen-labs/record-client"

export const dynamic = "force-dynamic"

/** Local shape the grid below renders — mirrors the `news_articles` columns used in JSX. */
interface NewsListArticle {
  id: string
  slug: string
  title: string
  excerpt: string | null
  cover_image_url: string | null
  category: string | null
  author_name: string
  published_at: string
  view_count: number
  is_featured: boolean
}

export default async function NewsListPage() {
  let articles: NewsListArticle[] = []

  if (!hasSupabase) {
    try {
      const rows = await listNews(recordClient, { limit: 200 })
      articles = rows
        .filter((a) => a.slug !== null && a.published_at !== null)
        .map((a) => ({
          id: a.id,
          slug: a.slug as string,
          title: a.title,
          excerpt: a.excerpt,
          cover_image_url: a.cover_image_url,
          category: a.category,
          // No record equivalent — explicit neutral, never fabricated.
          author_name: "",
          published_at: a.published_at as string,
          view_count: 0,
          is_featured: false,
        }))
        .sort((a, b) => b.published_at.localeCompare(a.published_at))
    } catch (err) {
      if (err instanceof RecordUnavailableError) articles = []
      else throw err
    }
  } else {
    const supabase = await createClient()

    const { data, error } = await supabase
      .from("news_articles")
      .select("*")
      .eq("status", "published")
      .order("published_at", { ascending: false })

    if (error) {
      console.error("Error fetching news:", error)
    }
    articles = data || []
  }

  const featuredArticles = articles?.filter((a) => a.is_featured).slice(0, 3) || []
  const regularArticles = articles?.filter((a) => !a.is_featured) || []

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="bg-card border-b border-border">
        <div className="container mx-auto px-4 py-6">
          <h1 className="text-4xl font-medium text-foreground">News & Blog</h1>
          <p className="text-muted-foreground mt-2">
            Bleiben Sie auf dem Laufenden mit den neuesten Nachrichten aus Röbel/Müritz
          </p>
        </div>
      </header>

      <main className="container mx-auto px-4 py-12">
        {/* Featured Articles */}
        {featuredArticles.length > 0 && (
          <section className="mb-16">
            <h2 className="text-2xl font-medium mb-6 flex items-center gap-2">
              <Star className="h-6 w-6 text-yellow-500 fill-yellow-500" />
              Featured
            </h2>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {featuredArticles.map((article) => (
                <Link
                  key={article.id}
                  href={`/news/${article.slug}`}
                  className="group block bg-card border border-border rounded-[10px] overflow-hidden hover:shadow-lg transition-shadow"
                >
                  {article.cover_image_url && (
                    <div className="aspect-video overflow-hidden bg-muted">
                      <img
                        src={article.cover_image_url}
                        alt={article.title}
                        className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                      />
                    </div>
                  )}
                  <div className="p-6">
                    <div className="flex items-center gap-2 mb-3">
                      {article.category && (
                        <Badge variant="secondary" className="text-xs">
                          {article.category}
                        </Badge>
                      )}
                      <Badge className="bg-yellow-100 text-yellow-800 border-yellow-200">
                        <Star className="h-3 w-3 mr-1 fill-current" />
                        Featured
                      </Badge>
                    </div>
                    <h3 className="text-xl font-medium mb-2 group-hover:text-primary transition-colors">
                      {article.title}
                    </h3>
                    {article.excerpt && (
                      <p className="text-muted-foreground text-sm mb-4 line-clamp-2">
                        {article.excerpt}
                      </p>
                    )}
                    <div className="flex items-center gap-4 text-xs text-muted-foreground">
                      {article.author_name && (
                        <span className="flex items-center gap-1">
                          <User className="h-3 w-3" />
                          {article.author_name}
                        </span>
                      )}
                      <span className="flex items-center gap-1">
                        <Calendar className="h-3 w-3" />
                        {new Date(article.published_at).toLocaleDateString("de-DE")}
                      </span>
                      <span className="flex items-center gap-1">
                        <Eye className="h-3 w-3" />
                        {article.view_count}
                      </span>
                    </div>
                  </div>
                </Link>
              ))}
            </div>
          </section>
        )}

        {/* All Articles */}
        <section>
          <h2 className="text-2xl font-medium mb-6">Alle Artikel</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {regularArticles.length === 0 ? (
              <div className="col-span-full text-center py-12 bg-card border border-border rounded-[10px]">
                <p className="text-muted-foreground">Keine Artikel vorhanden</p>
              </div>
            ) : (
              regularArticles.map((article) => (
                <Link
                  key={article.id}
                  href={`/news/${article.slug}`}
                  className="group block bg-card border border-border rounded-[10px] overflow-hidden hover:shadow-lg transition-shadow"
                >
                  {article.cover_image_url && (
                    <div className="aspect-video overflow-hidden bg-muted">
                      <img
                        src={article.cover_image_url}
                        alt={article.title}
                        className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                      />
                    </div>
                  )}
                  <div className="p-6">
                    {article.category && (
                      <Badge variant="secondary" className="text-xs mb-3">
                        {article.category}
                      </Badge>
                    )}
                    <h3 className="text-lg font-medium mb-2 group-hover:text-primary transition-colors">
                      {article.title}
                    </h3>
                    {article.excerpt && (
                      <p className="text-muted-foreground text-sm mb-4 line-clamp-2">
                        {article.excerpt}
                      </p>
                    )}
                    <div className="flex items-center gap-4 text-xs text-muted-foreground">
                      {article.author_name && (
                        <span className="flex items-center gap-1">
                          <User className="h-3 w-3" />
                          {article.author_name}
                        </span>
                      )}
                      <span className="flex items-center gap-1">
                        <Calendar className="h-3 w-3" />
                        {new Date(article.published_at).toLocaleDateString("de-DE")}
                      </span>
                      <span className="flex items-center gap-1">
                        <Eye className="h-3 w-3" />
                        {article.view_count}
                      </span>
                    </div>
                  </div>
                </Link>
              ))
            )}
          </div>
        </section>
      </main>
    </div>
  )
}
