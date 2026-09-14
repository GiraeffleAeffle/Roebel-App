"use client";

import { useEffect, useState } from "react";
import { readSyntheticBriefResponse, syntheticBriefPath, type SyntheticCitizenBriefBinding, type SyntheticCitizenBriefReturn }
  from "@roebel/stadtstack-federation-client";
import { BriefResponses } from "../administration-review/BriefResponses";

/** A separate demo view. It cannot open the municipal Mitmachen or vote lane. */
export function SyntheticCitizenBrief({ binding }: { binding: SyntheticCitizenBriefBinding }) {
  const [value, setValue] = useState<SyntheticCitizenBriefReturn | null>(null);
  const [error, setError] = useState(false), [revision, setRevision] = useState(0);
  const { caseId, discussionId, topicId } = binding;
  useEffect(() => {
    const controller = new AbortController();
    setValue(null); setError(false);
    void fetch(syntheticBriefPath(discussionId), { credentials: "omit", cache: "no-store", redirect: "error",
      signal: AbortSignal.any([controller.signal, AbortSignal.timeout(10_000)]) })
      .then(response => readSyntheticBriefResponse(response, { caseId, discussionId, topicId }))
      .then(result => { if (!controller.signal.aborted) setValue(result); })
      .catch(() => { if (!controller.signal.aborted) setError(true); });
    return () => controller.abort();
  }, [caseId, discussionId, topicId, revision]);
  return <section className="mt-5 space-y-4 rounded-xl border border-amber-300 bg-amber-50 p-5" aria-label="Rücklauf aus dem Test-Arbeitsbereich">
    <div className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-xs font-semibold text-amber-900">Synthetischer Test · keine amtliche Stellungnahme</p>
      <h2 className="mt-1 text-lg font-bold">Rücklauf aus dem Town Workspace</h2></div>
      <button type="button" className="rounded-lg border bg-white px-3 py-2 text-sm" onClick={() => setRevision(r => r + 1)}>Rücklauf aktualisieren</button></div>
    {error ? <p role="status">Der aktuelle Rücklauf ist gerade nicht erreichbar. Eine frühere Fassung wird nicht als aktuell angezeigt.</p>
      : !value ? <p role="status">Geprüften Rücklauf laden …</p>
      : value.status === "not_ready" ? <p>Noch keine Bürger-Kurzfassung freigegeben. Sie wird nach den Fachprüfungen und der anschließenden Bestätigung im Workspace sichtbar.</p>
      : value.status === "withdrawn" ? <p role="status">Die bisherige Kurzfassung ist nicht mehr aktuell. Geänderte Fachantworten müssen erneut geprüft und zusammengeführt werden.</p>
      : value.brief && <><p className="font-semibold">{value.brief.title}</p>
        <p className="text-sm">Diese Kurzfassung enthält die acht geprüften Testantworten. Sie wurde vom Case Steward bestätigt. Quellen, offene Fragen und nächste Prüfschritte bleiben pro Fachbereich nachvollziehbar.</p>
        <BriefResponses responses={value.brief.responses} />
        <p className="break-all text-xs">Fallversion {value.caseVersion} · Brief-Prüfsumme {value.brief.briefChecksum}</p>
        <p className="text-sm">Mecky kann diese Fassung als Testquelle zitieren. Sie belegt keine tatsächliche Prüfung oder Entscheidung der Stadt.</p></>}
    <a href={`/verwaltung?discussion=${discussionId}`} className="inline-block text-sm font-semibold text-primary underline">Originalthema im Town Workspace öffnen</a>
  </section>;
}
