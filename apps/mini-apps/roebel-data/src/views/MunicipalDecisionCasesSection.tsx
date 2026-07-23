import { useCallback, useEffect, useState } from "react";
import {
  loadRoebelActivityJournalDemo,
  loadRoebelDepartmentDemo,
  loadReviewedCivicCases,
  type CivicActivityJournalCapabilitiesV1,
  type CivicActivityJournalEventListV1,
  type ReviewedCivicCase,
  type RoebelDepartmentConnectionDemoV1,
} from "@roebel/stadtstack-federation-client";
import { Card, Pill, Skeleton } from "../components/ui";
import { ExternalLink, Refresh, ShieldCheck } from "../components/icons";
import {
  classifyMunicipalDecisionCaseFailure,
  presentActivityJournalEvent,
  type MunicipalDecisionCaseFailureStatus,
} from "./municipalDecisionCasesState";

type ViewState =
  | {
      status:
        | "not_configured"
        | "loading"
        | "empty"
        | MunicipalDecisionCaseFailureStatus;
    }
  | { status: "ready"; cases: ReviewedCivicCase[] };

const truthLabel: Record<ReviewedCivicCase["stageMap"]["truthState"], string> = {
  reviewed: "lokal geprüft",
  pending_review: "in Prüfung",
  review_due: "Prüfung fällig",
  stale: "veraltet",
  missing: "nicht belegt",
  fallback: "Ersatzstand",
  demo: "Demostand",
};

const authorityLabel: Record<
  ReviewedCivicCase["stageMap"]["participationAuthorityState"],
  string
> = {
  unconfirmed: "Mandat unbestätigt",
  declared: "Mandat erklärt",
  confirmed: "Mandat bestätigt",
  formal: "formelles Mandat",
};

const lifecycleLabel: Record<
  ReviewedCivicCase["stageMap"]["current"]["lifecycle"],
  string
> = {
  not_started: "noch nicht begonnen",
  ready: "bereit",
  active: "in Arbeit",
  waiting_external: "wartet auf externe Stelle",
  blocked: "blockiert",
  completed: "abgeschlossen",
  not_applicable: "nicht erforderlich",
  cancelled: "beendet",
};

export default function MunicipalDecisionCasesSection({
  onOpenCase,
}: {
  onOpenCase: (url: string) => void;
}) {
  const [state, setState] = useState<ViewState>({ status: "loading" });
  const [reload, setReload] = useState(0);
  const baseUrl = process.env.NEXT_PUBLIC_STADTSTACK_PUBLIC_BASE_URL?.trim() ?? "";
  const demoEnabled =
    process.env.NEXT_PUBLIC_STADTSTACK_DEMO_SCENARIO?.trim() === "walkthrough";

  useEffect(() => {
    let active = true;
    if (!baseUrl) {
      setState({ status: "not_configured" });
      return () => {
        active = false;
      };
    }

    setState({ status: "loading" });
    void loadReviewedCivicCases({
      baseUrl,
      municipalityId: "roebel-mueritz",
    })
      .then((result) => {
        if (!active) return;
        setState(
          result.cases.length === 0
            ? { status: "empty" }
            : { status: "ready", cases: result.cases },
        );
      })
      .catch((error: unknown) => {
        if (!active) return;
        setState({ status: classifyMunicipalDecisionCaseFailure(error) });
      });

    return () => {
      active = false;
    };
  }, [baseUrl, reload]);

  const retry = useCallback(() => setReload((value) => value + 1), []);

  return (
    <section aria-labelledby="municipal-cases-heading" className="space-y-3">
      <div className="rounded-[10px] border border-[#00498B]/25 bg-[#00498B]/[0.035] p-4">
        <div className="flex items-start gap-3">
          <span className="mt-0.5 rounded-[8px] bg-[#00498B]/10 p-2 text-[#00498B]">
            <ShieldCheck className="h-5 w-5" />
          </span>
          <div className="min-w-0 flex-1">
            <h3 id="municipal-cases-heading" className="text-sm font-semibold uppercase tracking-wide text-foreground">
              Kommunale Entscheidungsfälle
            </h3>
            <p className="mt-1 text-[12.5px] leading-relaxed text-muted-foreground">
              Lokal geprüfte öffentliche Stadtstack-Information — getrennt von den Abstimmungen unten und keine amtliche Entscheidung der Röbel-App.
            </p>
          </div>
          {baseUrl && state.status !== "loading" && (
            <button
              type="button"
              onClick={retry}
              aria-label="Kommunale Entscheidungsfälle aktualisieren"
              className="shrink-0 rounded-[8px] border border-border bg-card p-2 text-muted-foreground transition hover:text-foreground active:scale-[0.97]"
            >
              <Refresh className="h-4 w-4" />
            </button>
          )}
        </div>
      </div>

      {state.status === "loading" ? (
        <div className="space-y-2" aria-live="polite" aria-label="Entscheidungsfälle werden geladen">
          <Skeleton className="h-[148px]" />
        </div>
      ) : state.status === "ready" ? (
        <div className="space-y-3">
          {state.cases.map((entry) => (
            <MunicipalCaseCard
              key={entry.summary.decisionCaseSlug}
              entry={entry}
              onOpen={() => onOpenCase(entry.summary.publicCaseUrl)}
            />
          ))}
        </div>
      ) : (
        <FederationStateNotice status={state.status} />
      )}

      {demoEnabled && baseUrl && (
        <>
          <DepartmentWalkthrough baseUrl={baseUrl} />
          <ActivityJournalWalkthrough baseUrl={baseUrl} />
        </>
      )}
    </section>
  );
}

