import { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Impressum | Röbel App",
  description:
    "Impressum und rechtliche Angaben der Röbel App gemäß § 5 TMG.",
};

export default function ImpressumPage() {
  return (
    <div className="min-h-screen bg-gradient-to-b from-gray-50 to-white dark:from-gray-900 dark:to-gray-800">
      <div className="container mx-auto px-4 py-12 max-w-4xl">
        {/* Header */}
        <div className="mb-8 border-b border-gray-200 dark:border-gray-700 pb-6">
          <h1 className="text-4xl font-medium text-gray-900 dark:text-white mb-2">
            Impressum
          </h1>
          <p className="text-gray-600 dark:text-gray-400">
            Angaben gemäß § 5 TMG
          </p>
        </div>

        {/* Angaben gemäß § 5 TMG */}
        <section className="mb-8">
          <h2 className="text-2xl font-medium text-gray-900 dark:text-white mb-4 pb-2 border-b border-gray-200 dark:border-gray-700">
            Angaben gemäß § 5 TMG
          </h2>
          <address className="not-italic text-gray-700 dark:text-gray-300 leading-relaxed">
            <p className="font-semibold">MüritzPhone</p>
            <p>Inhaber: Guido Brych</p>
            <p className="mt-2">Hohe Straße 2</p>
            <p>17207 Röbel/Müritz</p>
          </address>
        </section>

        {/* Kontakt */}
        <section className="mb-8">
          <h2 className="text-2xl font-medium text-gray-900 dark:text-white mb-4 pb-2 border-b border-gray-200 dark:border-gray-700">
            Kontakt
          </h2>
          <div className="text-gray-700 dark:text-gray-300 leading-relaxed space-y-2">
            <p>
              <strong>Telefon:</strong> 039931 148019
            </p>
            <p>
              <strong>E-Mail:</strong>{" "}
              <a
                href="mailto:mueritzphone@gmail.com"
                className="text-blue-600 dark:text-blue-400 hover:underline"
              >
                mueritzphone@gmail.com
              </a>
            </p>
          </div>
        </section>

        {/* Verantwortlich für den Inhalt */}
        <section className="mb-8">
          <h2 className="text-2xl font-medium text-gray-900 dark:text-white mb-4 pb-2 border-b border-gray-200 dark:border-gray-700">
            Verantwortlich für den Inhalt nach § 18 Abs. 2 MStV
          </h2>
          <address className="not-italic text-gray-700 dark:text-gray-300 leading-relaxed">
            <p>Guido Brych</p>
            <p className="mt-2">Hohe Straße 2</p>
            <p>17207 Röbel/Müritz</p>
          </address>
        </section>

        {/* Entwicklung */}
        <section className="mb-8">
          <h2 className="text-2xl font-medium text-gray-900 dark:text-white mb-4 pb-2 border-b border-gray-200 dark:border-gray-700">
            Entwicklung
          </h2>
          <p className="text-gray-700 dark:text-gray-300 leading-relaxed">
            Max Brych
          </p>
        </section>

        {/* Haftungsausschluss */}
        <section className="mb-8">
          <h2 className="text-2xl font-medium text-gray-900 dark:text-white mb-4 pb-2 border-b border-gray-200 dark:border-gray-700">
            Haftungsausschluss (Disclaimer)
          </h2>

          <h3 className="text-xl font-medium text-gray-900 dark:text-white mt-6 mb-3">
            Haftung für Inhalte
          </h3>
          <p className="text-gray-700 dark:text-gray-300 leading-relaxed mb-4">
            Als Diensteanbieter sind wir gemäß § 7 Abs.1 TMG für eigene Inhalte
            auf diesen Seiten nach den allgemeinen Gesetzen verantwortlich. Nach
            §§ 8 bis 10 TMG sind wir als Diensteanbieter jedoch nicht
            verpflichtet, übermittelte oder gespeicherte fremde Informationen zu
            überwachen oder nach Umständen zu forschen, die auf eine
            rechtswidrige Tätigkeit hinweisen.
          </p>
          <p className="text-gray-700 dark:text-gray-300 leading-relaxed mb-4">
            Verpflichtungen zur Entfernung oder Sperrung der Nutzung von
            Informationen nach den allgemeinen Gesetzen bleiben hiervon
            unberührt. Eine diesbezügliche Haftung ist jedoch erst ab dem
            Zeitpunkt der Kenntnis einer konkreten Rechtsverletzung möglich. Bei
            Bekanntwerden von entsprechenden Rechtsverletzungen werden wir diese
            Inhalte umgehend entfernen.
          </p>

          <h3 className="text-xl font-medium text-gray-900 dark:text-white mt-6 mb-3">
            Haftung für Links
          </h3>
          <p className="text-gray-700 dark:text-gray-300 leading-relaxed mb-4">
            Unser Angebot enthält Links zu externen Websites Dritter, auf deren
            Inhalte wir keinen Einfluss haben. Deshalb können wir für diese
            fremden Inhalte auch keine Gewähr übernehmen. Für die Inhalte der
            verlinkten Seiten ist stets der jeweilige Anbieter oder Betreiber
            der Seiten verantwortlich. Die verlinkten Seiten wurden zum
            Zeitpunkt der Verlinkung auf mögliche Rechtsverstöße überprüft.
            Rechtswidrige Inhalte waren zum Zeitpunkt der Verlinkung nicht
            erkennbar.
          </p>
          <p className="text-gray-700 dark:text-gray-300 leading-relaxed mb-4">
            Eine permanente inhaltliche Kontrolle der verlinkten Seiten ist
            jedoch ohne konkrete Anhaltspunkte einer Rechtsverletzung nicht
            zumutbar. Bei Bekanntwerden von Rechtsverletzungen werden wir
            derartige Links umgehend entfernen.
          </p>
        </section>

        {/* Urheberrecht */}
        <section className="mb-8">
          <h2 className="text-2xl font-medium text-gray-900 dark:text-white mb-4 pb-2 border-b border-gray-200 dark:border-gray-700">
            Urheberrecht
          </h2>
          <p className="text-gray-700 dark:text-gray-300 leading-relaxed mb-4">
            Die durch die Seitenbetreiber erstellten Inhalte und Werke auf
            diesen Seiten unterliegen dem deutschen Urheberrecht. Die
            Vervielfältigung, Bearbeitung, Verbreitung und jede Art der
            Verwertung außerhalb der Grenzen des Urheberrechtes bedürfen der
            schriftlichen Zustimmung des jeweiligen Autors bzw. Erstellers.
            Downloads und Kopien dieser Seite sind nur für den privaten, nicht
            kommerziellen Gebrauch gestattet.
          </p>
          <p className="text-gray-700 dark:text-gray-300 leading-relaxed mb-4">
            Soweit die Inhalte auf dieser Seite nicht vom Betreiber erstellt
            wurden, werden die Urheberrechte Dritter beachtet. Insbesondere
            werden Inhalte Dritter als solche gekennzeichnet. Sollten Sie
            trotzdem auf eine Urheberrechtsverletzung aufmerksam werden, bitten
            wir um einen entsprechenden Hinweis. Bei Bekanntwerden von
            Rechtsverletzungen werden wir derartige Inhalte umgehend entfernen.
          </p>
        </section>

        {/* Quick Links */}
        <div className="mt-8 pt-8 border-t border-gray-200 dark:border-gray-700 flex flex-wrap gap-4 text-sm">
          <Link
            href="/datenschutz"
            className="text-blue-600 dark:text-blue-400 hover:underline"
          >
            Datenschutzerklärung
          </Link>
          <Link
            href="/inhalte-melden"
            className="text-blue-600 dark:text-blue-400 hover:underline"
          >
            Inhalte melden (DSA)
          </Link>
          <Link
            href="/privacy"
            className="text-blue-600 dark:text-blue-400 hover:underline"
          >
            Privacy Policy (English)
          </Link>
          <Link
            href="/"
            className="text-blue-600 dark:text-blue-400 hover:underline"
          >
            Zurück zur Startseite
          </Link>
        </div>
      </div>
    </div>
  );
}
