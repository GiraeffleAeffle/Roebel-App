import Link from "next/link"
import Image from "next/image"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Calendar, User, Eye, ArrowRight, Newspaper } from "lucide-react"

interface NewsArticle {
  id: string
  title: string
  slug: string
  excerpt: string | null
  cover_image_url: string | null
  author_name: string
  category: string | null
  published_at: string
  view_count: number
  is_featured: boolean
}

interface NewsCarouselProps {
  articles: NewsArticle[]
}

export function NewsCarousel({ articles }: NewsCarouselProps) {
  if (!articles || articles.length === 0) {
    return null
  }

  return (
    <section className="bg-card py-12 border-b border-border">
      <div className="container mx-auto px-4">
        {/* Section Header */}
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center">
              <Newspaper className="h-5 w-5 text-primary" />
            </div>
            <div>
              <h2 className="text-2xl font-medium tracking-tight text-foreground">Aktuelle Nachrichten</h2>
              <p className="text-sm text-muted-foreground">
                Bleiben Sie informiert über das Geschehen in Röbel/Müritz
              </p>
            </div>
          </div>
          <Link href="/news">
            <Button variant="outline" size="sm">
              Alle News anzeigen
              <ArrowRight className="h-4 w-4 ml-2" />
            </Button>
          </Link>
        </div>

        {/* News Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {articles.slice(0, 6).map((article) => (
            <Link
              key={article.id}
              href={`/news/${article.slug}`}
              className="group block bg-card border border-border rounded-[10px] overflow-hidden hover:shadow-lg transition-all duration-300"
            >
              {/* Image */}
              {article.cover_image_url ? (
                <div className="relative aspect-video overflow-hidden bg-muted">
                  <Image
                    src={article.cover_image_url}
                    alt={article.title}
                    fill
                    className="object-cover group-hover:scale-105 transition-transform duration-300"
                    sizes="(max-width: 768px) 100vw, (max-width: 1200px) 50vw, 33vw"
                  />
                </div>
              ) : (
                <div className="aspect-video bg-gradient-to-br from-gray-100 to-gray-200 flex items-center justify-center">
                  <Newspaper className="h-12 w-12 text-muted-foreground" />
                </div>
              )}

              {/* Content */}
              <div className="p-5">
                {/* Category Badge */}
                {article.category && (
                  <Badge variant="secondary" className="text-xs mb-3">
                    {article.category}
                  </Badge>
                )}

                {/* Title */}
                <h3 className="text-lg font-medium mb-2 group-hover:text-primary transition-colors line-clamp-2">
                  {article.title}
                </h3>

                {/* Excerpt */}
                {article.excerpt && (
                  <p className="text-muted-foreground text-sm mb-4 line-clamp-2">
                    {article.excerpt}
                  </p>
                )}

                {/* Metadata */}
                <div className="flex items-center gap-3 text-xs text-muted-foreground">
                  {article.author_name && (
                    <>
                      <span className="flex items-center gap-1">
                        <User className="h-3 w-3" />
                        {article.author_name}
                      </span>
                      <span>•</span>
                    </>
                  )}
                  <span className="flex items-center gap-1">
                    <Calendar className="h-3 w-3" />
                    {new Date(article.published_at).toLocaleDateString("de-DE", {
                      day: "2-digit",
                      month: "short",
                    })}
                  </span>
                  <span>•</span>
                  <span className="flex items-center gap-1">
                    <Eye className="h-3 w-3" />
                    {article.view_count}
                  </span>
                </div>
              </div>
            </Link>
          ))}
        </div>

        {/* Mobile: Show More Button */}
        {articles.length > 3 && (
          <div className="mt-6 text-center md:hidden">
            <Link href="/news">
              <Button variant="outline">
                Alle {articles.length} Artikel anzeigen
                <ArrowRight className="h-4 w-4 ml-2" />
              </Button>
            </Link>
          </div>
        )}
      </div>
    </section>
  )
}
