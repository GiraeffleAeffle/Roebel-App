import Link from "next/link";
import { ArrowRight, Bot, MessageCircleMore } from "lucide-react";
import type { StadtstackStagingLab } from "@/lib/stadtstack/staging-lab";

export function StadtstackStagingLabCard({
  lab,
}: {
  lab: StadtstackStagingLab;
}) {
  return (
    <section
      aria-labelledby="stadtstack-lab-title"
      className="overflow-hidden rounded-xl border border-emerald-700/25 bg-gradient-to-br from-emerald-950 to-teal-800 text-white shadow-sm"
    >
      <div className="space-y-3 p-5 sm:p-6">
        <div className="flex flex-wrap items-center gap-2 text-xs font-semibold uppercase tracking-wide text-emerald-100">
          <span className="rounded-full bg-amber-300 px-2.5 py-1 text-amber-950">
            {lab.label}
          </span>
          <span>Röbel × Stadtstack</span>
        </div>
        <div className="flex gap-3">
          <div className="hidden h-11 w-11 shrink-0 items-center justify-center rounded-full bg-white/10 sm:flex">
            <Bot aria-hidden="true" className="h-6 w-6" />
          </div>
          <div className="max-w-3xl space-y-2">
            <h2 id="stadtstack-lab-title" className="text-xl font-bold">
              Diskussion mit Mecky und den gesamten Vorschlagsfluss testen
            </h2>
            <p className="text-sm leading-6 text-emerald-50">
              Mit zwei klar markierten Testpersonen diskutieren, Mecky auf
              geprüften Inhalten antworten lassen und anschließend Vorschlag,
              Verwaltungsfeedback, Citizen Brief und beratendes Mitmachen
              nachvollziehen.
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-white/15 pt-3">
          <p className="flex items-center gap-2 text-xs text-emerald-100">
            <MessageCircleMore aria-hidden="true" className="h-4 w-4" />
            Keine Produktionsnutzer · keine echte Abstimmung
          </p>
          <Link
            href={lab.href}
            className="inline-flex min-h-11 items-center gap-2 rounded-full bg-white px-4 py-2 text-sm font-bold text-emerald-950 transition hover:bg-emerald-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
          >
            Testdiskussion öffnen
            <ArrowRight aria-hidden="true" className="h-4 w-4" />
          </Link>
        </div>
      </div>
    </section>
  );
}
