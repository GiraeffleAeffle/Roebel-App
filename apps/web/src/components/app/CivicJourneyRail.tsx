import { Check, Circle, LockKeyhole } from "lucide-react";
import type {
  CivicJourney,
  CivicJourneyStage,
} from "@/lib/stadtstack/civic-journey";

function marker(stage: CivicJourneyStage) {
  if (stage.state === "complete")
    return <Check className="h-3.5 w-3.5" aria-hidden="true" />;
  if (stage.state === "gated")
    return <LockKeyhole className="h-3.5 w-3.5" aria-hidden="true" />;
  return <Circle className="h-3.5 w-3.5" aria-hidden="true" />;
}

const STATE_CLASS = {
  complete: "border-emerald-300 bg-emerald-50 text-emerald-950",
  current: "border-primary bg-primary/5 text-foreground ring-2 ring-primary/15",
  available: "border-sky-200 bg-sky-50 text-sky-950",
  gated: "border-border bg-muted/30 text-muted-foreground",
} as const;

export function CivicJourneyRail({ journey }: { journey: CivicJourney }) {
  const currentIndex = journey.stages.findIndex(
    (stage) => stage.state === "current"
  );
  const currentStage =
    currentIndex >= 0 ? journey.stages[currentIndex] : undefined;
  const completedCount = journey.stages.filter(
    (stage) => stage.state === "complete"
  ).length;

  return (
    <section
      aria-labelledby="civic-journey-title"
      className="rounded-xl border border-border bg-card p-4"
    >
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h2 id="civic-journey-title" className="font-bold">
            Bürgerprozess
          </h2>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">
            Eine sichtbare Linie – getrennte Records, Signaturen und
            Zuständigkeiten.
          </p>
        </div>
        <span className="rounded-full bg-muted px-2.5 py-1 text-[11px] font-semibold text-muted-foreground">
          keine automatische Wirkung
        </span>
      </div>
      {currentStage ? (
        <div
          aria-current="step"
          className="mt-4 rounded-lg border border-primary bg-primary/5 p-4 ring-2 ring-primary/10"
        >
          <p className="text-[11px] font-bold uppercase tracking-wide text-primary">
            Aktueller Schritt · {currentIndex + 1} von {journey.stages.length}
          </p>
          <div className="mt-2 flex items-center gap-2 text-sm font-bold">
            {marker(currentStage)}
            <h3>{currentStage.label}</h3>
          </div>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">
            {currentStage.detail}
          </p>
          <p className="mt-3 text-xs font-semibold text-foreground">
            Zuständig: {currentStage.authority}
          </p>
        </div>
      ) : (
        <div className="mt-4 rounded-lg border border-emerald-300 bg-emerald-50 p-4 text-emerald-950">
          <p className="text-xs font-bold uppercase tracking-wide">
            Öffentlicher Stand vollständig
          </p>
          <p className="mt-2 text-sm leading-6">
            Alle derzeit öffentlich darstellbaren Schritte sind abgeschlossen.
            Formale Entscheidung und Ausführung bleiben getrennt gesperrt.
          </p>
        </div>
      )}

      <details className="mt-3 rounded-lg border border-border bg-muted/20 p-3">
        <summary className="cursor-pointer text-sm font-semibold text-foreground">
          Alle Schritte und Zuständigkeiten
          <span className="ml-2 text-xs font-normal text-muted-foreground">
            {completedCount} von {journey.stages.length} abgeschlossen
          </span>
        </summary>
        <ol className="mt-3 grid gap-2 sm:grid-cols-2">
          {journey.stages.map((stage) => (
            <li
              key={stage.id}
              data-stage-state={stage.state}
              className={`rounded-lg border p-3 ${STATE_CLASS[stage.state]}`}
            >
              <div className="flex items-center gap-1.5 text-xs font-bold">
                {marker(stage)}
                <span>{stage.label}</span>
              </div>
              <p className="mt-2 text-[11px] leading-4">{stage.detail}</p>
              <p className="mt-2 text-[10px] font-semibold uppercase tracking-wide opacity-75">
                {stage.authority}
              </p>
            </li>
          ))}
        </ol>
      </details>
    </section>
  );
}
