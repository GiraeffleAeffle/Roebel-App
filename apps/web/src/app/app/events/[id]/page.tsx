import { createClient } from "@/lib/supabase/server"
import { notFound } from "next/navigation"
import Image from "next/image"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Calendar, Clock, MapPin, User, DollarSign, Globe, Phone, ArrowLeft } from "lucide-react"
import Link from "next/link"
import { DeepLinkRedirect } from "@/components/deep-link-redirect"
import { EventInterestButton } from "@/components/app/EventInterestButton"
import { EventOwnerActions } from "@/components/app/EventOwnerActions"
import { ExperienceSection } from "@/components/app/ExperienceSection"
import { getExperiences, getExperienceCount } from "@/app/actions/experiences"
import { hasSupabase, recordClient } from "@/lib/record"
import { getEventById, RecordUnavailableError } from "@netizen-labs/record-client"

interface EventAccount {
  id: string
  name: string
  avatar_url: string | null
  account_type: string
}

interface Event {
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
  account_id: string | null
  accounts: EventAccount | null
}

async function getEvent(id: string): Promise<Event | null> {
  if (!hasSupabase) {
    try {
      const row = await getEventById(recordClient, id)
      if (!row) return null
      return {
        id: row.id,
        title: row.title,
        description: row.description,
        date: row.date,
        time: row.time,
        end_time: row.end_time,
        location: row.location ?? "",
        // No record equivalent (eventToSpec never publishes organiser
        // contact data) — explicit neutral, never fabricated. Every render
        // site below gates on these being truthy.
        organizer_name: "",
        organizer_email: "",
        organizer_phone: null,
        category: row.category,
        image_url: row.image_url,
        website_url: row.website_url,
        ticket_price: row.ticket_price !== null ? Number(row.ticket_price) : null,
        max_attendees: null,
        created_at: "",
        // eventToSpec never publishes the Supabase account id (privacy
        // boundary, see EventRow.account_id's own doc comment) — no org
        // card to join here either way.
        account_id: null,
        accounts: null,
      }
    } catch (err) {
      if (err instanceof RecordUnavailableError) return null
      throw err
    }
  }

  const supabase = await createClient()

  const { data: event, error } = await supabase
    .from("events")
    .select("*, accounts:account_id(id, name, avatar_url, account_type)")
    .eq("id", id)
    .single()

  if (error || !event) {
    return null
  }

  return event
}

async function getInterestCount(eventId: string): Promise<number> {
  // No record equivalent (event_interests is a Supabase-only interaction
  // table) — 0 is the honest count, not a fetch failure.
  if (!hasSupabase) return 0

  const supabase = await createClient()

  const { data } = await supabase
    .from("event_interests")
    .select("id")
    .eq("event_id", eventId)

  return data?.length || 0
}

