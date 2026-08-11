import { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Inhalte melden | Röbel App",
  description:
    "Meldeverfahren für rechtswidrige Inhalte in der Röbel App und auf dem öffentlichen Datenbestand (Nostr-Relay) — Melde- und Abhilfeverfahren nach Art. 16 DSA.",
};

const CONTACT_EMAIL = "mueritzphone@gmail.com";

/**
 * DSA Art. 16 notice-and-action. As a hosting provider (micro-enterprise) we
 * owe an easily accessible reporting channel and reasoned decisions — not the
 * large-platform apparatus of Art. 20 ff. This page IS that channel, and the
 * relay's world-readable record is explicitly in scope, because the operator
 * duties do not stop at the app's own feed
 * (docs/DSGVO_AI_ACT_COMPLIANCE.md §1.1, Bundestag WD 7-026/26).
 */
export default function InhalteMeldenPage() {
  return (
    <div className="min-h-screen bg-gradient-to-b from-gray-50 to-white dark:from-gray-900 dark:to-gray-800">
      <div className="container mx-auto px-4 py-12 max-w-4xl">
        <div className="mb-8 border-b border-gray-200 dark:border-gray-700 pb-6">
          <h1 className="text-4xl font-medium text-gray-900 dark:text-white mb-2">
            Inhalte melden
          </h1>
          <p className="text-gray-600 dark:text-gray-400">
            Melde- und Abhilfeverfahren nach Art. 16 Digital Services Act (DSA)
          </p>
        </div>

        <section className="mb-8">
          <h2 className="text-2xl font-medium text-gray-900 dark:text-white mb-4 pb-2 border-b border-gray-200 dark:border-gray-700">
            Was Sie melden können
          </h2>
          <p className="text-gray-700 dark:text-gray-300 leading-relaxed mb-3">
            Wenn Sie der Ansicht sind, dass Inhalte in der Röbel App rechtswidrig sind —
            zum Beispiel in Beiträgen, Kommentaren, Veranstaltungen, Profilen oder im
            öffentlichen Datenbestand (unserem Nostr-Relay und dessen Index) — können Sie
            uns das hier melden. Das Verfahren steht allen offen, nicht nur registrierten
            Nutzer:innen.
          </p>
        </section>

        <section className="mb-8">
          <h2 className="text-2xl font-medium text-gray-900 dark:text-white mb-4 pb-2 border-b border-gray-200 dark:border-gray-700">
            So melden Sie einen Inhalt
          </h2>
          <p className="text-gray-700 dark:text-gray-300 leading-relaxed mb-3">
            Schreiben Sie eine E-Mail an{" "}
            <a
              href={`mailto:${CONTACT_EMAIL}?subject=Meldung%20rechtswidriger%20Inhalt`}
              className="text-blue-600 dark:text-blue-400 hover:underline"
            >
              {CONTACT_EMAIL}
            </a>{" "}
            mit dem Betreff „Meldung rechtswidriger Inhalt“. Damit wir die Meldung
            bearbeiten können, nennen Sie bitte (Art. 16 Abs. 2 DSA):
          </p>
          <ul className="list-disc pl-6 text-gray-700 dark:text-gray-300 leading-relaxed space-y-2">
            <li>
              <span className="font-medium">Begründung:</span> warum der Inhalt aus Ihrer
              Sicht rechtswidrig ist.
            </li>
            <li>
              <span className="font-medium">Fundort:</span> der genaue Ort des Inhalts —
              ein Link in der App bzw. auf der Website, oder beim öffentlichen
              Datenbestand die Event-ID oder der Autor-Schlüssel (npub).
            </li>
            <li>
              <span className="font-medium">Ihr Name und Ihre E-Mail-Adresse</span> —
              außer bei Meldungen zu Straftaten nach Art. 3–7 der Richtlinie 2011/93/EU,
              die anonym möglich sind.
            </li>
            <li>
              <span className="font-medium">Erklärung,</span> dass Ihre Angaben nach
              bestem Wissen richtig und vollständig sind.
            </li>
          </ul>
        </section>

        <section className="mb-8">
          <h2 className="text-2xl font-medium text-gray-900 dark:text-white mb-4 pb-2 border-b border-gray-200 dark:border-gray-700">
            Was danach passiert
          </h2>
          <ul className="list-disc pl-6 text-gray-700 dark:text-gray-300 leading-relaxed space-y-2">
            <li>
              Wir bestätigen den Eingang und prüfen die Meldung zügig, sorgfältig und
              frei von Willkür.
            </li>
            <li>
              Rechtswidrige Inhalte entfernen oder sperren wir in unseren eigenen
              Systemen — App, Website, Relay, Föderations-Mirror und Index. Sie und die
              betroffene Person erhalten eine Entscheidung mit Begründung (Art. 17 DSA).
            </li>
            <li>
              <span className="font-medium">Grenze der Föderation:</span> Der öffentliche
              Datenbestand ist ein offenes Protokoll. Kopien, die andere, fremde Server
              bereits übernommen haben, liegen außerhalb unserer Kontrolle — wir
              entfernen verlässlich überall dort, wo wir es technisch können.
            </li>
            <li>
              Wir betreiben kein allgemeines Monitoring aller Inhalte (Art. 8 DSA); wir
              handeln auf Meldungen und eigene Kenntnis.
            </li>
          </ul>
        </section>

        <section className="mb-8">
          <h2 className="text-2xl font-medium text-gray-900 dark:text-white mb-4 pb-2 border-b border-gray-200 dark:border-gray-700">
            Kontaktstelle
          </h2>
          <p className="text-gray-700 dark:text-gray-300 leading-relaxed">
            Zentrale Kontaktstelle für Behörden und Nutzer:innen (Art. 11, 12 DSA):{" "}
            <a
              href={`mailto:${CONTACT_EMAIL}`}
              className="text-blue-600 dark:text-blue-400 hover:underline"
            >
              {CONTACT_EMAIL}
            </a>
            . Kommunikation ist auf Deutsch und Englisch möglich. Verantwortlicher
            Betreiber: siehe{" "}
            <Link href="/impressum" className="text-blue-600 dark:text-blue-400 hover:underline">
              Impressum
            </Link>
            . Zum Umgang mit personenbezogenen Daten:{" "}
            <Link href="/datenschutz" className="text-blue-600 dark:text-blue-400 hover:underline">
              Datenschutzerklärung
            </Link>
            .
          </p>
        </section>
      </div>
    </div>
  );
}
