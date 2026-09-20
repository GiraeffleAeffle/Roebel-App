"use client";

import type { SyntheticCitizenBriefBinding } from "@roebel/stadtstack-federation-client";
import type { useSyntheticCitizenBrief } from "../../lib/stadtstack/use-synthetic-citizen-brief";
import { BriefResponses } from "../administration-review/BriefResponses";
import { discussionFollowUpHref } from "../../lib/stadtstack/discussion-follow-up";

export function SyntheticCitizenBrief({ binding, state, sourcePostId }: {
  binding: SyntheticCitizenBriefBinding; sourcePostId?: string; state: ReturnType<typeof useSyntheticCitizenBrief>;
}) {
  const { value, error, refresh } = state;
  return <section id="citizen-brief" className="scroll-mt-24 space-y-4 rounded-2xl border border-emerald-200 bg-card p-5 sm:p-6" aria-label="Rücklauf aus den Fachbereichen">
    <div className="flex flex-wrap items-start justify-between gap-3"><div>
      <p className="text-xs font-semibold text-emerald-700">Town Workspace → Diskussion</p>
      <h2 className="mt-1 text-xl font-bold">{value?.status === "current" ? "Die Antworten sind zurück" : "Rücklauf aus den Fachbereichen"}</h2></div>
      <button type="button" className="rounded-lg border px-3 py-2 text-xs text-muted-foreground" onClick={refresh}>Aktualisieren</button></div>
    {error ? <p role="status">Der aktuelle Rücklauf ist gerade nicht erreichbar. Eine frühere Fassung wird nicht als aktuell angezeigt.</p>
      : !value ? <p role="status">Geprüften Rücklauf laden …</p>
      : value.status === "not_ready" ? <p>Noch keine Kurzfassung bestätigt. Die Fachbereiche arbeiten an ihren Antworten.</p>
      : value.status === "withdrawn" ? <p role="status">Die bisherige Kurzfassung ist nicht mehr aktuell. Geänderte Fachantworten müssen erneut geprüft werden.</p>
      : value.brief && <>
        <p className="text-sm leading-6">{value.brief.responses.length} Fachantworten wurden geprüft und vom Case Steward als gemeinsame Kurzfassung bestätigt. Lies die Ergebnisse und bring Rückfragen in die Diskussion ein.</p>
        <BriefResponses responses={value.brief.responses} collapsible />
        <div className="flex flex-wrap gap-3 text-sm font-semibold">
          <a href={`/app/diskussion/${binding.discussionId}#discussion-arguments`} className="rounded-full bg-primary px-4 py-2 text-primary-foreground">Rücklauf diskutieren</a>
          <a href={sourcePostId ? discussionFollowUpHref(binding.discussionId, sourcePostId) : "/app/mecky"} className="rounded-full border px-4 py-2 text-primary">{sourcePostId ? "Öffentliche Rückfrage an Mecky" : "Mecky zu den Antworten fragen"}</a>
        </div>
        <details className="text-xs text-muted-foreground"><summary className="cursor-pointer">Version und Prüfnachweis</summary>
          <p className="mt-2">Szenario im Staging · Quellen und Annahmen bleiben in den Fachantworten nachvollziehbar.</p>
          <p className="mt-2 break-all">Fallversion {value.caseVersion} · Brief-Prüfsumme {value.brief.briefChecksum}</p></details>
      </>}
    <a href={`/verwaltung?discussion=${binding.discussionId}`} className="inline-block text-xs font-semibold text-primary underline">Bearbeitung im Town Workspace ansehen ↗</a>
  </section>;
}
