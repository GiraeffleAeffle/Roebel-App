import { useCallback, useEffect, useState } from "react";
import {
  loadReviewedCivicCases,
  type ReviewedCivicCase,
} from "@roebel/stadtstack-federation-client";
import { Card, Pill, Skeleton } from "../components/ui";
import { ExternalLink, Refresh, ShieldCheck } from "../components/icons";
import {
  classifyMunicipalDecisionCaseFailure,
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