function FederationStateNotice({
  status,
}: {
  status: Exclude<ViewState["status"], "loading" | "ready">;
}) {
  const copy = {
    not_configured: {
      title: "Live-Verbindung noch nicht eingerichtet",
      body: "Die öffentliche Stadtstack-Leseschnittstelle ist in dieser Umgebung noch nicht verbunden. Deshalb zeigen wir keinen erfundenen Entscheidungsstand.",
    },
    empty: {
      title: "Noch kein geprüfter Entscheidungsfall veröffentlicht",
      body: "Nur Fälle, die die lokale Prüfung bestanden haben, erscheinen hier. Entwürfe und Fälle in Prüfung bleiben verborgen.",
    },
    not_found: {
      title: "Öffentliche Leseschnittstelle nicht gefunden",
      body: "Die konfigurierte Stadtstack-Schnittstelle liefert derzeit keinen Fallindex. Das ist nicht dasselbe wie ein geprüfter leerer Stand; deshalb zeigen wir keine Fälle an.",
    },
    unavailable: {
      title: "Entscheidungsstand vorübergehend nicht erreichbar",
      body: "Die geprüfte Quelle konnte gerade nicht geladen werden. Es wird kein möglicherweise veralteter Ersatzstand angezeigt.",
    },
    invalid: {
      title: "Entscheidungsdaten konnten nicht sicher geprüft werden",
      body: "Vertrag, Herkunft oder Prüfsumme passen nicht. Der Inhalt bleibt verborgen, bis die Leseschnittstelle wieder eindeutig ist.",
    },
    withdrawn: {
      title: "Veröffentlichter Stand wurde zurückgezogen",
      body: "Der frühere Inhalt bleibt vollständig verborgen. Ein verifizierter Rücknahmehinweis wird in dieser ersten Leseschnittstelle noch nicht angezeigt.",
    },
  }[status];

  return (
    <div aria-live="polite">
      <Card className="border-dashed bg-muted/25 p-4 shadow-none">
        <p className="text-[13px] font-semibold text-foreground">{copy.title}</p>
        <p className="mt-1 text-[12.5px] leading-relaxed text-muted-foreground">{copy.body}</p>
      </Card>
    </div>
  );
}

