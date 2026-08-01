import { createClient } from "@/lib/supabase/server"
import { EventsHeader } from "@/components/events/events-header"
import { EventsHero } from "@/components/events/events-hero"
import { EventsPage } from "@/components/events/events-page"
import { NewsCarousel } from "@/components/news/news-carousel"
import { FeedProposalHero } from "@/components/proposals/FeedProposalHero"
import { getProposals } from "@/lib/supabase"
import { ProposalState, type Proposal } from "@/lib/proposal-types"
import { hasSupabase, recordClient } from "@/lib/record"
import { listEvents, listNews, RecordUnavailableError } from "@netizen-labs/record-client"

/** Matches components/events/events-page.tsx's local `Event` interface (the
 * card grid it renders). Declared here so the record-mode branch below can
 * build the exact same shape without `as any`. */
interface HomeEvent {
  id: string
  title: string
  description: string | null
  date: string
  time: string | null
  end_time: string | null
  location: string
  organizer_name: string
  organizer_email: string
  organizer_phone: string | null
  category: string | null
  image_url: string | null
  website_url: string | null
  ticket_price: number | null
  max_attendees: number | null
  created_at: string
}

/** Matches components/news/news-carousel.tsx's local `NewsArticle` interface. */
interface HomeNewsArticle {
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

export default async function HomePage({
  searchParams,
}: {
  searchParams: Promise<{ category?: string; search?: string }>
}) {
  const resolvedSearchParams = await searchParams

  // Fetch events
  let events: HomeEvent[] = []
  if (!hasSupabase) {
    try {
      const rows = await listEvents(recordClient, { limit: 200 })
      const needle = resolvedSearchParams.search?.toLowerCase()
      events = rows
        .filter(
          (e) =>
            !resolvedSearchParams.category ||
            resolvedSearchParams.category === "All Events" ||
            e.category === resolvedSearchParams.category,
        )
        .filter(
          (e) =>
            !needle ||
            e.title.toLowerCase().includes(needle) ||
            (e.description ?? "").toLowerCase().includes(needle),
        )
        .sort((a, b) => a.date.localeCompare(b.date))
        .map((e) => ({
          id: e.id,
          title: e.title,
          description: e.description,
          date: e.date,
          time: e.time,
          end_time: e.end_time,
          location: e.location ?? "",
          // No record equivalent (eventToSpec never publishes organiser
          // contact data) — explicit neutral, never fabricated.
          organizer_name: "",
          organizer_email: "",
          organizer_phone: null,
          category: e.category,
          image_url: e.image_url,
          website_url: e.website_url,
          ticket_price: e.ticket_price !== null ? Number(e.ticket_price) : null,
          max_attendees: null,
          created_at: "",
        }))
    } catch (err) {
      if (err instanceof RecordUnavailableError) events = []
      else throw err
    }
  } else {
    const supabase = await createClient()

    let query = supabase.from("events").select("*").eq("status", "approved").order("date", { ascending: true })

    if (resolvedSearchParams.category && resolvedSearchParams.category !== "All Events") {
      query = query.eq("category", resolvedSearchParams.category)
    }

    if (resolvedSearchParams.search) {
      query = query.or(`title.ilike.%${resolvedSearchParams.search}%,description.ilike.%${resolvedSearchParams.search}%`)
    }

    const { data, error } = await query

    if (error) {
      console.error("Error fetching events:", error)
    }
    events = data || []
  }

  // Fetch latest news articles
  let newsArticles: HomeNewsArticle[] = []
  if (!hasSupabase) {
    try {
      const rows = await listNews(recordClient, { limit: 20 })
      newsArticles = rows
        .filter((a) => a.slug !== null && a.published_at !== null)
        .sort((a, b) => (b.published_at as string).localeCompare(a.published_at as string))
        .slice(0, 6)
        .map((a) => ({
          id: a.id,
          title: a.title,
          slug: a.slug as string,
          excerpt: a.excerpt,
          cover_image_url: a.cover_image_url,
          // No record equivalent — explicit neutral.
          author_name: "",
          category: a.category,
          published_at: a.published_at as string,
          view_count: 0,
          is_featured: false,
        }))
    } catch (err) {
      if (err instanceof RecordUnavailableError) newsArticles = []
      else throw err
    }
  } else {
    const supabase = await createClient()

    const { data, error: newsError } = await supabase
      .from("news_articles")
      .select("*")
      .eq("status", "published")
      .order("published_at", { ascending: false })
      .limit(6)

    if (newsError) {
      console.error("Error fetching news:", newsError)
    }
    newsArticles = data || []
  }

  // Feature the open proposal (active one, else the newest) above the feed.
  // Record mode: `listProposals` (record-client civic dataset) returns only
  // metadata — no vote tallies, proposer address, or block numbers, which
  // `FeedProposalHero`/`Proposal` require. Rather than fabricate those
  // fields, the hero hides in record mode (honest degradation, spec §6.3).
  let featuredProposal: Proposal | null = null
  if (hasSupabase) {
    const proposalsResult = await getProposals({
      orderBy: "created_at",
      orderDirection: "desc",
      limit: 10,
    })
    const proposals = proposalsResult.data?.proposals ?? []
    featuredProposal =
      proposals.find((p) => p.state === ProposalState.Active) ?? proposals[0] ?? null
  }

  return (
    <div className="min-h-screen bg-background">
        <EventsHeader />
        {featuredProposal && (
          <section className="container mx-auto px-4 pt-6 md:px-6">
            <FeedProposalHero proposal={featuredProposal} />
          </section>
        )}
        <EventsHero />
        <EventsPage
          initialEvents={events || []}
          initialCategory={resolvedSearchParams.category || "All Events"}
        />
        <NewsCarousel articles={newsArticles || []} />
    </div>
  )
}
