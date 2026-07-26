"use client"

import { useCallback, useEffect, useState } from "react"
import { useParams, useRouter } from "next/navigation"
import Link from "next/link"
import { useAccount } from "@/lib/context/AccountContext"
import { useActiveAccount } from "thirdweb/react"
import { createClient } from "@/lib/supabase/client"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog"
import { ArrowLeft, Trash2, ExternalLink } from "lucide-react"
import {
  OrgEventForm,
  EMPTY_EVENT_VALUES,
  type OrgEventFormValues,
} from "@/components/org-dashboard/OrgEventForm"
import { RecurringDatesEditor } from "@/components/org-dashboard/RecurringDatesEditor"
import { EventInterestsPanel } from "@/components/org-dashboard/EventInterestsPanel"
import { EventStatsQrPanel } from "@/components/org-dashboard/EventStatsQrPanel"
import { EventFlyerGenerator } from "@/components/org-dashboard/EventFlyerGenerator"
import { updateOrgEvent } from "@/app/actions/org-events"
import { deleteEvent } from "@/app/actions/manage-events"

type Tab = "details" | "anmeldungen" | "statistik" | "flyer"

const STATUS_BADGE: Record<string, { label: string; className: string }> = {
  approved: { label: "Veröffentlicht", className: "bg-green-100 text-green-700" },
  draft: { label: "Entwurf", className: "bg-muted text-muted-foreground" },
  pending: { label: "In Prüfung", className: "bg-amber-100 text-amber-700" },
  rejected: { label: "Abgelehnt", className: "bg-red-100 text-red-700" },
}

export default function EditOrgEventPage() {
  const params = useParams()
  const router = useRouter()
  const eventId = params.id as string
  const { isOwnerOf } = useAccount()
  const wallet = useActiveAccount()?.address

  const [tab, setTab] = useState<Tab>("details")
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [notAllowed, setNotAllowed] = useState(false)
  const [values, setValues] = useState<OrgEventFormValues>(EMPTY_EVENT_VALUES)
  const [status, setStatus] = useState<string>("draft")
  const [title, setTitle] = useState("")
  const [accountId, setAccountId] = useState<string | null>(null)

  // Deep-link ?tab=flyer (e.g. from the events list) without needing useSearchParams.
  useEffect(() => {
    const t = new URLSearchParams(window.location.search).get("tab")
    if (t === "flyer" || t === "anmeldungen" || t === "statistik") setTab(t as Tab)
  }, [])

  const fetchEvent = useCallback(async () => {
    const supabase = createClient()
    const { data, error } = await supabase.from("events").select("*").eq("id", eventId).single()
    if (error || !data) {
      toast.error("Event konnte nicht geladen werden.")
      router.push("/dashboard/events")
      return
    }
    if (!isOwnerOf(data.account_id)) {
      setNotAllowed(true)
      setLoading(false)
      return
    }
    setValues({
      title: data.title || "",
      description: data.description || "",
      date: data.date || "",
      time: data.time || "",
      end_time: data.end_time || "",
      location: data.location || "",
      category: data.category || "",
      organizer_name: data.organizer_name || "",
      organizer_email: data.organizer_email || "",
      organizer_phone: data.organizer_phone || "",
      website_url: data.website_url || "",
      ticket_price: data.ticket_price?.toString() || "",
      max_attendees: data.max_attendees?.toString() || "",
      is_cancelled: data.is_cancelled || false,
      image_url: data.image_url || "",
      audio_url: data.audio_url || "",
      livestream_url: data.livestream_url || "",
      livestream_active: data.livestream_active || false,
    })
    setStatus(data.status || "draft")
    setTitle(data.title || "")
    setAccountId(data.account_id ?? null)
    setLoading(false)
  }, [eventId, isOwnerOf, router])

  useEffect(() => {
    fetchEvent()
  }, [fetchEvent])

  const handleSubmit = async (formData: FormData, publish: boolean) => {
    setSubmitting(true)
    const result = await updateOrgEvent(eventId, formData, wallet, publish)
    if (result.success) {
      toast.success(publish ? "Veröffentlicht" : "Als Entwurf gespeichert")
      setStatus(publish ? "approved" : "draft")
    } else {
      toast.error(result.error || "Fehler beim Speichern")
    }
    setSubmitting(false)
  }

  const handleDelete = async () => {
    const t = toast.loading("Event wird gelöscht...")
    const r = await deleteEvent(eventId, wallet)
    if (r.success) {
      toast.success("Event gelöscht", { id: t })
      router.push("/dashboard/events")
    } else {
      toast.error(r.error || "Fehler", { id: t })
    }
  }

  if (loading) {
    return (
      <div className="max-w-4xl mx-auto py-12 flex justify-center">
        <div className="w-8 h-8 border-4 border-primary border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  if (notAllowed) {
    return (
      <div className="max-w-xl mx-auto py-12 text-center">
        <h1 className="text-lg font-semibold">Keine Berechtigung</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Dieses Event gehört nicht zu deiner Organisation.
        </p>
        <Button className="mt-6" onClick={() => router.push("/dashboard/events")}>
          Zurück zu den Events
        </Button>
      </div>
    )
  }

  const badge = STATUS_BADGE[status] ?? STATUS_BADGE.draft
  const tabs: { key: Tab; label: string }[] = [
    { key: "details", label: "Details" },
    { key: "flyer", label: "Flyer" },
    { key: "anmeldungen", label: "Anmeldungen" },
    { key: "statistik", label: "Statistik & QR" },
  ]

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" onClick={() => router.push("/dashboard/events")}>
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-medium truncate">{title || "Event bearbeiten"}</h1>
            <Badge variant="secondary" className={badge.className}>
              {badge.label}
            </Badge>
          </div>
        </div>
        <Button variant="outline" size="sm" asChild>
          <Link href={`/app/events/${eventId}`} target="_blank">
            <ExternalLink className="h-4 w-4 mr-2" />
            Ansehen
          </Link>
        </Button>
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button variant="destructive" size="sm">
              <Trash2 className="h-4 w-4 mr-2" />
              Löschen
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Event wirklich löschen?</AlertDialogTitle>
              <AlertDialogDescription>
                Diese Aktion kann nicht rückgängig gemacht werden.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Abbrechen</AlertDialogCancel>
              <AlertDialogAction
                onClick={handleDelete}
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              >
                Endgültig löschen
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b border-border">
        {tabs.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
              tab === t.key
                ? "border-primary text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === "details" && (
        <OrgEventForm
          mode="edit"
          initial={values}
          submitting={submitting}
          currentlyPublished={status === "approved"}
          onSubmit={handleSubmit}
          extraSection={<RecurringDatesEditor eventId={eventId} />}
        />
      )}

      {tab === "flyer" && accountId && (
        <EventFlyerGenerator
          accountId={accountId}
          eventId={eventId}
          eventTitle={title}
          eventImageUrl={values.image_url}
        />
      )}

      {tab === "anmeldungen" && (
        <EventInterestsPanel eventId={eventId} eventTitle={title} />
      )}

      {tab === "statistik" && <EventStatsQrPanel eventId={eventId} />}
    </div>
  )
}
