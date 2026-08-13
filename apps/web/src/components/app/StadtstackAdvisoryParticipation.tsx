"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import {
  Bot,
  CheckCircle2,
  CircleDollarSign,
  FileCheck2,
  Landmark,
  Loader2,
  MessageCircleMore,
  ShieldCheck,
  Users,
} from "lucide-react";
import { stagingPost } from "@/lib/stadtstack/staging-api";
import {
  toStadtstackAdvisoryCase,
  type StadtstackAdvisoryCase,
} from "@/lib/stadtstack/advisory-participation";

function OptionBar({ label, count, total }: { label: string; count: number; total: number }) {
  const percentage = total === 0 ? 0 : Math.round((count / total) * 100);
  return (
    <li className="space-y-1.5">
      <div className="flex items-center justify-between gap-3 text-sm">
        <span className="font-semibold text-foreground">{label}</span>
        <span className="text-muted-foreground">{count} von {total} · {percentage}%</span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-emerald-950/10" aria-hidden="true">
        <div className="h-full rounded-full bg-emerald-600" style={{ width: `${percentage}%` }} />
      </div>
    </li>
  );
}

export function StadtstackAdvisoryParticipation() {
  const [advisoryCase, setAdvisoryCase] = useState<StadtstackAdvisoryCase | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void stagingPost<unknown>("/view", { profile: "public" })
      .then((value) => {
        const projected = toStadtstackAdvisoryCase(value);
        if (active) setAdvisoryCase(projected);
      })
      .catch(() => {
        if (active) setError("Der geprüfte Citizen Brief ist noch nicht verfügbar.");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => { active = false; };
  }, []);

  return (
    <section aria-labelledby="stadtstack-advisory-title" className="mb-8 overflow-hidden rounded-xl border border-emerald-700/30 bg-card shadow-sm">
      <header className="bg-emerald-950 px-5 py-5 text-white sm:px-6">
        <div className="flex flex-wrap items-center gap-2 text-xs font-bold uppercase tracking-wide text-emerald-200">
          <ShieldCheck className="h-4 w-4" /> Beratendes Mitmachen · Staging
        </div>
        <h2 id="stadtstack-advisory-title" className="mt-2 text-xl font-bold">Citizen Brief aus öffentlicher Diskussion</h2>
        <p className="mt-1 text-sm leading-6 text-emerald-100">Getrennt von formaler Governance, Ratsentscheidung und Stadtkasse.</p>
      </header>

      {loading ? (
        <div className="flex min-h-40 items-center justify-center gap-2 p-6 text-sm text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin" /> Geprüften Fall laden…
        </div>
      ) : error || !advisoryCase ? (
        <div className="p-6 text-sm text-muted-foreground">{error ?? "Noch kein beratender Fall vorhanden."}</div>
      ) : (
        <div className="space-y-6 p-5 sm:p-6">
          <div>
            <div className="flex flex-wrap gap-2 text-xs font-semibold">
              <span className="rounded-full bg-emerald-100 px-2.5 py-1 text-emerald-900"><CheckCircle2 className="mr-1 inline h-3.5 w-3.5" />Citizen Brief geprüft</span>
              <span className="rounded-full bg-sky-100 px-2.5 py-1 text-sky-900">Fallversion {advisoryCase.caseVersion}</span>
              <span className="rounded-full bg-amber-100 px-2.5 py-1 text-amber-950">Nicht bindend</span>
            </div>
            <h3 className="mt-3 text-lg font-bold text-foreground">{advisoryCase.title}</h3>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">{advisoryCase.summary}</p>
          </div>

          <div className="grid gap-3 sm:grid-cols-3">
            <div className="rounded-lg border border-border bg-muted/40 p-3"><FileCheck2 className="h-5 w-5 text-primary" /><p className="mt-2 text-xl font-bold">{advisoryCase.reviewedDepartmentCount}</p><p className="text-xs text-muted-foreground">geprüfte Fachbereiche</p></div>
            <div className="rounded-lg border border-border bg-muted/40 p-3"><Users className="h-5 w-5 text-primary" /><p className="mt-2 text-xl font-bold">{advisoryCase.totalAccepted}</p><p className="text-xs text-muted-foreground">synthetische Beiträge</p></div>
            <div className="rounded-lg border border-border bg-muted/40 p-3"><MessageCircleMore className="h-5 w-5 text-primary" /><p className="mt-2 text-sm font-bold">Nostr-signiert</p><Link href={`/app/diskussion/${advisoryCase.sourceDiscussionId}`} className="text-xs font-semibold text-primary hover:underline">Diskussion öffnen</Link></div>
          </div>

          <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4">
            <h3 className="font-bold text-emerald-950">{advisoryCase.question}</h3>
            <ul className="mt-4 space-y-4">{advisoryCase.options.map((option) => <OptionBar key={option.id} label={option.label} count={option.count} total={advisoryCase.totalAccepted} />)}</ul>
            <p className="mt-4 text-sm leading-6 text-emerald-950">{advisoryCase.resultSummary}</p>
          </div>

          <div className="rounded-lg border border-border bg-muted/30 p-4">
            <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground">Geprüftes Ergebnis</p>
            <p className="mt-1 text-sm leading-6 text-foreground">{advisoryCase.outcomeSummary}</p>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="rounded-lg border border-border p-3"><div className="flex items-center gap-2 text-sm font-bold"><Landmark className="h-4 w-4" /> Keine formale Abstimmung</div><p className="mt-1 text-xs leading-5 text-muted-foreground">Das Meinungsbild berät; es erzeugt keinen Ratsbeschluss und keine Governance-Wirkung.</p></div>
            <div className="rounded-lg border border-border p-3"><div className="flex items-center gap-2 text-sm font-bold"><CircleDollarSign className="h-4 w-4" /> Keine Treasury-Wirkung</div><p className="mt-1 text-xs leading-5 text-muted-foreground">Budgetbedarf bleibt Verwaltungsprüfung; es wird keine Auszahlung ausgelöst.</p></div>
          </div>
        </div>
      )}
    </section>
  );
}
