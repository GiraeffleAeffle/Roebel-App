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
      <ol className="mt-4 flex snap-x gap-2 overflow-x-auto pb-2 lg:grid lg:grid-cols-9 lg:overflow-visible lg:pb-0">
        {journey.stages.map((stage) => (
          <li
            key={stage.id}
            aria-current={stage.state === "current" ? "step" : undefined}
            className={`min-w-40 snap-start rounded-lg border p-3 lg:min-w-0 ${STATE_CLASS[stage.state]}`}
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
    </section>
  );
}
