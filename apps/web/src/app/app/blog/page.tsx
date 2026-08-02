import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { Badge } from "@/components/ui/badge";
import { Calendar, Eye, FileText } from "lucide-react";
import { SUB_TYPE_EMOJI, SUB_TYPE_LABELS, type OrgSubType } from "@/types/account";
import { hasSupabase, recordClient } from "@/lib/record";
import { listArticles, listOrgs, RecordUnavailableError } from "@netizen-labs/record-client";

export const dynamic = "force-dynamic";

const ORG_SUB_TYPES = new Set<string>(Object.keys(SUB_TYPE_LABELS));

interface BlogRow {
  id: string;
  title: string;
  excerpt: string | null;
  cover_image_url: string | null;
  category: string | null;
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

async function getArticles(): Promise<BlogRow[]> {
  if (!hasSupabase) {
    try {
      const [articles, orgs] = await Promise.all([
        listArticles(recordClient, { limit: 200 }),
        listOrgs(recordClient),
      ]);
      const orgByPubkey = new Map(orgs.map((o) => [o.pubkey, o]));
      return articles
        .map((a) => {
          const org = orgByPubkey.get(a.pubkey);
          // No resolvable org for this article's signing pubkey — hide it
          // rather than render a byline with an empty org name.
          if (!org) return null;
          const subType =
            org.category && ORG_SUB_TYPES.has(org.category) ? (org.category as OrgSubType) : null;
          const row: BlogRow = {
            id: a.id,
            title: a.title,
            excerpt: a.excerpt,
            cover_image_url: a.cover_image_url,
            category: a.category,
            // is_featured has no record equivalent — never fabricated.
            is_featured: false,
            // view_count is a Supabase-only interaction metric — honest 0,
            // not hidden (a real number next to an Eye icon reads as an
            // honest stat, same call Task 11 made for news view counts).
            view_count: 0,
            published_at: a.published_at,
            account: {
              id: org.slug,
              name: org.name,
              slug: org.slug,
              avatar_url: org.avatar_url,
              sub_type: subType,
              is_verified: false,
              is_extern: false,
              extern_status: null,
            },
          };
          return row;
        })
        .filter((row): row is BlogRow => row !== null)
        .sort((a, b) => (b.published_at ?? "").localeCompare(a.published_at ?? ""))
        .slice(0, 60);
    } catch (err) {
      if (err instanceof RecordUnavailableError) return [];
      throw err;
    }
  }

  const supabase = await createClient();
  const { data } = await supabase
    .from("blog_articles")
    .select(
      `
      id, title, excerpt, cover_image_url, category, is_featured,
      view_count, published_at,
      account:account_id (
        id, name, slug, avatar_url, sub_type, is_verified, is_extern, extern_status
      )
    `
    )
    .eq("status", "published")
    .order("published_at", { ascending: false })
    .limit(60);

  return ((data as unknown as BlogRow[]) || []).filter(
    (a) => !a.account.is_extern || a.account.extern_status === "approved"
  );
}

export default async function BlogFeedPage() {
  const articles = await getArticles();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl md:text-3xl font-medium">Blog</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Artikel und Beiträge von Organisationen aus Röbel und Umgebung.
        </p>
      </div>

      {articles.length === 0 ? (
        <div className="text-center py-16 bg-card border border-border rounded-[10px]">
          <FileText className="h-10 w-10 mx-auto mb-3 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">
            Noch keine Beiträge.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {articles.map((a) => (
            <Link
              key={a.id}
              href={`/app/blog/${a.id}`}
              className="bg-card border border-border rounded-[10px] overflow-hidden hover:shadow-md transition-shadow flex flex-col"
            >
              {a.cover_image_url && (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={a.cover_image_url}
                  alt=""
                  className="w-full aspect-video object-cover"
                />
              )}
              <div className="p-4 flex-1 flex flex-col">
                <div className="flex items-center gap-2 mb-2 flex-wrap">
                  {a.is_featured && (
                    <Badge className="bg-yellow-100 text-yellow-800 text-xs">
                      Featured
                    </Badge>
                  )}
                  {a.category && (
                    <Badge variant="secondary" className="text-xs">
                      {a.category}
                    </Badge>
                  )}
                </div>
                <h3 className="font-medium text-foreground line-clamp-2">
                  {a.title}
                </h3>
                {a.excerpt && (
                  <p className="text-sm text-muted-foreground mt-1 line-clamp-2">
                    {a.excerpt}
                  </p>
                )}
                <div className="mt-auto pt-3 flex items-center justify-between text-xs text-muted-foreground">
                  <span className="flex items-center gap-1.5 truncate">
                    <span aria-hidden>
                      {a.account.sub_type
                        ? SUB_TYPE_EMOJI[a.account.sub_type]
                        : "🏢"}
                    </span>
                    <span className="truncate">{a.account.name}</span>
                  </span>
                  <span className="flex items-center gap-3 flex-shrink-0">
                    {a.published_at && (
                      <span className="flex items-center gap-1">
                        <Calendar className="h-3 w-3" />
                        {new Date(a.published_at).toLocaleDateString("de-DE", {
                          day: "2-digit",
                          month: "short",
                        })}
                      </span>
                    )}
                    <span className="flex items-center gap-1">
                      <Eye className="h-3 w-3" />
                      {a.view_count}
                    </span>
                  </span>
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
