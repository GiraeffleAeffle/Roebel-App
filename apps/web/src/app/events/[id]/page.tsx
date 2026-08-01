import { createClient } from "@/lib/supabase/server"
import { notFound } from "next/navigation"
import type { Metadata } from "next"
import Image from "next/image"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Calendar, Clock, MapPin, User, DollarSign, Globe, Phone, ArrowLeft } from "lucide-react"
import Link from "next/link"
import { EventsHeader } from "@/components/events/events-header"
import { DeepLinkRedirect } from "@/components/deep-link-redirect"
import { ExperienceSection } from "@/components/app/ExperienceSection"
import { getExperiences, getExperienceCount } from "@/app/actions/experiences"
import { hasSupabase, recordClient } from "@/lib/record"
import { getEventById, RecordUnavailableError } from "@netizen-labs/record-client"

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
        // contact data) — explicit neutral, never fabricated.
        organizer_name: "",
        organizer_email: "",
        organizer_phone: null,
        category: row.category,
        image_url: row.image_url,
        website_url: row.website_url,
        ticket_price: row.ticket_price !== null ? Number(row.ticket_price) : null,
        max_attendees: null,
        created_at: "",
      }
    } catch (err) {
      if (err instanceof RecordUnavailableError) return null
      throw err
    }
  }

  const supabase = await createClient()

  const { data: event, error } = await supabase
    .from("events")
    .select("*")
    .eq("id", id)
    .single()

  if (error || !event) {
    return null
  }

  return event
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>
}): Promise<Metadata> {
  const { id } = await params
  const event = await getEvent(id)
  if (!event) return { title: "Event nicht gefunden | Röbel App" }

  const description = event.description?.slice(0, 160) || `Veranstaltung in ${event.location}`
  return {
    title: `${event.title} | Röbel App`,
    description,
    openGraph: {
      title: event.title,
      description,
      ...(event.image_url ? { images: [{ url: event.image_url }] } : {}),
      type: "website",
    },
  }
}

export default async function EventDetailPage({ 
  params, 
  searchParams 
}: { 
  params: Promise<{ id: string }>
  searchParams?: Promise<{ from?: string; experienceId?: string }>
}) {
  const { id } = await params
  const search = await searchParams
  const from = search?.from || '/'
  const experienceId = search?.experienceId
  const [event, experiencesResult, experienceCountResult] = await Promise.all([
    getEvent(id),
    getExperiences(id),
    getExperienceCount(id),
  ])

  if (!event) {
    notFound()
  }

  const backUrl = from === 'dashboard' ? '/dashboard' : '/'
  const backText = from === 'dashboard' ? 'Zurück zum Dashboard' : 'Zurück zu Events'

  return (
    <div className="min-h-screen bg-background">
      <DeepLinkRedirect type="event" id={id} />
      <EventsHeader />
      <div className="container mx-auto px-4 py-4 md:py-8">
        <div className="mb-4 md:mb-6">
          <Button variant="ghost" asChild className="gap-2 px-0 hover:bg-transparent text-sm md:text-base">
            <Link href={backUrl}>
              <ArrowLeft className="h-4 w-4" />
              {backText}
            </Link>
          </Button>
        </div>

        <div className="max-w-4xl mx-auto">
          {event.image_url && (
            <div className="relative aspect-video bg-muted mb-6 md:mb-8 overflow-hidden rounded-lg">
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

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 md:gap-8">
            <div className="lg:col-span-2 space-y-4 md:space-y-6">
              <div>
                <div className="flex items-start justify-between gap-4 mb-3 md:mb-4">
                  <h1 className="text-2xl md:text-4xl font-medium text-foreground text-balance">{event.title}</h1>
              
                </div>

                {event.description && <p className="text-foreground text-base md:text-lg leading-relaxed break-words">{event.description}</p>}
              </div>
            </div>

            <div className="space-y-4 md:space-y-6">
              <Card className="bg-card border border-border shadow-none">
                <CardHeader>
                  <CardTitle className="text-lg md:text-xl">Event Details</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3 md:space-y-4">
                  <div className="flex items-start gap-3">
                    <Calendar className="h-4 w-4 md:h-5 md:w-5 text-primary flex-shrink-0 mt-0.5" />
                    <span className="font-medium text-sm md:text-base">
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
                      <Clock className="h-4 w-4 md:h-5 md:w-5 text-primary flex-shrink-0" />
                      <span className="text-sm md:text-base">
                        {event.time}
                        {event.end_time && ` - ${event.end_time}`}
                      </span>
                    </div>
                  )}

                  {event.location && (
                    <div className="flex items-start gap-3">
                      <MapPin className="h-4 w-4 md:h-5 md:w-5 text-primary flex-shrink-0 mt-0.5" />
                      <span className="text-sm md:text-base">{event.location}</span>
                    </div>
                  )}

                  {event.ticket_price !== null && event.ticket_price > 0 && (
                    <div className="flex items-center gap-3">
                      <DollarSign className="h-4 w-4 md:h-5 md:w-5 text-primary flex-shrink-0" />
                      <span className="font-medium text-sm md:text-base">{event.ticket_price}€</span>
                    </div>
                  )}

                  {event.max_attendees && (
                    <div className="flex items-center gap-3">
                      <User className="h-5 w-5 text-primary" />
                      <span>Max. {event.max_attendees} Teilnehmer</span>
                    </div>
                  )}
                </CardContent>
              </Card>

              <Card className="bg-card border border-border shadow-none">
                <CardHeader>
                  <CardTitle className="text-xl">Veranstalter</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  {event.organizer_name && (
                    <div className="flex items-center gap-3">
                      <User className="h-5 w-5 text-primary" />
                      <span className="font-medium">{event.organizer_name}</span>
                    </div>
                  )}

                  {event.organizer_phone && (
                    <div className="flex items-center gap-3">
                      <Phone className="h-5 w-5 text-primary" />
                      <span>{event.organizer_phone}</span>
                    </div>
                  )}

                  <div className="space-y-2 pt-2">
                    {event.organizer_email && (
                      <Button asChild className="w-full">
                        <Link href={`mailto:${event.organizer_email}?subject=Anfrage zu ${event.title}`}>
                          Kontakt aufnehmen
                        </Link>
                      </Button>
                    )}

                    {event.website_url && (
                      <Button variant="outline" asChild className="w-full bg-transparent">
                        <Link href={event.website_url} target="_blank" rel="noopener noreferrer">
                          <Globe className="h-4 w-4 mr-2" />
                          Website besuchen
                        </Link>
                      </Button>
                    )}
                  </div>
                </CardContent>
              </Card>
            </div>
          </div>

          {/* Experiences Section */}
          <div className="mt-8">
            <ExperienceSection
              eventId={id}
              initialExperiences={experiencesResult.data || []}
              initialCount={experienceCountResult.count || 0}
              highlightExperienceId={experienceId}
            />
          </div>
        </div>
      </div>
    </div>
  )
}