export default async function EventDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<{ experienceId?: string }>
}) {
  const { id } = await params
  const { experienceId } = await searchParams
  const [event, interestCount, experiencesResult, experienceCountResult] = await Promise.all([
    getEvent(id),
    getInterestCount(id),
    getExperiences(id),
    getExperienceCount(id),
  ])

  if (!event) {
    notFound()
  }

  return (
    <div className="space-y-6">
      <DeepLinkRedirect type="event" id={id} />

      <div className="mb-4">
        <Button variant="ghost" asChild className="gap-2 px-0 hover:bg-transparent text-sm">
          <Link href="/app/events">
            <ArrowLeft className="h-4 w-4" />
            Zurück zu Veranstaltungen
          </Link>
        </Button>
      </div>

      <div className="max-w-4xl">
        {event.image_url && (
          <div className="relative aspect-video bg-muted mb-6 overflow-hidden rounded-lg">
            <Image
              src={event.image_url || "/placeholder.svg"}
              alt={event.title}
              fill
              className="object-cover"
              sizes="(max-width: 1024px) 100vw, 896px"
              priority
            />
          </div>
        )}

        <div className="space-y-4">
          <div>
            <h1 className="text-2xl md:text-3xl font-medium text-foreground mb-3">{event.title}</h1>
            {event.description && <p className="text-foreground text-base leading-relaxed break-words">{event.description}</p>}
          </div>

          <Card className="bg-card border border-border shadow-none">
            <CardHeader>
              <CardTitle className="text-lg">Event Details</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex items-start gap-3">
                <Calendar className="h-4 w-4 text-primary flex-shrink-0 mt-0.5" />
                <span className="font-medium text-sm">
                  {new Date(event.date).toLocaleDateString("de-DE", {
                    weekday: "long",
                    year: "numeric",
                    month: "long",
                    day: "numeric",
                  })}
                </span>
              </div>

              {event.time && (
                <div className="flex items-center gap-3">
                  <Clock className="h-4 w-4 text-primary flex-shrink-0" />
                  <span className="text-sm">
                    {event.time}
                    {event.end_time && ` - ${event.end_time}`}
                  </span>
                </div>
              )}

              {event.location && (
                <div className="flex items-start gap-3">
                  <MapPin className="h-4 w-4 text-primary flex-shrink-0 mt-0.5" />
                  <span className="text-sm">{event.location}</span>
                </div>
              )}

              {event.ticket_price !== null && event.ticket_price > 0 && (
                <div className="flex items-center gap-3">
                  <DollarSign className="h-4 w-4 text-primary flex-shrink-0" />
                  <span className="font-medium text-sm">{event.ticket_price}€</span>
                </div>
              )}

              {event.max_attendees && (
                <div className="flex items-center gap-3">
                  <User className="h-4 w-4 text-primary flex-shrink-0" />
                  <span className="text-sm">Max. {event.max_attendees} Teilnehmer</span>
                </div>
              )}
            </CardContent>
          </Card>

          <Card className="bg-card border border-border shadow-none">
            <CardHeader>
              <CardTitle className="text-lg">Veranstalter</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {event.accounts ? (
                <div className="flex items-center gap-3">
                  {event.accounts.avatar_url ? (
                    <Image
                      src={event.accounts.avatar_url}
                      alt={event.accounts.name}
                      width={24}
                      height={24}
                      className="rounded-full object-cover"
                    />
                  ) : (
                    <User className="h-4 w-4 text-primary flex-shrink-0" />
                  )}
                  <span className="font-medium text-sm">{event.accounts.name}</span>
                </div>
              ) : event.organizer_name ? (
                <div className="flex items-center gap-3">
                  <User className="h-4 w-4 text-primary flex-shrink-0" />
                  <span className="font-medium text-sm">{event.organizer_name}</span>
                </div>
              ) : null}

              {event.organizer_phone && (
                <div className="flex items-center gap-3">
                  <Phone className="h-4 w-4 text-primary flex-shrink-0" />
                  <span className="text-sm">{event.organizer_phone}</span>
                </div>
              )}

              <div className="space-y-2 pt-2">
                <EventInterestButton
                  eventId={event.id}
                  initialCount={interestCount}
                  variant="detail"
                />

                {event.organizer_email && (
                  <Button asChild className="w-full" size="sm">
                    <Link href={`mailto:${event.organizer_email}?subject=Anfrage zu ${event.title}`}>
                      Kontakt aufnehmen
                    </Link>
                  </Button>
                )}

                {event.website_url && (
                  <Button variant="outline" asChild className="w-full bg-transparent" size="sm">
                    <Link href={event.website_url} target="_blank" rel="noopener noreferrer">
                      <Globe className="h-4 w-4 mr-2" />
                      Website besuchen
                    </Link>
                  </Button>
                )}

                <EventOwnerActions
                  eventId={event.id}
                  eventTitle={event.title}
                  accountId={event.account_id}
                />
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Experiences Section */}
        <ExperienceSection
          eventId={id}
          initialExperiences={experiencesResult.data || []}
          initialCount={experienceCountResult.count || 0}
          highlightExperienceId={experienceId}
        />
      </div>
    </div>
  )
}
