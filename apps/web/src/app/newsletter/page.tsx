import type { Metadata } from "next"
import { EventsHeader } from "@/components/events/events-header"
import { NewsletterSignupForm } from "./signup-form"
import { hasSupabase } from "@/lib/record"

export const metadata: Metadata = {
  title: "Newsletter | Röbel App",
  description: "Jede Woche die wichtigsten Neuigkeiten aus Röbel/Müritz ins Postfach.",
}

export default function NewsletterPage() {
  return (
    <div className="min-h-screen bg-white">
      <EventsHeader />
      <main className="mx-auto max-w-xl px-4 pt-16 pb-6">
        <h1 className="text-3xl font-bold text-gray-900">Der Röbel-Newsletter</h1>
        <p className="mt-3 text-gray-600">
          Einmal pro Woche: Neuigkeiten, Veranstaltungen, Abstimmungen und alles, was in
          Röbel/Müritz passiert. Kostenlos, jederzeit abbestellbar.
        </p>
        <div className="mt-8">
          {hasSupabase ? (
            <NewsletterSignupForm />
          ) : (
            <p className="text-sm text-gray-600">
              Diese Funktion benötigt ein Backend und ist im öffentlichen
              Datensatz nicht verfügbar.
            </p>
          )}
        </div>
        <p className="mt-6 text-xs text-gray-400">
          Details zur Verarbeitung deiner Daten findest du im Abschnitt „Newsletter“ unserer{" "}
          <a href="/datenschutz" className="underline">Datenschutzerklärung</a>.
        </p>
      </main>
    </div>
  )
}
