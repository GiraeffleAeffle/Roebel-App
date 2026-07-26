"use client"

import { useCallback, useEffect, useState } from "react"
import Link from "next/link"
import { useAccount } from "@/lib/context/AccountContext"
import { useActiveAccount } from "thirdweb/react"
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
import {
  Calendar,
  Plus,
  Pencil,
  Copy,
  Eye,
  Users,
  Trash2,
  Send,
  Undo2,
  CalendarClock,
  CalendarCheck,
  FileEdit,
  MapPin,
  Image as ImageIcon,
} from "lucide-react"
import {
  getOrgEventsDashboard,
  setEventPublished,
  duplicateOrgEvent,
} from "@/app/actions/org-events"
import type { OrgEventRow, OrgEventsOverview } from "@/lib/org-events-types"
import { deleteEvent } from "@/app/actions/manage-events"

type TabKey = "upcoming" | "past" | "drafts"

const STATUS_BADGE: Record<string, { label: string; className: string }> = {
  approved: { label: "Veröffentlicht", className: "bg-green-100 text-green-700" },
  draft: { label: "Entwurf", className: "bg-muted text-muted-foreground" },
  pending: { label: "In Prüfung", className: "bg-amber-100 text-amber-700" },
  rejected: { label: "Abgelehnt", className: "bg-red-100 text-red-700" },
}

function eventDateTime(e: OrgEventRow): number {
  if (!e.date) return 0
  return new Date(`${e.date}T${e.time ?? "23:59"}`).getTime()
}

