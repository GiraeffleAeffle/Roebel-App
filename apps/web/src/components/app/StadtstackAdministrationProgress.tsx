import {
  CheckCircle2,
  CircleDollarSign,
  Clock3,
  FileCheck2,
  RefreshCw,
  ShieldCheck,
  Vote,
} from "lucide-react";

import type { StadtstackAdministrationProgress } from "@/lib/stadtstack/administration-progress";

type Props = {
  progress: StadtstackAdministrationProgress | null;
  loading: boolean;
  error: string | null;
  onRefresh: () => void;
};

const STATUS_COPY = {
  waiting_for_department_review: {
    label: "Verwaltungsprüfung läuft",
    className: "bg-amber-100 text-amber-950",
    detail:
      "Nur bereits öffentlich geprüfte Fachantworten werden hier sichtbar. Über nicht veröffentlichte Antworten wird nichts vermutet.",
  },
  ready_for_case_steward: {
    label: "Bereit für den Case Steward",
    className: "bg-sky-100 text-sky-950",
    detail:
      "Alle acht Fachantworten sind öffentlich geprüft. Ein autorisierter Case Steward kann jetzt den Citizen Brief ableiten.",
  },
  citizen_brief_current: {
    label: "Citizen Brief öffentlich",
    className: "bg-emerald-100 text-emerald-950",
    detail:
      "Der aktuelle Citizen Brief ist an genau diese acht öffentlich geprüften Fachantworten gebunden.",
  },
} as const;

export function StadtstackAdministrationProgress({
  progress,
  loading,
  error,
  onRefresh,
}: Props) {
  const status = progress ? STATUS_COPY[progress.status] : null;

  return (
    <section
      aria-labelledby="stadtstack-administration-progress-title"
      className="mt-5 rounded-xl border border-sky-200 bg-sky-50/50 p-4"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wide text-sky-900">
            <ShieldCheck className="h-4 w-4" /> Öffentliche Verwaltungssicht
          </div>
          <h3
            id="stadtstack-administration-progress-title"
            className="mt-1 text-base font-bold text-foreground"
          >
            Verwaltungsfeedback und Citizen Brief
          </h3>
        </div>
        <button
          type="button"
          onClick={onRefresh}
          disabled={loading}
          className="inline-flex min-h-9 items-center gap-1.5 rounded-full border border-sky-300 bg-white px-3 py-1.5 text-xs font-bold text-sky-950 disabled:opacity-50"
        >
          <RefreshCw
            className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`}
          />
          Aktualisieren
        </button>
      </div>

      {error ? (
        <p
          role="status"
          className="mt-4 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950"
        >
          {error}
        </p>
      ) : !progress ? (
        <p className="mt-4 flex items-center gap-2 text-sm text-muted-foreground">
          <Clock3 className="h-4 w-4" />
          {loading
            ? "Öffentlich geprüften Stand laden…"
            : "Noch kein öffentlicher Verwaltungsstand verfügbar."}
        </p>
      ) : (
        <div className="mt-4 space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <span
              className={`rounded-full px-2.5 py-1 text-xs font-bold ${status!.className}`}
            >
              {status!.label}
            </span>
            <span className="rounded-full bg-white px-2.5 py-1 text-xs font-semibold text-sky-950">
              {progress.acceptedCount} von {progress.requiredCount}{" "}
              Fachantworten öffentlich geprüft
            </span>
            <span className="rounded-full bg-white px-2.5 py-1 text-xs text-muted-foreground">
              Fallversion {progress.caseBinding.caseVersion}
            </span>
          </div>
          <p className="text-xs leading-5 text-muted-foreground">
            {status!.detail}
          </p>

          <ul className="grid gap-2 sm:grid-cols-2">
            {progress.departments.map((department) => (
              <li
                key={department.id}
                className={`rounded-lg border p-3 ${
                  department.state === "reviewed"
                    ? "border-emerald-200 bg-emerald-50"
                    : "border-border bg-white"
                }`}
              >
                <div className="flex items-start gap-2">
                  {department.state === "reviewed" ? (
                    <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-700" />
                  ) : (
                    <Clock3 className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                  )}
                  <div>
                    <p className="text-sm font-bold text-foreground">
                      {department.label}
                    </p>
                    <p className="mt-0.5 text-xs leading-5 text-muted-foreground">
                      {department.state === "reviewed"
                        ? department.publicSummary
                        : "Noch keine öffentlich geprüfte Antwort"}
                    </p>
                    {department.state === "reviewed" && (
                      <p className="mt-1 text-[11px] text-emerald-900">
                        {department.publicCitations.length} öffentliche
                        Quellenangabe
                        {department.publicCitations.length === 1 ? "" : "n"}
                      </p>
                    )}
                  </div>
                </div>
              </li>
            ))}
          </ul>

          {progress.currentBrief && (
            <div className="rounded-lg border border-emerald-300 bg-white p-4">
              <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wide text-emerald-800">
                <FileCheck2 className="h-4 w-4" /> Aktueller Citizen Brief
              </div>
              <h4 className="mt-2 font-bold text-foreground">
                {progress.currentBrief.title}
              </h4>
              <p className="mt-1 text-sm leading-6 text-muted-foreground">
                {progress.currentBrief.summary}
              </p>
            </div>
          )}

          <div className="grid gap-2 sm:grid-cols-2">
            <div className="rounded-lg border border-border bg-white p-3">
              <div className="flex items-center gap-2 text-xs font-bold text-foreground">
                <Vote className="h-4 w-4" /> Keine Entscheidungswirkung
              </div>
              <p className="mt-1 text-xs leading-5 text-muted-foreground">
                Die Anzeige startet keine Abstimmung und erzeugt keinen formalen
                Beschluss.
              </p>
            </div>
            <div className="rounded-lg border border-border bg-white p-3">
              <div className="flex items-center gap-2 text-xs font-bold text-foreground">
                <CircleDollarSign className="h-4 w-4" /> Keine Treasury-Wirkung
              </div>
              <p className="mt-1 text-xs leading-5 text-muted-foreground">
                Auch die Finanzantwort löst keine Zahlung oder Budgetfreigabe
                aus.
              </p>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
