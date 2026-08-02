import { FeedbackForm } from "@/components/support/feedback-form"
import { MessageSquare, Bug, Lightbulb, MessageCircle } from "lucide-react"
import { hasSupabase } from "@/lib/record"

export const metadata = {
  title: "Support & Feedback | Röbel App",
  description: "Senden Sie uns Ihr Feedback, melden Sie Bugs oder schlagen Sie neue Features vor.",
}

export default function SupportPage() {
  return (
    <div className="space-y-6">
      <div className="text-center">
        <h1 className="text-xl sm:text-2xl font-medium tracking-tight text-foreground mb-2">
          Support & Feedback
        </h1>
        <p className="text-sm text-muted-foreground max-w-2xl mx-auto">
          Wir freuen uns über Ihr Feedback! Ob Bug-Bericht, Feature-Wunsch oder allgemeine Anmerkungen –
          Ihre Meinung hilft uns, die App zu verbessern.
        </p>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <div className="bg-card border border-border rounded-xl p-4 text-center">
          <Bug className="h-8 w-8 text-red-500 mx-auto mb-2" />
          <h3 className="font-medium text-sm mb-1">Bug-Bericht</h3>
          <p className="text-xs text-muted-foreground">Melden Sie technische Probleme</p>
        </div>
        <div className="bg-card border border-border rounded-xl p-4 text-center">
          <Lightbulb className="h-8 w-8 text-purple-500 mx-auto mb-2" />
          <h3 className="font-medium text-sm mb-1">Feature-Anfrage</h3>
          <p className="text-xs text-muted-foreground">Schlagen Sie neue Funktionen vor</p>
        </div>
        <div className="bg-card border border-border rounded-xl p-4 text-center">
          <MessageSquare className="h-8 w-8 text-blue-500 mx-auto mb-2" />
          <h3 className="font-medium text-sm mb-1">Verbesserung</h3>
          <p className="text-xs text-muted-foreground">Vorschläge zur Optimierung</p>
        </div>
        <div className="bg-card border border-border rounded-xl p-4 text-center">
          <MessageCircle className="h-8 w-8 text-muted-foreground mx-auto mb-2" />
          <h3 className="font-medium text-sm mb-1">Allgemein</h3>
          <p className="text-xs text-muted-foreground">Sonstiges Feedback</p>
        </div>
      </div>

      {hasSupabase ? (
        <FeedbackForm />
      ) : (
        <p className="text-center text-sm text-muted-foreground">
          Diese Funktion benötigt ein Backend und ist im öffentlichen
          Datensatz nicht verfügbar.
        </p>
      )}
    </div>
  )
}
