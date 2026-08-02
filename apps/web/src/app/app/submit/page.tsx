import { EventSubmissionForm } from "@/components/events/event-submission-form"
import Link from "next/link"
import { Button } from "@/components/ui/button"
import { Sparkles } from "lucide-react"
import { hasSupabase } from "@/lib/record"

export default function SubmitEventPage() {
  return (
    <div className="space-y-6">
      <div className="text-center">
        <h1 className="text-2xl font-medium text-foreground mb-2">Veranstaltung einreichen</h1>
        <p className="text-sm text-muted-foreground">
          Teilen Sie Ihre Veranstaltung mit der Community. Alle Einsendungen werden vor der Veröffentlichung geprüft.
        </p>

        {hasSupabase && (
          <div className="mt-4">
            <Link href="/app/submit-ai">
              <Button variant="outline" className="gap-2">
                <Sparkles className="h-4 w-4" />
                KI-gestützte Einreichung
              </Button>
            </Link>
          </div>
        )}
      </div>
      {hasSupabase ? (
        <EventSubmissionForm />
      ) : (
        <p className="text-center text-sm text-muted-foreground">
          Diese Funktion benötigt ein Backend und ist im öffentlichen Datensatz
          nicht verfügbar.
        </p>
      )}
    </div>
  )
}