function MunicipalCaseCard({
  entry,
  onOpen,
}: {
  entry: ReviewedCivicCase;
  onOpen: () => void;
}) {
  const { summary, stageMap } = entry;
  const current = stageMap.current;

  return (
    <Card className="overflow-hidden border-[#00498B]/20 shadow-sm">
      <div className="border-b border-border bg-card p-4">
        <div className="mb-2 flex flex-wrap gap-1.5">
          <Pill tone="primary">{truthLabel[stageMap.truthState]}</Pill>
          <Pill>{authorityLabel[stageMap.participationAuthorityState]}</Pill>
          <Pill>Bürgerinformation</Pill>
        </div>
        <h4 className="text-[15px] font-semibold leading-snug text-foreground">{summary.title}</h4>
        <p className="mt-1.5 text-[12.5px] leading-relaxed text-muted-foreground">{summary.publicSummary}</p>
      </div>

      <div className="space-y-4 p-4">
        <SevenStageRail entry={entry} />

        <div className="rounded-[10px] bg-muted/55 p-3.5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                Aktueller Schritt {current.position} von {current.total}
              </p>
              <p className="mt-0.5 text-[13px] font-semibold text-foreground">{current.label}</p>
            </div>
            <Pill>{lifecycleLabel[current.lifecycle]}</Pill>
          </div>

          <dl className="mt-3 space-y-2 border-t border-border/70 pt-3 text-[12px]">
            {current.owner && (
              <CaseFact label="Verantwortlich" value={current.owner.label} />
            )}
            {current.dueAt && (
              <CaseFact label="Frist" value={formatDate(current.dueAt)} />
            )}
            {current.nextAction && (
              <CaseFact label="Nächster Schritt" value={current.nextAction} />
            )}
            {current.blocker && (
              <CaseFact label="Warum es hier stoppt" value={current.blocker} />
            )}
            {current.waitReason && !current.blocker && (
              <CaseFact label="Worauf gewartet wird" value={current.waitReason} />
            )}
          </dl>
        </div>

        <div className="rounded-[10px] border border-border bg-card p-3.5">
          <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
            Datengrundlage
          </p>
          <p className="mt-1 text-[12.5px] font-semibold text-foreground">
            {entry.manifest.artifacts.length} menschlich geprüfte{entry.manifest.artifacts.length === 1 ? "r Baustein" : " Bausteine"}
          </p>
          <p className="mt-1 text-[11.5px] leading-relaxed text-muted-foreground">
            Nur checksum-gebundene, veröffentlichte Nachweise. Rohdaten und ungeprüfte Verwaltungsunterlagen bleiben verborgen.
          </p>
        </div>

        {/* Deliberately open only the URL confined and resolved from the case
            index. proofRefs and availablePublicAction are never rendered. */}
        <button
          type="button"
          onClick={onOpen}
          className="inline-flex w-full items-center justify-center gap-2 rounded-[10px] bg-[#00498B] px-3 py-2.5 text-[12.5px] font-semibold text-white transition hover:bg-[#1d4e99] active:scale-[0.99]"
        >
          Geprüften Fall öffnen
          <ExternalLink className="h-4 w-4" />
        </button>
      </div>
    </Card>
  );
}

type DepartmentDemoState =
  | { status: "loading" }
  | { status: "ready"; projection: RoebelDepartmentConnectionDemoV1 }
  | { status: "unavailable" };