export default function OrgEventsPage() {
  const { activeAccount } = useAccount()
  const wallet = useActiveAccount()?.address
  const [events, setEvents] = useState<OrgEventRow[]>([])
  const [overview, setOverview] = useState<OrgEventsOverview | null>(null)
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState<TabKey>("upcoming")
  const [busyId, setBusyId] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!activeAccount || !wallet) return
    const r = await getOrgEventsDashboard(activeAccount.id, wallet)
    if (r.success) {
      setEvents(r.events)
      setOverview(r.overview)
    } else {
      toast.error(r.error || "Events konnten nicht geladen werden.")
    }
    setLoading(false)
  }, [activeAccount, wallet])

  useEffect(() => {
    load()
  }, [load])

  const now = Date.now()
  const filtered = events
    .filter((e) => {
      if (tab === "drafts") return e.status === "draft"
      const upcoming = eventDateTime(e) >= now - 12 * 60 * 60 * 1000
      if (tab === "upcoming") return e.status !== "draft" && upcoming
      return e.status !== "draft" && !upcoming
    })
    .sort((a, b) =>
      tab === "past" ? eventDateTime(b) - eventDateTime(a) : eventDateTime(a) - eventDateTime(b)
    )

  const handlePublishToggle = async (e: OrgEventRow) => {
    setBusyId(e.id)
    const publish = e.status !== "approved"
    const r = await setEventPublished(e.id, publish, wallet)
    if (r.success) {
      toast.success(publish ? "Veröffentlicht" : "Zurückgezogen")
      await load()
    } else {
      toast.error(r.error || "Fehler")
    }
    setBusyId(null)
  }

  const handleDuplicate = async (e: OrgEventRow) => {
    setBusyId(e.id)
    const r = await duplicateOrgEvent(e.id, wallet)
    if (r.success) {
      toast.success("Als Entwurf dupliziert")
      await load()
    } else {
      toast.error(r.error || "Fehler")
    }
    setBusyId(null)
  }

  const handleDelete = async (e: OrgEventRow) => {
    setBusyId(e.id)
    const r = await deleteEvent(e.id, wallet)
    if (r.success) {
      toast.success("Event gelöscht")
      await load()
    } else {
      toast.error(r.error || "Fehler")
    }
    setBusyId(null)
  }

  const tabs: { key: TabKey; label: string; count?: number }[] = [
    { key: "upcoming", label: "Bevorstehend", count: overview?.upcoming },
    { key: "past", label: "Vergangen" },
    { key: "drafts", label: "Entwürfe", count: overview?.drafts },
  ]

  return (
    <div className="space-y-6 max-w-4xl">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-medium">Events</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Veranstaltungen dieser Organisation verwalten.
          </p>
        </div>
        <Link
          href="/dashboard/events/new"
          className="inline-flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-lg text-sm font-medium hover:bg-primary/90"
        >
          <Plus className="h-4 w-4" />
          Neues Event
        </Link>
      </div>

      {/* Overview KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <KpiCard icon={<Calendar className="h-4 w-4" />} label="Events gesamt" value={overview?.total ?? 0} />
        <KpiCard
          icon={<CalendarClock className="h-4 w-4" />}
          label="Bevorstehend"
          value={overview?.upcoming ?? 0}
        />
        <KpiCard icon={<Users className="h-4 w-4" />} label="Interessiert" value={overview?.totalInterests ?? 0} />
        <KpiCard icon={<Eye className="h-4 w-4" />} label="Aufrufe" value={overview?.totalViews ?? 0} />
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
            {typeof t.count === "number" && t.count > 0 && (
              <span className="ml-1.5 text-xs text-muted-foreground">{t.count}</span>
            )}
          </button>
        ))}
      </div>

      {/* List */}
      {loading ? (
        <div className="space-y-2">
          {[...Array(3)].map((_, i) => (
            <div key={i} className="h-20 bg-muted rounded-lg animate-pulse" />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-12 bg-card border border-border rounded-[10px]">
          {tab === "upcoming" ? (
            <CalendarClock className="h-10 w-10 mx-auto mb-3 text-muted-foreground" />
          ) : tab === "past" ? (
            <CalendarCheck className="h-10 w-10 mx-auto mb-3 text-muted-foreground" />
          ) : (
            <FileEdit className="h-10 w-10 mx-auto mb-3 text-muted-foreground" />
          )}
          <p className="text-sm text-muted-foreground">
            {tab === "upcoming"
              ? "Keine bevorstehenden Events."
              : tab === "past"
                ? "Noch keine vergangenen Events."
                : "Keine Entwürfe."}
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map((e) => {
            const badge = STATUS_BADGE[e.status ?? "draft"] ?? STATUS_BADGE.draft
            const published = e.status === "approved"
            return (
              <div
                key={e.id}
                className="bg-card border border-border rounded-lg p-4 flex flex-col sm:flex-row sm:items-center gap-3"
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-medium truncate">{e.title || "Ohne Titel"}</p>
                    <Badge variant="secondary" className={badge.className}>
                      {badge.label}
                    </Badge>
                    {e.is_cancelled && (
                      <Badge variant="secondary" className="bg-red-100 text-red-700">
                        Abgesagt
                      </Badge>
                    )}
                  </div>
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground mt-1">
                    <span>
                      {e.date
                        ? new Date(`${e.date}T${e.time ?? "00:00"}`).toLocaleString("de-DE", {
                            dateStyle: "medium",
                            timeStyle: e.time ? "short" : undefined,
                          })
                        : "—"}
                    </span>
                    {e.location && (
                      <span className="inline-flex items-center gap-1">
                        <MapPin className="h-3 w-3" />
                        {e.location}
                      </span>
                    )}
                    <span className="inline-flex items-center gap-1">
                      <Eye className="h-3 w-3" />
                      {e.viewCount}
                    </span>
                    <span className="inline-flex items-center gap-1">
                      <Users className="h-3 w-3" />
                      {e.interestCount}
                    </span>
                  </div>
                </div>

                <div className="flex items-center gap-1 shrink-0">
                  <Button variant="ghost" size="sm" asChild title="Ansehen">
                    <Link href={`/app/events/${e.id}`} target="_blank">
                      <Eye className="h-4 w-4" />
                    </Link>
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    title={published ? "Zurückziehen" : "Veröffentlichen"}
                    disabled={busyId === e.id}
                    onClick={() => handlePublishToggle(e)}
                  >
                    {published ? <Undo2 className="h-4 w-4" /> : <Send className="h-4 w-4" />}
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    title="Duplizieren"
                    disabled={busyId === e.id}
                    onClick={() => handleDuplicate(e)}
                  >
                    <Copy className="h-4 w-4" />
                  </Button>
                  <Button variant="ghost" size="sm" asChild title="Flyer erstellen">
                    <Link href={`/dashboard/events/${e.id}/edit?tab=flyer`}>
                      <ImageIcon className="h-4 w-4" />
                    </Link>
                  </Button>
                  <Button variant="ghost" size="sm" asChild title="Bearbeiten">
                    <Link href={`/dashboard/events/${e.id}/edit`}>
                      <Pencil className="h-4 w-4" />
                    </Link>
                  </Button>
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button
                        variant="ghost"
                        size="sm"
                        title="Löschen"
                        disabled={busyId === e.id}
                        className="text-red-600 hover:text-red-700 hover:bg-red-50"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>Event löschen?</AlertDialogTitle>
                        <AlertDialogDescription>
                          &quot;{e.title}&quot; wird dauerhaft gelöscht. Diese Aktion kann nicht
                          rückgängig gemacht werden.
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>Abbrechen</AlertDialogCancel>
                        <AlertDialogAction
                          onClick={() => handleDelete(e)}
                          className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                        >
                          Endgültig löschen
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

function KpiCard({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode
  label: string
  value: number
}) {
  return (
    <div className="bg-card border border-border rounded-[10px] p-4">
      <div className="flex items-center gap-2 text-muted-foreground">
        {icon}
        <span className="text-xs font-medium">{label}</span>
      </div>
      <p className="text-2xl font-semibold mt-1">{value}</p>
    </div>
  )
}
