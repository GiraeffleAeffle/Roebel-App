"use client"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { MapPin, Ticket } from "lucide-react"
import Link from "next/link"
import Image from "next/image"
import { useState } from "react"

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

interface EventsGridProps {
  events: Event[]
}

export function EventsGrid({ events }: EventsGridProps) {
  const [currentPage, setCurrentPage] = useState(1)
  const eventsPerPage = 9

  // Calculate pagination
  const indexOfLastEvent = currentPage * eventsPerPage
  const indexOfFirstEvent = indexOfLastEvent - eventsPerPage
  const currentEvents = events.slice(indexOfFirstEvent, indexOfLastEvent)
  const totalPages = Math.ceil(events.length / eventsPerPage)

  if (events.length === 0) {
    return (
      <div className="text-center py-12">
        <h3 className="text-xl font-medium text-muted-foreground mb-3">Keine Events gefunden</h3>
        <p className="text-muted-foreground mb-4">Seien Sie der Erste, der ein Event hinzufügt!</p>
        <Button asChild className="rounded-[10px]">
          <Link href="/submit">Event einreichen</Link>
        </Button>
      </div>
    )
  }

  const handlePageChange = (page: number) => {
    setCurrentPage(page)
    // Scroll to events section
    document.getElementById("events")?.scrollIntoView({ behavior: "smooth" })
  }

  return (
    <div id="events" className="space-y-8">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl md:text-3xl font-medium tracking-tight text-foreground">Kommende Events</h2>
        <p className="text-sm text-muted-foreground">
          {events.length} {events.length === 1 ? "Event" : "Events"}
        </p>
      </div>

      {/* Events Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 md:gap-6">
        {currentEvents.map((event) => {
          const eventDate = new Date(event.date)
          const day = eventDate.getDate()
          const month = eventDate.toLocaleDateString("de-DE", { month: "short" })

          return (
            <Link
              key={event.id}
              href={`/events/${event.id}`}
              className="group block"
            >
              <div className="bg-card rounded-[10px] overflow-hidden">
                {/* Image with Date Badge */}
                <div className="relative aspect-video overflow-hidden rounded-[10px]">
                  {event.image_url ? (
                    <>
                      <Image
                        src={event.image_url}
                        alt=""
                        fill
                        className="object-cover blur-xl scale-110"
                        aria-hidden="true"
                        sizes="(max-width: 768px) 100vw, (max-width: 1200px) 50vw, 33vw"
                      />
                      <Image
                        src={event.image_url}
                        alt={event.title}
                        fill
                        className="object-contain relative z-10"
                        sizes="(max-width: 768px) 100vw, (max-width: 1200px) 50vw, 33vw"
                      />
                    </>
                  ) : (
                    <div className="w-full h-full bg-gradient-to-br from-muted to-muted-foreground/20" />
                  )}

                  {/* Date Badge - Top Left */}
                  <div className="absolute top-4 left-4 bg-card rounded-[10px] shadow-lg overflow-hidden min-w-[50px]">
                    <div className="text-center p-1.5">
                      <div className="text-2xl font-medium text-foreground leading-none mb-0.5">
                        {day}
                      </div>
                      
                      <div className="text-[10px] text-muted-foreground uppercase tracking-wide">
                        {month}
                      </div>
                    </div>
                  </div>
                </div>

                {/* Content */}
                <div className="py-3 space-y-2">
                  {/* Title */}
                  <h3 className="text-xl font-medium text-foreground line-clamp-2 leading-tight">
                    {event.title}
                  </h3>

                  {/* Description */}
                  {event.description && (
                    <p className="text-sm text-muted-foreground line-clamp-2 leading-relaxed">
                      {event.description}
                    </p>
                  )}

                  {/* Price and Location */}
                  <div className="flex items-center gap-3 pt-1 text-sm text-foreground">
                    {event.ticket_price !== null && event.ticket_price > 0 ? (
                      <div className="flex items-center gap-1.5 ">
                        <Ticket className="h-4 w-4 flex-shrink-0" />
                        <span>{event.ticket_price}€</span>
                      </div>
                    ) : (
                      <div className="flex items-center gap-1.5 ">
                        <Ticket className="h-4 w-4 flex-shrink-0" />
                        <span>Kostenlos</span>
                      </div>
                    )}

                    {event.location && (
                      <div className="flex items-center gap-1.5">
                        <MapPin className="h-4 w-4 flex-shrink-0" />
                        <span className="truncate">{event.location}</span>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </Link>
          )
        })}
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-2 pt-4">
          <Button
            variant="outline"
            size="sm"
            onClick={() => handlePageChange(currentPage - 1)}
            disabled={currentPage === 1}
            className="rounded-[10px]"
          >
            Zurück
          </Button>

          <div className="flex items-center gap-2">
            {Array.from({ length: totalPages }, (_, i) => i + 1).map((page) => (
              <Button
                key={page}
                variant={currentPage === page ? "default" : "outline"}
                size="sm"
                onClick={() => handlePageChange(page)}
                className="rounded-[10px] min-w-[40px]"
              >
                {page}
              </Button>
            ))}
          </div>

          <Button
            variant="outline"
            size="sm"
            onClick={() => handlePageChange(currentPage + 1)}
            disabled={currentPage === totalPages}
            className="rounded-[10px]"
          >
            Weiter
          </Button>
        </div>
      )}
    </div>
  )
}