function DepartmentWalkthrough({ baseUrl }: { baseUrl: string }) {
  const [state, setState] = useState<DepartmentDemoState>({ status: "loading" });

  useEffect(() => {
    let active = true;
    void loadRoebelDepartmentDemo({ baseUrl })
      .then((projection) => {
        if (active) setState({ status: "ready", projection });
      })
      .catch(() => {
        if (active) setState({ status: "unavailable" });
      });
    return () => {
      active = false;
    };
  }, [baseUrl]);

  if (state.status === "loading") {
    return <Skeleton className="h-[132px]" />;
  }
  if (state.status === "unavailable") {
    return (
      <Card className="border-dashed bg-muted/25 p-4 shadow-none">
        <p className="text-[13px] font-semibold text-foreground">Verwaltungsdemo nicht erreichbar</p>
        <p className="mt-1 text-[12px] text-muted-foreground">
          Es wird kein Ersatzstand angezeigt.
        </p>
      </Card>
    );
  }

  const { projection } = state;
  return (
    <Card className="overflow-hidden border-amber-300/70 bg-amber-50/45 shadow-sm">
      <div className="border-b border-amber-200/80 p-4">
        <div className="flex flex-wrap items-center gap-1.5">
          <Pill>Demo · keine amtlichen Antworten</Pill>
          <Pill>{projection.answeredCount} von {projection.totalCount} veröffentlicht</Pill>
        </div>
        <h4 className="mt-2 text-[15px] font-semibold text-foreground">
          So fließen Fachbereichsantworten zurück
        </h4>
        <p className="mt-1 text-[12.5px] leading-relaxed text-muted-foreground">
          Synthetischer Ablauf: Arbeitspaket → Verwaltungsaufgabe → Fachantwort → menschliche Prüfung → Röbel-App.
        </p>
      </div>

      <div className="divide-y divide-border/80 px-4">
        {projection.departments.map((department) => (
          <details key={department.family} className="group py-3">
            <summary className="flex cursor-pointer list-none items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-[12.5px] font-semibold text-foreground">{department.label}</p>
                <p className="mt-0.5 text-[11.5px] text-muted-foreground">{department.summaryLabel}</p>
              </div>
              <span
                className={`mt-1 h-2.5 w-2.5 shrink-0 rounded-full ${
                  department.axes.public === "published"
                    ? "bg-emerald-500"
                    : department.axes.work === "blocked"
                      ? "bg-red-500"
                      : department.axes.transfer === "not_sent"
                        ? "bg-slate-300"
                        : "bg-amber-400"
                }`}
                aria-label={department.summaryLabel}
              />
            </summary>
            <dl className="mt-3 space-y-2 rounded-[8px] bg-white/70 p-3 text-[11.5px]">
              <CaseFact label="Übergabe" value={department.transferLabel} />
              <CaseFact label="Bearbeitung" value={department.workLabel} />
              <CaseFact label="Prüfung" value={department.reviewLabel} />
              <CaseFact label="Öffentlich" value={department.publicLabel} />
              {department.publicAnswer && (
                <CaseFact label="Antwort" value={department.publicAnswer} />
              )}
              <CaseFact label="Nächster Schritt" value={department.nextAction} />
            </dl>
          </details>
        ))}
      </div>
    </Card>
  );
}

type ActivityJournalDemoState =
  | { status: "loading" }
  | {
      status: "ready";
      capabilities: CivicActivityJournalCapabilitiesV1;
      eventList: CivicActivityJournalEventListV1;
    }
  | { status: "unavailable" };

