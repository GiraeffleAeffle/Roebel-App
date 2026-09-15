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

  const groups = [
    { label: "Diskussion", ids: ["topic", "discussion", "mecky"] },
    { label: "Vorschlag", ids: ["proposal", "adoption", "case"] },
    { label: "Fachprüfung", ids: ["administration"] },
    { label: "Rücklauf", ids: ["participation"] },
    { label: "Entscheidung", ids: ["decision", "execution"] },
  ];
  return (
    <section
      aria-labelledby="civic-journey-title"
      className="rounded-xl border border-border bg-card p-4"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 id="civic-journey-title" className="font-bold">
            {currentStage?.label ?? "Öffentlicher Stand vollständig"}
          </h2>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">
            {currentStage?.detail ??
              "Alle derzeit öffentlich darstellbaren Schritte sind abgeschlossen."}
          </p>
        </div>
        <span className="rounded-full bg-muted px-2.5 py-1 text-[11px] font-semibold text-muted-foreground">
          {journey.displayScope === "synthetic_demo"
            ? "Synthetischer Demo-Ablauf"
            : "Öffentlicher Stand"}
        </span>
      </div>
      <details className="mt-3 text-xs text-muted-foreground">
        <summary className="cursor-pointer font-semibold">
          Aktueller Schritt:{" "}
          {currentIndex >= 0
            ? `${currentIndex + 1} von ${journey.stages.length}`
            : `${completedCount} Schritte abgeschlossen`}
        </summary>
        <ol
          aria-label="Ablaufübersicht"
          className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-5"
        >
          {groups.map((group) => {
            const stages = journey.stages.filter((stage) =>
              group.ids.includes(stage.id)
            );
            const state = stages.some((stage) => stage.state === "current")
              ? "current"
              : stages.every((stage) => stage.state === "complete")
                ? "complete"
                : "gated";
            return (
              <li
                key={group.label}
                className={`rounded-lg border px-3 py-2 ${STATE_CLASS[state]}`}
              >
                <p className="text-xs font-bold">{group.label}</p>
                <p className="mt-1 text-[11px]">
                  {state === "complete"
                    ? group.label === "Diskussion"
                      ? "Grundlage vorhanden"
                      : "Abgeschlossen"
                    : state === "current"
                      ? "Jetzt"
                      : "Noch offen"}
                </p>
              </li>
            );
          })}
        </ol>
        <p className="mt-4 font-semibold">Alle Schritte und Zuständigkeiten</p>
        <ol className="mt-3 grid gap-2 sm:grid-cols-2">
          {journey.stages.map((stage) => (
            <li
              key={stage.id}
              aria-current={stage.state === "current" ? "step" : undefined}
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
