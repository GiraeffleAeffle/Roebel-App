"use client";

import { useEffect, useRef, useState } from "react";

type Role = { id: string; label: string; actorClass: string };
type Package = { id: string; departmentId: string; request: string; packageChecksum: string;
  reviewState: string; draft?: { artifactChecksum: string; publicSummary: string; publicCitations: string[] } };
type View = { caseVersion: number; suggestion: { title: string; summary: string | null };
  departmentPackages: Package[]; briefReadiness: { status: string; acceptedDepartmentIds: string[] } | null };
const ENDPOINT = "/api/workspace/case-review";
const statusText: Record<string, string> = { assigned: "Zur Bearbeitung", draft_pending_review: "Prüfung ausstehend", accepted: "Geprüft", rejected: "Überarbeitung nötig" };
const departments: Record<string, string> = { planning: "Stadtplanung", traffic: "Verkehr", environment: "Umwelt", finance: "Finanzen",
  legal: "Recht", "public-order": "Öffentliche Ordnung", "social-affairs": "Soziales", "public-works": "Technische Dienste" };
const button = "rounded-lg bg-[#00498B] px-4 py-2 text-sm font-medium text-white disabled:opacity-50";

export default function AdministrationWorkspace() {
  const [roles, setRoles] = useState<Role[]>([]), [role, setRole] = useState("");
  const [view, setView] = useState<View | null>(null), [message, setMessage] = useState("Arbeitsbereich wird geladen …");
  const [login, setLogin] = useState(false), [busy, setBusy] = useState(false), [revision, setRevision] = useState(0);
  const generation = useRef(0);
  const active = roles.find((item) => item.id === role);
  useEffect(() => {
    const controller = new AbortController();
    fetch(ENDPOINT, { cache: "no-store", signal: controller.signal }).then(async (response) => {
      if (!response.ok) { setLogin(response.status === 401); throw Error(response.status === 403 ? "Für dieses Konto ist keine Verwaltungsrolle zugewiesen." : "Die Verbindung zur Verwaltung ist noch nicht verfügbar."); }
      const result = await response.json(); setRoles(result.roles); setRole(result.roles[0]?.id ?? ""); setMessage("");
    }).catch((error) => { if (!controller.signal.aborted) setMessage(error.message); });
    return () => controller.abort();
  }, []);
  useEffect(() => {
    generation.current++; setView(null);
    if (!role) return;
    const controller = new AbortController();
    fetch(`${ENDPOINT}?role=${encodeURIComponent(role)}`, { cache: "no-store", signal: controller.signal }).then(async (response) => {
      if (!response.ok) throw Error("Der Fall kann momentan nicht geladen werden. Bitte später erneut versuchen.");
      const result = await response.json(); if (!controller.signal.aborted) { setView(result); setMessage(""); }
    }).catch((error) => { if (!controller.signal.aborted) setMessage(error.message); });
    return () => controller.abort();
  }, [role, revision]);
  async function submit(operation: "draft" | "review", payload: unknown) {
    if (!view || busy) return;
    const current = generation.current;
    setBusy(true); setMessage("");
    try {
      const response = await fetch(`${ENDPOINT}?role=${encodeURIComponent(role)}`, { method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ schemaVersion: "administration_review_request_v1", operation, expectedCaseVersion: view.caseVersion, payload }) });
      if (current !== generation.current) return;
      if (!response.ok) { setMessage(response.status === 409 ? "Der Fall wurde inzwischen verändert. Bitte neu laden und die aktuelle Fassung prüfen." : "Speichern nicht bestätigt. Bitte den Fall neu laden, bevor du erneut sendest."); return; }
      setRevision((value) => value + 1);
    } catch { if (current === generation.current) setMessage("Speichern nicht bestätigt. Bitte neu laden und den aktuellen Stand prüfen."); }
    finally { setBusy(false); }
  }
  return <main className="mx-auto max-w-5xl space-y-6 px-5 py-10 text-slate-800">
    <header className="flex flex-wrap items-start justify-between gap-4"><div><p className="text-sm font-semibold text-[#00498B]">Röbel · Town Workspace</p>
      <h1 className="mt-2 text-3xl font-semibold">Gemeinsam am Fall arbeiten</h1><p className="mt-2 text-slate-600">Fachliche Antworten sammeln, prüfen und für die Bürgerinnen und Bürger aufbereiten.</p></div>
      <a href="/app" className="text-sm text-[#00498B] underline">Zur Bürger-App</a></header>
    <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm">Testumgebung · Rollen und Fall sind ausdrücklich für den Test vergeben. Eine Testprüfung ist keine amtliche Entscheidung.</div>
    <div className="flex flex-wrap items-center gap-3">
      {roles.length > 0 && <label className="text-sm font-medium">Arbeiten als <select aria-label="Zugewiesene Testrolle" value={role} disabled={busy} onChange={(event) => { setView(null); setRole(event.target.value); }} className="ml-2 rounded-lg border bg-white p-2">{roles.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label>}
      {role && <button className="rounded-lg border px-4 py-2 text-sm" disabled={busy} onClick={() => setRevision((value) => value + 1)}>Aktualisieren</button>}
    </div>
    {message && <p role="status" className="rounded-xl border bg-slate-50 p-4">{message}</p>}
    {login && <a className={button} href="/api/workspace/auth/login?returnTo=%2Fverwaltung">Mit bestehendem Konto anmelden</a>}
    {view && <><section className="rounded-2xl border bg-white p-6"><p className="text-xs uppercase tracking-wide text-slate-500">Übernommener Fall · Stand {view.caseVersion}</p>
      <h2 className="mt-2 text-2xl font-semibold">{view.suggestion.title}</h2>{view.suggestion.summary && <p className="mt-3 text-slate-600">{view.suggestion.summary}</p>}
      <p className="mt-4 text-sm">{view.briefReadiness ? `${view.briefReadiness.acceptedDepartmentIds.length} Fachbereiche geprüft. ${view.briefReadiness.status === "citizen_brief_current" ? "Die Bürger-Kurzfassung liegt vor." : "Die Bürger-Kurzfassung ist noch nicht abgeschlossen."}` : "Hier siehst du die Arbeitspakete deiner zugewiesenen Rolle."}</p></section>
      {view.departmentPackages.length === 0 && <p className="rounded-xl border border-dashed p-6 text-slate-600">Für diese Rolle liegt noch kein zugewiesenes Arbeitspaket vor. Die Fallkoordination bereitet die Zuweisung vor.</p>}
      {view.departmentPackages.map((item) => <section key={`${item.id}:${view.caseVersion}`} className="space-y-4 rounded-2xl border bg-white p-6">
        <div className="flex items-center justify-between gap-3"><h2 className="text-xl font-semibold">{departments[item.departmentId] ?? item.departmentId}</h2><span className="rounded-full bg-slate-100 px-3 py-1 text-xs">{statusText[item.reviewState] ?? "Stand prüfen"}</span></div><p>{item.request}</p>
        {item.draft && <div className="rounded-xl bg-slate-50 p-4"><h3 className="font-medium">Antwortentwurf</h3><p className="mt-2 whitespace-pre-wrap">{item.draft.publicSummary}</p><ul className="mt-3 text-sm text-slate-600">{item.draft.publicCitations.map((ref) => <li key={ref} className="break-all">{ref}</li>)}</ul></div>}
        {active?.actorClass === "department_agent" && <form className="space-y-3" onSubmit={(event) => { event.preventDefault(); const data = new FormData(event.currentTarget);
          void submit("draft", { packageId: item.id, packageChecksum: item.packageChecksum, draft: { schemaVersion: "department_draft_v1", id: `draft:${crypto.randomUUID()}`,
            publicSummary: String(data.get("summary")), publicCitations: String(data.get("sources")).split("\n").map((s) => s.trim()).filter(Boolean), privateEvidenceRefs: [], authorityBinding: "none" } }); }}>
          <label className="block text-sm font-medium">Öffentlich verständliche Antwort<textarea name="summary" required maxLength={4000} defaultValue={item.draft?.publicSummary ?? ""} className="mt-1 block min-h-28 w-full rounded-lg border p-3" /></label>
          <label className="block text-sm font-medium">Quellen (eine Referenz pro Zeile)<textarea name="sources" required defaultValue={item.draft?.publicCitations.join("\n") ?? ""} className="mt-1 block w-full rounded-lg border p-3" /></label>
          <button className={button} disabled={busy}>Entwurf zur Prüfung speichern</button></form>}
        {active?.actorClass === "department_reviewer" && item.draft && <div className="space-y-3"><p className="text-sm text-slate-600">Prüfe Aussage und Quellen. Deine Entscheidung bezieht sich auf genau diese Fassung.</p><div className="flex gap-3">
          {([ ["accepted", "Fassung bestätigen"], ["rejected", "Überarbeitung anfordern"] ] as const).map(([decision, label]) => <button key={decision} className={button} disabled={busy} onClick={() => void submit("review", { review: { packageId: item.id, draftArtifactChecksum: item.draft!.artifactChecksum, decision, reviewedAt: new Date().toISOString() } })}>{label}</button>)}
        </div></div>}
      </section>)}</>}
  </main>;
}