function ActivityJournalWalkthrough({ baseUrl }: { baseUrl: string }) {
  const [state, setState] = useState<ActivityJournalDemoState>({
    status: "loading",
  });

  useEffect(() => {
    let active = true;
    void loadRoebelActivityJournalDemo({ baseUrl })
      .then((result) => {
        if (active) setState({ status: "ready", ...result });
      })
      .catch(() => {
        if (active) setState({ status: "unavailable" });
      });
    return () => {
      active = false;
    };
  }, [baseUrl]);

  if (state.status === "loading") {
    return <Skeleton className="h-[188px]" />;
  }
  if (state.status === "unavailable") {
    return (
      <Card className="border-dashed bg-muted/25 p-4 shadow-none">
        <p className="text-[13px] font-semibold text-foreground">
          Aktivitätsdemo konnte nicht sicher geprüft werden
        </p>
        <p className="mt-1 text-[12px] leading-relaxed text-muted-foreground">
          Verlauf, Herkunft oder Prüfsumme passen nicht. Es wird kein
          rekonstruierter Ersatzstand angezeigt.
        </p>
      </Card>
    );
  }

  const { capabilities, eventList } = state;
  return (
    <Card className="overflow-hidden border-[#00498B]/25 bg-[#00498B]/[0.025] shadow-sm">
      <div className="border-b border-[#00498B]/15 p-4">
        <div className="flex flex-wrap items-center gap-1.5">
          <Pill tone="primary">Demo · rekonstruierter Verlauf</Pill>
          <Pill>kein Live-Status</Pill>
          <Pill>{capabilities.segmentSeal.eventCount} geprüfte Ereignisse</Pill>
        </div>
        <h4 className="mt-2 text-[15px] font-semibold text-foreground">
          Was im Demo-Fall protokolliert wurde
        </h4>
        <p className="mt-1 text-[12.5px] leading-relaxed text-muted-foreground">
          Dieser synthetische Verlauf wurde für die Demo rückwirkend
          rekonstruiert. Er zeigt nur, dass ein Schritt im Demo-Ablauf
          dokumentiert wurde — nicht, was heute in der Verwaltung gilt.
        </p>
        <p className="mt-1.5 text-[11px] leading-relaxed text-muted-foreground">
          Keine Gesprächsinhalte, Tool-Eingaben, internen Dokumente oder
          Abstimmungsdaten.
        </p>
      </div>

      <ol
        aria-label="Rekonstruierter Aktivitätsverlauf des Demo-Falls"
        className="px-4 py-3"
      >
        {eventList.events.map((event, index) => {
          const copy = presentActivityJournalEvent(event);
          return (
            <li
              key={event.eventId}
              className="relative grid grid-cols-[24px_minmax(0,1fr)] gap-2.5 pb-3 last:pb-0"
            >
              {index < eventList.events.length - 1 && (
                <span
                  aria-hidden="true"
                  className="absolute bottom-0 left-[11px] top-6 w-px bg-border"
                />
              )}
              <span
                aria-hidden="true"
                className="relative z-[1] mt-0.5 flex h-6 w-6 items-center justify-center rounded-full border border-[#00498B]/30 bg-card text-[9px] font-semibold text-[#00498B] tnum"
              >
                {event.scopeSequence}
              </span>
              <article className="min-w-0 rounded-[8px] bg-muted/55 px-3 py-2.5">
                <div className="flex flex-wrap items-start justify-between gap-1.5">
                  <p className="min-w-0 text-[11.5px] font-semibold text-foreground">
                    {copy.description}
                  </p>
                  <span className="shrink-0 text-[9.5px] font-medium text-[#00498B]">
                    {copy.status}
                  </span>
                </div>
                <p className="mt-1 text-[9.5px] text-muted-foreground">
                  <time dateTime={event.occurredAt}>
                    {formatJournalTime(event.occurredAt)}
                  </time>
                  {" · "}
                  {copy.actor}
                </p>
              </article>
            </li>
          );
        })}
      </ol>

      <div className="border-t border-[#00498B]/15 px-4 py-3">
        <p className="text-[9.5px] leading-relaxed text-muted-foreground">
          Rekonstruierter Demo-Zeitraum ab{" "}
          <time dateTime={capabilities.scope.coverageStartAt}>
            {formatJournalTime(capabilities.scope.coverageStartAt)}
          </time>
          {" · "}für die Demo rückwirkend rekonstruiert · nur öffentlich
          geprüfte synthetische Metadaten
        </p>
      </div>
    </Card>
  );
}

function SevenStageRail({ entry }: { entry: ReviewedCivicCase }) {
  const currentId = entry.stageMap.primaryCurrentMacroStageId;
  return (
    <div className="overflow-x-auto pb-1">
      <ol
        aria-label="Stufen des kommunalen Entscheidungsfalls"
        className="grid min-w-[560px] grid-cols-7 gap-1.5"
      >
        {entry.stageMap.macroStages.map((stage) => {
          const current = stage.id === currentId;
          const completed = stage.lifecycle === "completed";
          return (
            <li
              key={stage.id}
              aria-current={current ? "step" : undefined}
              className="min-w-0 text-center"
            >
              <div
                className={`mx-auto flex h-7 w-7 items-center justify-center rounded-full border text-[11px] font-semibold tnum ${
                  current
                    ? "border-[#00498B] bg-[#00498B] text-white"
                    : completed
                      ? "border-[#00498B]/40 bg-[#00498B]/10 text-[#00498B]"
                      : "border-border bg-card text-muted-foreground"
                }`}
              >
                {stage.position}
              </div>
              <p className={`mt-1.5 text-[10px] leading-tight ${current ? "font-semibold text-foreground" : "text-muted-foreground"}`}>
                {stage.label}
              </p>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

function CaseFact({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid grid-cols-[112px_1fr] gap-2">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="font-medium leading-relaxed text-foreground">{value}</dd>
    </div>
  );
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("de-DE", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(new Date(value));
}

function formatJournalTime(value: string) {
  return new Intl.DateTimeFormat("de-DE", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Europe/Berlin",
  }).format(new Date(value));
}
