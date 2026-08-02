import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { Badge } from "@/components/ui/badge";
import { Calendar, Eye, FileText } from "lucide-react";
import {
  SUB_TYPE_EMOJI,
  SUB_TYPE_LABELS,
  type OrgSubType,
} from "@/types/account";
import { hasSupabase, recordClient } from "@/lib/record";
import { getOrgBySlug, listArticles, RecordUnavailableError } from "@netizen-labs/record-client";

export const dynamic = "force-dynamic";

const ORG_SUB_TYPES = new Set<string>(Object.keys(SUB_TYPE_LABELS));

interface AccountRow {
  id: string;
  name: string;
  slug: string;
  bio: string | null;
  avatar_url: string | null;
  cover_url: string | null;
  sub_type: OrgSubType | null;
  is_verified: boolean;
  is_extern: boolean;
  extern_status: string | null;
}

interface ArticleRow {
  id: string;
  title: string;
  excerpt: string | null;
  cover_image_url: string | null;
  category: string | null;
  view_count: number;
  published_at: string | null;
}

export default async function OrgBlogPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;

  if (!hasSupabase) {
    let account: AccountRow | null = null;
    let articles: ArticleRow[] = [];
    try {
      const org = await getOrgBySlug(recordClient, slug);
      if (!org || org.is_business) notFound();
      // orgToSpec publishes the real sub_type under `category` for an
      // accounts org (businessToSpec's "business" marker never applies to
      // an org that can publish blog articles) — same recovery rule as
      // orgs/[slug]/page.tsx.
      const subType =
        org.category && ORG_SUB_TYPES.has(org.category) ? (org.category as OrgSubType) : null;
      account = {
        id: org.slug,
        name: org.name,
        slug: org.slug,
        bio: org.bio,
        avatar_url: org.avatar_url,
        cover_url: org.cover_url,
        sub_type: subType,
        is_verified: false,
        is_extern: false,
        extern_status: null,
      };
      // ArticleRow carries the signing pubkey, not an account id — joins
      // back to the org roster the same way blog/[id]/page.tsx does.
      const all = await listArticles(recordClient, { limit: 200 });
      articles = all
        .filter((a) => a.pubkey === org.pubkey)
        .sort((a, b) => (b.published_at ?? "").localeCompare(a.published_at ?? ""))
        .slice(0, 60)
        .map((a) => ({
          id: a.id,
          title: a.title,
          excerpt: a.excerpt,
          cover_image_url: a.cover_image_url,
          category: a.category,
          // No record equivalent — explicit neutral, never fabricated.
          view_count: 0,
          published_at: a.published_at,
        }));
    } catch (err) {
      if (!(err instanceof RecordUnavailableError)) throw err;
      notFound();
    }
    if (!account) notFound();

    const subLabel = account.sub_type ? SUB_TYPE_LABELS[account.sub_type] : "Organisation";

    return (
      <div className="space-y-6">
        {account.cover_url && (
          <div className="aspect-[3/1] w-full overflow-hidden rounded-[10px] bg-muted">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={account.cover_url} alt="" className="w-full h-full object-cover" />
          </div>
        )}

        <div className="flex items-start gap-4">
          <div className="w-16 h-16 rounded-lg bg-muted flex items-center justify-center overflow-hidden flex-shrink-0">
            {account.avatar_url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={account.avatar_url} alt={account.name} className="w-full h-full object-cover" />
            ) : (
              <span className="text-2xl">
                {account.sub_type ? SUB_TYPE_EMOJI[account.sub_type] : "🏢"}
              </span>
            )}
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h1 className="text-2xl font-medium">{account.name}</h1>
            </div>
            <p className="text-sm text-muted-foreground">{subLabel}</p>
            {account.bio && <p className="text-sm text-foreground mt-2">{account.bio}</p>}
          </div>
        </div>

        <h2 className="text-lg font-medium border-b border-border pb-2">Artikel</h2>

        {articles.length === 0 ? (
          <div className="text-center py-12 bg-card border border-border rounded-[10px]">
            <FileText className="h-10 w-10 mx-auto mb-3 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">Noch keine Artikel.</p>
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
                  <img src={a.cover_image_url} alt="" className="w-full aspect-video object-cover" />
                )}
                <div className="p-4 flex-1 flex flex-col">
                  {a.category && (
                    <Badge variant="secondary" className="text-xs w-fit mb-2">
                      {a.category}
                    </Badge>
                  )}
                  <h3 className="font-medium text-foreground line-clamp-2">{a.title}</h3>
                  {a.excerpt && (
                    <p className="text-sm text-muted-foreground mt-1 line-clamp-2">{a.excerpt}</p>
                  )}
                  <div className="mt-auto pt-3 flex items-center justify-between text-xs text-muted-foreground">
                    {a.published_at && (
                      <span className="flex items-center gap-1">
                        <Calendar className="h-3 w-3" />
                        {new Date(a.published_at).toLocaleDateString("de-DE", {
                          day: "2-digit",
                          month: "short",
                        })}
                      </span>
                    )}
                  </div>
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>
    );
  }

  const supabase = await createClient();

  const { data: accountData } = await supabase
    .from("accounts")
    .select(
      "id, name, slug, bio, avatar_url, cover_url, sub_type, is_verified, is_extern, extern_status"
    )
    .eq("slug", slug)
    .maybeSingle();

  const account = accountData as AccountRow | null;
  if (!account) notFound();
  if (account.is_extern && account.extern_status !== "approved") notFound();

  const { data: articlesData } = await supabase
    .from("blog_articles")
    .select(
      "id, title, excerpt, cover_image_url, category, view_count, published_at"
    )
    .eq("account_id", account.id)
    .eq("status", "published")
    .order("published_at", { ascending: false })
    .limit(60);

  const articles = (articlesData as ArticleRow[]) || [];
  const subLabel = account.sub_type
    ? SUB_TYPE_LABELS[account.sub_type]
    : "Organisation";

  return (
    <div className="space-y-6">
      {account.cover_url && (
        <div className="aspect-[3/1] w-full overflow-hidden rounded-[10px] bg-muted">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={account.cover_url}
            alt=""
            className="w-full h-full object-cover"
          />
        </div>
      )}

      <div className="flex items-start gap-4">
        <div className="w-16 h-16 rounded-lg bg-muted flex items-center justify-center overflow-hidden flex-shrink-0">
          {account.avatar_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={account.avatar_url}
              alt={account.name}
              className="w-full h-full object-cover"
            />
          ) : (
            <span className="text-2xl">
              {account.sub_type ? SUB_TYPE_EMOJI[account.sub_type] : "🏢"}
            </span>
          )}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h1 className="text-2xl font-medium">{account.name}</h1>
            {account.is_verified && (
              <Badge variant="outline" className="text-xs">
                Verifiziert
              </Badge>
            )}
          </div>
          <p className="text-sm text-muted-foreground">{subLabel}</p>
          {account.bio && (
            <p className="text-sm text-foreground mt-2">{account.bio}</p>
          )}
        </div>
      </div>

      <h2 className="text-lg font-medium border-b border-border pb-2">
        Artikel
      </h2>

      {articles.length === 0 ? (
        <div className="text-center py-12 bg-card border border-border rounded-[10px]">
          <FileText className="h-10 w-10 mx-auto mb-3 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">Noch keine Artikel.</p>
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
                {a.category && (
                  <Badge variant="secondary" className="text-xs w-fit mb-2">
                    {a.category}
                  </Badge>
                )}
                <h3 className="font-medium text-foreground line-clamp-2">
                  {a.title}
                </h3>
                {a.excerpt && (
                  <p className="text-sm text-muted-foreground mt-1 line-clamp-2">
                    {a.excerpt}
                  </p>
                )}
                <div className="mt-auto pt-3 flex items-center justify-between text-xs text-muted-foreground">
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
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
