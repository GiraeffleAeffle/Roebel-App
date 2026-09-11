"use client";
import { departmentOverview, matchingCase, type OverviewCase, type TopicOrigin } from "../../lib/administration-review/overview";
import { STADTSTACK_REQUIRED_DEPARTMENTS } from "../../lib/stadtstack/administration-progress";
const labels = Object.fromEntries(STADTSTACK_REQUIRED_DEPARTMENTS.map(d => [d.id, d.label]));
function displayTime(value: string) {
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? new Intl.DateTimeFormat("de-DE", {dateStyle:"medium", timeStyle:"short", timeZone:"Europe/Berlin"}).format(date) : "Zeitpunkt nicht verfügbar";
}
const states: Record<string, string> = { unknown: "Stand unbekannt", unassigned: "Auftrag fehlt", assigned: "Antwort fehlt", pending: "Prüfung fehlt", rejected: "Überarbeitung nötig", blocked: "Klärung nötig", accepted: "Geprüft" };

export function TopicOverview({ origin, view }: { origin: TopicOrigin | null; view: OverviewCase | null }) {
  const current = matchingCase(origin, view);
  const wholeCase = current?.briefReadiness;
  const ids = current ? wholeCase?.requiredDepartmentIds ?? [...new Set(current.departmentPackages.map(p => p.departmentId))]
    : STADTSTACK_REQUIRED_DEPARTMENTS.map(d => d.id);
  const departments = departmentOverview(ids, current);
  const accepted = departments.filter(d => d.state === "accepted").length;
  return <section aria-label="Thema und Bearbeitungsgraph" className="space-y-6 rounded-2xl border border-slate-200 bg-white p-5 sm:p-7">
    <div><p className="text-xs font-semibold uppercase tracking-wide text-primary">{origin ? "Originalthema aus der Röbel-App" : "Verlauf dieses Testfalls"}</p>
      <h2 className="mt-2 text-2xl font-semibold">{origin?.title ?? "Wer arbeitet woran – was fehlt noch?"}</h2>
      {origin && <><p className="mt-3 text-slate-600">{origin.content}</p><a className="mt-3 inline-block text-primary underline" href={`/app/diskussion/${origin.rootId}`}>Ausgangsdiskussion öffnen ↗</a>
        <p className="mt-2 text-sm text-slate-500">{origin.testOnly ? "Synthetischer Staging-Fall · keine amtliche Übernahme" : "Öffentlich belegte Fallverknüpfung"}</p></>}
    </div>
    {origin && !current && <p role="status" className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm">Diskussion und Fallverknüpfung sind öffentlich belegt. Der authentifizierte Verwaltungsstand dieses Falls ist noch nicht verbunden. Zuständigkeiten, Antworten und Prüfungen können hier deshalb noch nicht bestätigt werden.</p>}
    <div aria-label="Ablauf" className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      {[ ["1 · Diskussion", origin ? "Originalquelle verknüpft" : "Lokaler Testfall"], ["2 · Fall", origin ? `Übernahmebeleg · Stand ${origin.admissionVersion}` : `Stand ${current?.caseVersion ?? "unbekannt"}`],
        ["3 · Fachbereiche", current ? `${accepted} von ${ids.length} sichtbar geprüft` : "Verbindung ausstehend"],
        ["4 · Rücklauf zur App", wholeCase?.status === "citizen_brief_current" ? "Kurzfassung vorhanden; App-Rücklauf nicht bestätigt" : "Bürger-Kurzfassung hier noch nicht bestätigt"] ].map(([title, detail]) =>
        <div key={title} className="rounded-xl border border-slate-200 bg-slate-50 p-4"><h3 className="font-semibold">{title}</h3><p className="mt-2 text-sm text-slate-600">{detail}</p></div>)}
    </div>
    <div className="text-center"><div className="inline-block rounded-full bg-primary px-5 py-2 text-sm font-semibold text-white">Ein Thema · gemeinsame Fallverknüpfung</div><div aria-hidden="true" className="mx-auto h-5 w-px bg-slate-300" /></div>
    <div className="grid grid-cols-2 gap-3 border-t border-slate-300 pt-4 lg:grid-cols-4">
      {departments.map(d => <article key={d.id} className={`relative break-words rounded-xl border p-4 ${d.state === "accepted" ? "border-emerald-300 bg-emerald-50" : "border-slate-200 bg-slate-50"}`}>
        <span aria-hidden="true" className="absolute -top-4 left-1/2 h-4 w-px bg-slate-300" />
        <h3 className="font-semibold">{labels[d.id] ?? d.id}</h3><p className="mt-2 text-sm font-semibold">{states[d.state]}</p><p className="mt-2 text-sm text-slate-600">{d.next}</p>
        {d.packages.map(pkg => <a key={pkg.id} href={`#work-${encodeURIComponent(pkg.id)}`} className="mt-3 block text-sm text-primary underline">Arbeitspaket · {pkg.draft?.publicCitations.length ?? 0} Quellen</a>)}
      </article>)}
    </div>
    <p className="text-xs text-slate-500">{current && !wholeCase ? "Nur die für deine Rolle sichtbaren Arbeitspakete. Kein Gesamtstatus der übrigen Fachbereiche." : "Die Verbindungen zeigen die gemeinsame Fallzuordnung. Abhängigkeiten zwischen Fachbereichen und Fristen sind im aktuellen Datenmodell noch nicht erfasst."}</p>
    {origin && <details className="border-t border-slate-200 pt-4"><summary className="cursor-pointer font-semibold">Quellverlauf und Übernahmebeleg</summary>
      <ol className="mt-4 space-y-4 border-l-2 border-slate-200 pl-5">{origin.sources.map(source => <li key={source.id}><time className="text-xs text-slate-500">{displayTime(source.createdAt)}</time><p className="mt-1 text-sm">{source.content}</p></li>)}
        <li><time className="text-xs text-slate-500">{displayTime(origin.createdAt)}</time><p className="text-sm">Diskussion im Originalthema</p></li>
        <li className="text-sm">Fallübernahme belegt · Version {origin.admissionVersion}. Der öffentliche Beleg enthält keinen Übernahmezeitpunkt.</li></ol>
      <dl className="mt-4 space-y-2 break-all text-xs text-slate-500"><dt>Fall-ID</dt><dd>{origin.caseId}</dd><dt>Übernahmebeleg</dt><dd>{origin.receiptChecksum}</dd></dl>
      <p className="mt-3 text-xs text-slate-500">Der vollständige administrative Ereignisverlauf ist über diese Schnittstelle noch nicht verfügbar.</p></details>}
  </section>;
}
