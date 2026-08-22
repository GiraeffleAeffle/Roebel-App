"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import {
  CheckCircle2,
  CircleDollarSign,
  Clock3,
  FileCheck2,
  Landmark,
  Loader2,
  MessageCircleMore,
  ShieldCheck,
  Users,
} from "lucide-react";
import { loadStadtstackAdvisoryCase } from "@/lib/stadtstack/staging-api";
import type { StadtstackAdvisoryCase } from "@/lib/stadtstack/advisory-participation";

function OptionBar({
  label,
  count,
  total,
}: {
  label: string;
  count: number;
  total: number;
}) {
  const percentage = total === 0 ? 0 : Math.round((count / total) * 100);
  return (
    <li className="space-y-1.5">
      <div className="flex items-center justify-between gap-3 text-sm">
        <span className="font-semibold text-foreground">{label}</span>
        <span className="text-muted-foreground">
          {count} von {total} · {percentage}%
        </span>
      </div>
      <div
        className="h-2 overflow-hidden rounded-full bg-emerald-950/10"
        aria-hidden="true"
      >
        <div
          className="h-full rounded-full bg-emerald-600"
          style={{ width: `${percentage}%` }}
        />
      </div>
    </li>
  );
}

export function StadtstackAdvisoryParticipation({
  caseId,
  topicId,
}: {
  caseId?: string | null;
  topicId?: string | null;
}) {
  const [advisoryCase, setAdvisoryCase] =
    useState<StadtstackAdvisoryCase | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const requestId = useRef(0);

  useEffect(() => {
    if (caseId === undefined) return;
    const currentRequestId = ++requestId.current;
    setAdvisoryCase(null);
    setError(null);
    if (!caseId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    void loadStadtstackAdvisoryCase(caseId)
      .then((value) => {
        if (requestId.current === currentRequestId) setAdvisoryCase(value);
      })
      .catch(() => {
        if (requestId.current === currentRequestId)
          setError("Der geprüfte Citizen Brief ist noch nicht verfügbar.");
      })
      .finally(() => {
        if (requestId.current === currentRequestId) setLoading(false);
      });
    return () => {
      if (requestId.current === currentRequestId) requestId.current += 1;
    };
  }, [caseId]);

  return (
    <section
      aria-labelledby="stadtstack-advisory-title"
      className="mb-8 overflow-hidden rounded-xl border border-emerald-700/30 bg-card shadow-sm"
    >
      <header className="bg-emerald-950 px-5 py-5 text-white sm:px-6">
        <div className="flex flex-wrap items-center gap-2 text-xs font-bold uppercase tracking-wide text-emerald-200">
          <ShieldCheck className="h-4 w-4" /> Beratendes Mitmachen · Staging
        </div>
        <h2 id="stadtstack-advisory-title" className="mt-2 text-xl font-bold">
          Citizen Brief aus öffentlicher Diskussion
        </h2>
        <p className="mt-1 text-sm leading-6 text-emerald-100">
          Getrennt von formaler Governance, Ratsentscheidung und Stadtkasse.
        </p>
        {topicId && (
          <Link
            href={`/app/themen/${encodeURIComponent(topicId)}`}
            className="mt-3 inline-flex items-center text-sm font-bold text-emerald-100 hover:text-white hover:underline"
          >
            Zurück zum Bürger-Thema
          </Link>
        )}
      </header>

      {caseId === undefined || loading ? (
        <div className="flex min-h-40 items-center justify-center gap-2 p-6 text-sm text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin" /> Geprüften Fall laden…
        </div>
      ) : !caseId ? (
        <div className="p-6 text-sm leading-6 text-muted-foreground">
          Öffne Mitmachen aus einem Bürger-Thema mit aktuellem Citizen Brief. So
          bleibt der öffentliche Fall exakt gebunden und wird nicht als
          losgelöster Vorschlag angezeigt.
        </div>
      ) : error || !advisoryCase ? (
        <div className="p-6 text-sm text-muted-foreground">
          {error ?? "Noch kein beratender Fall vorhanden."}
        </div>
      ) : (
        <div className="space-y-6 p-5 sm:p-6">
          <div>
            <div className="flex flex-wrap gap-2 text-xs font-semibold">
              <span className="rounded-full bg-emerald-100 px-2.5 py-1 text-emerald-900">
                <CheckCircle2 className="mr-1 inline h-3.5 w-3.5" />
                Citizen Brief geprüft
              </span>
              <span className="rounded-full bg-sky-100 px-2.5 py-1 text-sky-900">
                Fallversion {advisoryCase.caseVersion}
              </span>
              <span className="rounded-full bg-violet-100 px-2.5 py-1 text-violet-950">
                {advisoryCase.participationState === "brief_ready"
                  ? "Beteiligung vorbereitet"
                  : "Beratendes Ergebnis geprüft"}
              </span>
              <span className="rounded-full bg-amber-100 px-2.5 py-1 text-amber-950">
                Nicht bindend
              </span>
            </div>
            <h3 className="mt-3 text-lg font-bold text-foreground">
              {advisoryCase.title}
            </h3>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">
              {advisoryCase.summary}
            </p>
            <p className="mt-2 break-all text-xs text-muted-foreground">
              Citizen-Brief-Prüfsumme: <code>{advisoryCase.briefChecksum}</code>
            </p>
          </div>

          <div className="grid gap-3 sm:grid-cols-3">
            <div className="rounded-lg border border-border bg-muted/40 p-3">
              <FileCheck2 className="h-5 w-5 text-primary" />
              <p className="mt-2 text-xl font-bold">
                {advisoryCase.reviewedDepartmentCount}
              </p>
              <p className="text-xs text-muted-foreground">
                geprüfte Fachbereiche
              </p>
            </div>
            {advisoryCase.participationState === "result_current" ? (
              <div className="rounded-lg border border-border bg-muted/40 p-3">
                <Users className="h-5 w-5 text-primary" />
                <p className="mt-2 text-xl font-bold">
                  {advisoryCase.participation.totalAccepted}
                </p>
                <p className="text-xs text-muted-foreground">
                  synthetische Beiträge
                </p>
              </div>
            ) : (
              <div className="rounded-lg border border-border bg-muted/40 p-3">
                <Clock3 className="h-5 w-5 text-primary" />
                <p className="mt-2 text-sm font-bold">Noch nicht geöffnet</p>
                <p className="text-xs text-muted-foreground">
                  keine Stimmen, kein Ergebnis
                </p>
              </div>
            )}
            <div className="rounded-lg border border-border bg-muted/40 p-3">
              <MessageCircleMore className="h-5 w-5 text-primary" />
              <p className="mt-2 text-sm font-bold">Nostr-signiert</p>
              <Link
                href={`/app/diskussion/${advisoryCase.sourceDiscussionId}`}
                className="text-xs font-semibold text-primary hover:underline"
              >
                Diskussion öffnen
              </Link>
            </div>
          </div>

          <div className="rounded-xl border border-sky-200 bg-sky-50 p-4">
            <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wide text-sky-950">
              <CircleDollarSign className="h-4 w-4" /> Geprüfter Budgetkontext
            </div>
            <p className="mt-2 text-sm leading-6 text-sky-950">
              {advisoryCase.budgetContext.publicSummary}
            </p>
            <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs text-sky-900">
              <span>
                Arbeitspaket{" "}
                {advisoryCase.budgetContext.packageBinding.packageId}
              </span>
              <span>
                {advisoryCase.budgetContext.publicCitations.length} öffentliche
                Quellenangabe
                {advisoryCase.budgetContext.publicCitations.length === 1
                  ? ""
                  : "n"}
              </span>
            </div>
            <p className="mt-2 text-xs leading-5 text-sky-900">
              Das ist die öffentlich geprüfte Finanzantwort zu diesem Fall,
              keine Mittelzusage und kein Kassenauftrag.
            </p>
          </div>

          {advisoryCase.participationState === "brief_ready" ? (
            <div className="rounded-xl border border-violet-200 bg-violet-50 p-4 text-violet-950">
              <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wide">
                <Clock3 className="h-4 w-4" /> Bereit für Mitmachen
              </div>
              <h3 className="mt-2 font-bold">
                Der aktuelle Citizen Brief ist sichtbar; die Beteiligung ist
                noch nicht geöffnet.
              </h3>
              <p className="mt-2 text-sm leading-6">
                Es wurden noch keine Eingaben angenommen und es gibt noch kein
                Meinungsbild. Ein eigener, geprüfter Beteiligungszeitraum mit
                Regeln und signierten Eingaben ist der nächste getrennte
                Schritt.
              </p>
            </div>
          ) : (
            <>
              <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4">
                <h3 className="font-bold text-emerald-950">
                  {advisoryCase.participation.question}
                </h3>
                <ul className="mt-4 space-y-4">
                  {advisoryCase.participation.options.map((option) => (
                    <OptionBar
                      key={option.id}
                      label={option.label}
                      count={option.count}
                      total={advisoryCase.participation.totalAccepted}
                    />
                  ))}
                </ul>
                <p className="mt-4 text-sm leading-6 text-emerald-950">
                  {advisoryCase.participation.resultSummary}
                </p>
              </div>

              <div className="rounded-lg border border-border bg-muted/30 p-4">
                <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground">
                  Geprüftes Ergebnis
                </p>
                <p className="mt-1 text-sm leading-6 text-foreground">
                  {advisoryCase.participation.outcomeSummary}
                </p>
              </div>
            </>
          )}

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="rounded-lg border border-border p-3">
              <div className="flex items-center gap-2 text-sm font-bold">
                <Landmark className="h-4 w-4" /> Keine formale Abstimmung
              </div>
              <p className="mt-1 text-xs leading-5 text-muted-foreground">
                Das Meinungsbild berät; es erzeugt keinen Ratsbeschluss und
                keine Governance-Wirkung.
              </p>
            </div>
            <div className="rounded-lg border border-border p-3">
              <div className="flex items-center gap-2 text-sm font-bold">
                <CircleDollarSign className="h-4 w-4" /> Keine Treasury-Wirkung
              </div>
              <p className="mt-1 text-xs leading-5 text-muted-foreground">
                Budgetbedarf bleibt Verwaltungsprüfung; es wird keine Auszahlung
                ausgelöst.
              </p>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
