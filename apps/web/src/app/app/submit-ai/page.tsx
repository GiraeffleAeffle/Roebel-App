import { AIEventSubmissionChat } from "@/components/events/ai-event-submission-chat"
import Link from "next/link"
import { Button } from "@/components/ui/button"
import { ArrowLeft, Sparkles } from "lucide-react"
import { hasSupabase } from "@/lib/record"

export default function AISubmitEventPage() {
  return (
    <div className="space-y-6">
          {/* Header with navigation */}
          <div>
            <Link href="/app/submit">
              <Button variant="ghost" className="mb-4 -ml-2">
                <ArrowLeft className="h-4 w-4 mr-2" />
                Zurück zum klassischen Formular
              </Button>
            </Link>

            <div className="text-center">
              <div className="flex items-center justify-center gap-2 mb-4">
                <Sparkles className="h-8 w-8 text-primary" />
                <h1 className="text-4xl font-medium text-foreground">
                  KI-Event-Einreichung
                </h1>
              </div>
              <p className="text-lg text-muted-foreground max-w-2xl mx-auto">
                Lass dich von unserer KI unterstützen! Chatte einfach über dein Event oder lade
                einen Flyer hoch – die KI kümmert sich um den Rest.
              </p>
            </div>
          </div>

          {/* Feature highlights */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
            <div className="bg-card rounded-lg p-4 border border-border">
              <div className="text-center">
                <div className="bg-primary/10 rounded-full w-12 h-12 flex items-center justify-center mx-auto mb-2">
                  <Sparkles className="h-6 w-6 text-primary" />
                </div>
                <h3 className="font-medium text-sm mb-1">Intelligente Extraktion</h3>
                <p className="text-xs text-muted-foreground">
                  Lade einen Flyer hoch und die KI extrahiert alle Informationen
                </p>
              </div>
            </div>

            <div className="bg-card rounded-lg p-4 border border-border">
              <div className="text-center">
                <div className="bg-primary/10 rounded-full w-12 h-12 flex items-center justify-center mx-auto mb-2">
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    className="h-6 w-6 text-primary"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z"
                    />
                  </svg>
                </div>
                <h3 className="font-medium text-sm mb-1">Natürliche Konversation</h3>
                <p className="text-xs text-muted-foreground">
                  Chatte einfach über dein Event in deinen eigenen Worten
                </p>
              </div>
            </div>

            <div className="bg-card rounded-lg p-4 border border-border">
              <div className="text-center">
                <div className="bg-primary/10 rounded-full w-12 h-12 flex items-center justify-center mx-auto mb-2">
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    className="h-6 w-6 text-primary"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z"
                    />
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M15 11a3 3 0 11-6 0 3 3 0 016 0z"
                    />
                  </svg>
                </div>
                <h3 className="font-medium text-sm mb-1">Auto-Geocoding</h3>
                <p className="text-xs text-muted-foreground">
                  Orte werden automatisch auf Google Maps verifiziert
                </p>
              </div>
            </div>
          </div>

          {/* Chat interface */}
          {hasSupabase ? (
            <>
              <AIEventSubmissionChat />

              {/* Help text */}
              <div className="mt-6 text-center text-sm text-muted-foreground">
                <p>
                  Deine Eingaben werden von einer KI verarbeitet. Alle Events werden vor der
                  Veröffentlichung überprüft.
                </p>
              </div>
            </>
          ) : (
            <p className="text-center text-sm text-muted-foreground">
              Diese Funktion benötigt ein Backend und ist im öffentlichen
              Datensatz nicht verfügbar.
            </p>
          )}
    </div>
  )
}
