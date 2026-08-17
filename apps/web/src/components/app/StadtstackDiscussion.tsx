"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  Bot,
  CheckCircle2,
  CircleDollarSign,
  FileSignature,
  GitFork,
  Landmark,
  Loader2,
  MessageCircleMore,
  PieChart,
  RefreshCw,
  ShieldAlert,
  Vote,
} from "lucide-react";
import {
  buildArgumentTree,
  buildSunburstSegments,
  type ArgumentTreeNode,
  type StagingArgument,
} from "@/lib/stadtstack/discussion-tree";
import {
  stagingGet,
  stagingPost,
  type StagingConfigResponse,
  type StagingPersona,
  type StagingThreadResponse,
} from "@/lib/stadtstack/staging-api";
import { useCitizenSession } from "@/lib/citizen-session/CitizenSessionContext";

type WorkflowState = {
  discussion?: Record<string, unknown>;
  answer?: Record<string, unknown>;
  suggestion?: Record<string, unknown>;
  admission?: Record<string, unknown>;
  completion?: Record<string, unknown>;
  publicView?: Record<string, unknown>;
};

const MECKY_POLL_INTERVAL_MS = 3_000;
const MECKY_POLL_ATTEMPT_LIMIT = 20;

function polar(cx: number, cy: number, radius: number, angle: number) {
  return { x: cx + Math.cos(angle - Math.PI / 2) * radius, y: cy + Math.sin(angle - Math.PI / 2) * radius };
}

function arcPath(inner: number, outer: number, start: number, end: number): string {
  const cx = 130;
  const cy = 130;
  const outerStart = polar(cx, cy, outer, start);
  const outerEnd = polar(cx, cy, outer, end);
  const innerEnd = polar(cx, cy, inner, end);
  const innerStart = polar(cx, cy, inner, start);
  const large = end - start > Math.PI ? 1 : 0;
  return `M ${outerStart.x} ${outerStart.y} A ${outer} ${outer} 0 ${large} 1 ${outerEnd.x} ${outerEnd.y} L ${innerEnd.x} ${innerEnd.y} A ${inner} ${inner} 0 ${large} 0 ${innerStart.x} ${innerStart.y} Z`;
}

function ArgumentNode({ node, onReply }: { node: ArgumentTreeNode; onReply: (argument: StagingArgument) => void }) {
  const root = node.argument.stance === "root";
  return (
    <li className={root ? "" : "ml-4 border-l border-border pl-4 sm:ml-7"}>
      <article className={`rounded-xl border p-3 ${root ? "border-slate-300 bg-slate-50" : node.argument.stance === "pro" ? "border-emerald-300 bg-emerald-50" : "border-rose-300 bg-rose-50"}`}>
        <div className="flex flex-wrap items-center gap-2 text-xs">
          {!root && <span className={`rounded-full px-2 py-0.5 font-bold uppercase ${node.argument.stance === "pro" ? "bg-emerald-700 text-white" : "bg-rose-700 text-white"}`}>{node.argument.stance === "pro" ? "Pro" : "Contra"}</span>}
          <span className="font-semibold text-foreground">{node.argument.author.name}</span>
          <span className="text-muted-foreground">{node.argument.author.kind === "mecky" ? "KI-Assistent" : node.argument.author.synthetic ? "Synthetisches Profil" : "Signiertes Röbel-Konto"}</span>
        </div>
        <p className="mt-2 text-sm leading-6 text-foreground">{node.argument.content}</p>
        <button type="button" onClick={() => onReply(node.argument)} className="mt-2 text-xs font-semibold text-primary hover:underline">Auf dieses Argument antworten</button>
      </article>
      {node.children.length > 0 && <ol className="mt-3 space-y-3">{node.children.map((child) => <ArgumentNode key={child.argument.id} node={child} onReply={onReply} />)}</ol>}
    </li>
  );
}

function WorkflowStep({ label, done, detail }: { label: string; done: boolean; detail: string }) {
  return (
    <li className="flex gap-3">
      {done ? <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-600" /> : <div className="mt-1 h-4 w-4 shrink-0 rounded-full border-2 border-muted-foreground/40" />}
      <div><p className="text-sm font-semibold text-foreground">{label}</p><p className="text-xs leading-5 text-muted-foreground">{detail}</p></div>
    </li>
  );
}

export function StadtstackDiscussion({ rootId }: { rootId: string }) {
  const citizenSession = useCitizenSession();
  const [thread, setThread] = useState<StagingThreadResponse | null>(null);
  const [config, setConfig] = useState<StagingConfigResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<"tree" | "sunburst">("tree");
  const [persona, setPersona] = useState<StagingPersona | null>(null);
  const [replyTo, setReplyTo] = useState<StagingArgument | null>(null);
  const [stance, setStance] = useState<"pro" | "con">("pro");
  const [claim, setClaim] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [admittedPubkey, setAdmittedPubkey] = useState<string | null>(null);
  const [workflow, setWorkflow] = useState<WorkflowState>({});
  const [workflowBusy, setWorkflowBusy] = useState(false);
  const meckyPollAttempts = useRef(0);

  const reload = useCallback(async () => {
    try {
      setError(null);
      const [nextThread, nextConfig] = await Promise.all([
        stagingGet<StagingThreadResponse>(`/thread?root=${encodeURIComponent(rootId)}`),
        stagingGet<StagingConfigResponse>("/config"),
      ]);
      setThread(nextThread);
      setConfig(nextConfig);
      setPersona((current) => current ?? nextConfig.personas[0] ?? null);
      if (nextThread.mecky) setWorkflow((current) => ({ ...current, answer: nextThread.mecky!.event }));
      return nextThread;
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Diskussion nicht erreichbar");
      return null;
    } finally {
      setLoading(false);
    }
  }, [rootId]);

  useEffect(() => {
    meckyPollAttempts.current = 0;
    void reload();
  }, [reload]);

  useEffect(() => {
    if (loading || !thread || thread.mecky || meckyPollAttempts.current >= MECKY_POLL_ATTEMPT_LIMIT) return;
    let requestInFlight = false;
    const timer = window.setInterval(() => {
      if (requestInFlight || meckyPollAttempts.current >= MECKY_POLL_ATTEMPT_LIMIT) {
        if (meckyPollAttempts.current >= MECKY_POLL_ATTEMPT_LIMIT) window.clearInterval(timer);
        return;
      }
      requestInFlight = true;
      meckyPollAttempts.current += 1;
      void reload().then((nextThread) => {
        requestInFlight = false;
        if (nextThread?.mecky) window.clearInterval(timer);
      });
    }, MECKY_POLL_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [loading, reload, thread]);

  const graph = useMemo(() => {
    if (!thread?.arguments.length) return null;
    try { return buildArgumentTree(thread.arguments); } catch { return null; }
  }, [thread]);
  const segments = useMemo(() => graph ? buildSunburstSegments(graph.root) : [], [graph]);
  const rootEvent = graph?.root.argument;
  const proposalPersona = config?.personas.find((entry) => entry.publicKey === thread?.rootEvent?.pubkey) ?? null;
  const citizenArgumentMode = Boolean(
    citizenSession && thread?.topic && !thread.caseBinding,
  );

  const publishClaim = async () => {
    if ((!citizenArgumentMode && !persona) || !replyTo || !claim.trim()) return;
    setSubmitting(true);
    try {
      if (citizenArgumentMode && citizenSession && thread?.rootEvent && thread.topic) {
        let pubkey = admittedPubkey;
        if (!pubkey) {
          const proof = await citizenSession.createAdmissionProof();
          const admitted = await stagingPost<{
            status: "admitted";
            pubkey: string;
          }>("/session/admit", proof);
          if (admitted.pubkey !== proof.bindingEvent.pubkey) {
            throw new Error("citizen_argument_admission_invalid");
          }
          pubkey = admitted.pubkey;
          setAdmittedPubkey(pubkey);
        }
        const parentEvent = thread.events[replyTo.id];
        if (!parentEvent) throw new Error("citizen_argument_parent_missing");
        const signed = await citizenSession.signCivicArgument({
          rootEvent: thread.rootEvent,
          parentEvent,
          municipalityId: "roebel-mueritz",
          topicId: thread.topic.id,
          stance,
          content: claim.trim(),
          createdAt: Math.max(
            Math.floor(Date.now() / 1_000),
            thread.rootEvent.created_at + 1,
            parentEvent.created_at + 1,
          ),
        });
        if (signed.pubkey !== pubkey) {
          throw new Error("citizen_argument_signer_mismatch");
        }
        await stagingPost("/signed-event", { intent: "argument", event: signed });
      } else {
        await stagingPost("/claim", { personaId: persona!.id, rootEventId: rootId, parentEventId: replyTo.id, stance, content: claim.trim() });
      }
      setClaim("");
      setReplyTo(null);
      await reload();
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Argument konnte nicht veröffentlicht werden");
    } finally { setSubmitting(false); }
  };

  const startProposal = async () => {
    if (!proposalPersona || !thread?.mecky || !thread.rootEvent || !thread.caseBinding || !rootEvent) return;
    setWorkflowBusy(true);
    try {
      const suggestion = await stagingPost<{ suggestion: Record<string, unknown> }>("/suggestion", {
        personaId: proposalPersona.id,
        discussion: thread.rootEvent,
        answer: thread.mecky.event,
        title: "Sichere Querung an der Marienfelder Straße prüfen",
        summary: "Die in der öffentlichen Pro/Contra-Diskussion genannten Varianten sollen durch die zuständigen Fachbereiche geprüft und als verständlicher Citizen Brief zurückgespielt werden.",
      });
      const admission = await stagingPost<Record<string, unknown>>("/admit", { discussion: thread.rootEvent, answer: thread.mecky.event, suggestion: suggestion.suggestion });
      const completion = await stagingPost<Record<string, unknown>>("/complete", {});
      const publicView = await stagingPost<Record<string, unknown>>("/view", { profile: "public" });
      setWorkflow({ discussion: thread.rootEvent, answer: thread.mecky.event, suggestion: suggestion.suggestion, admission, completion, publicView });
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Vorschlagsfluss fehlgeschlagen");
    } finally { setWorkflowBusy(false); }
  };

  if (loading) return <div className="flex min-h-60 items-center justify-center"><Loader2 className="h-7 w-7 animate-spin text-primary" /></div>;
  if (!thread || !graph || !rootEvent) return <div className="rounded-xl border border-rose-300 bg-rose-50 p-5 text-rose-900">{error ?? "Diskussion nicht gefunden"}</div>;

  return (
    <div className="space-y-5">
      <Link href="/app" className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"><ArrowLeft className="h-4 w-4" /> Zurück zum Feed</Link>
      <header className="rounded-xl border border-emerald-700/25 bg-emerald-950 p-5 text-white">
        <div className="flex flex-wrap items-center gap-2 text-xs font-semibold uppercase tracking-wide text-emerald-200"><GitFork className="h-4 w-4" /> Signierte Nostr-Diskussion · Staging</div>
        <h1 className="mt-2 text-xl font-bold leading-8">{thread.topic?.title ?? rootEvent.content}</h1>
        {thread.topic && <p className="mt-2 text-sm leading-6 text-emerald-50">{rootEvent.content}</p>}
        <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-emerald-100">
          <span>Staging · signierter Beitrag von {rootEvent.author.name} · Ereignis {rootId.slice(0, 12)}…</span>
          {thread.sourceAppPostId && (
            <Link
              href={`/app/posts/${thread.sourceAppPostId}`}
              className="font-semibold text-white underline underline-offset-2"
            >
              Zum ursprünglichen Beitrag
            </Link>
          )}
        </div>
      </header>

      {error && <div role="alert" className="flex items-center gap-2 rounded-lg border border-rose-300 bg-rose-50 p-3 text-sm text-rose-900"><ShieldAlert className="h-4 w-4" /> {error}</div>}

      <section className="rounded-xl border border-border bg-card p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-base font-bold">Argumente abwägen</h2>
          <div className="flex rounded-lg bg-muted p-1" role="group" aria-label="Diskussionsansicht">
            <button type="button" onClick={() => setView("tree")} className={`inline-flex items-center gap-1 rounded-md px-3 py-1.5 text-xs font-semibold ${view === "tree" ? "bg-card shadow-sm" : "text-muted-foreground"}`}><GitFork className="h-4 w-4" /> Argumentbaum</button>
            <button type="button" onClick={() => setView("sunburst")} className={`inline-flex items-center gap-1 rounded-md px-3 py-1.5 text-xs font-semibold ${view === "sunburst" ? "bg-card shadow-sm" : "text-muted-foreground"}`}><PieChart className="h-4 w-4" /> Sunburst</button>
          </div>
        </div>
        {view === "tree" ? (
          <ol className="mt-4 space-y-3"><ArgumentNode node={graph.root} onReply={setReplyTo} /></ol>
        ) : (
          <div className="mt-4 grid gap-4 sm:grid-cols-[280px_1fr] sm:items-center">
            <svg viewBox="0 0 260 260" role="img" aria-label="Sunburst der Pro- und Contra-Argumente" className="mx-auto w-full max-w-[280px]">
              <circle cx="130" cy="130" r="28" fill="#0f766e" />
              <text x="130" y="134" textAnchor="middle" fill="white" fontSize="10" fontWeight="700">THEMA</text>
              {segments.map((segment) => <path key={segment.id} d={arcPath(segment.innerRadius, segment.outerRadius, segment.startAngle, segment.endAngle)} fill={segment.stance === "pro" ? "#10b981" : "#f43f5e"} stroke="white" strokeWidth="2"><title>{segment.stance === "pro" ? "Pro" : "Contra"}: {thread.arguments.find((entry) => entry.id === segment.id)?.content}</title></path>)}
            </svg>
            <div className="space-y-2 text-sm"><p><span className="mr-2 inline-block h-3 w-3 rounded-sm bg-emerald-500" />Pro-Argumente bauen den grünen Ast auf.</p><p><span className="mr-2 inline-block h-3 w-3 rounded-sm bg-rose-500" />Contra-Argumente bauen den roten Ast auf.</p><p className="text-xs text-muted-foreground">Die Fläche zeigt Struktur und Unterargumente, nicht Mehrheiten oder Stimmen.</p></div>
          </div>
        )}
      </section>

      {replyTo && (
        <section className="rounded-xl border border-primary/30 bg-card p-4">
          <h2 className="text-sm font-bold">Auf „{replyTo.content.slice(0, 90)}{replyTo.content.length > 90 ? "…" : ""}“ antworten</h2>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            {citizenArgumentMode && citizenSession ? (
              <div className="rounded-lg border border-emerald-300 bg-emerald-50 p-2 text-xs font-semibold text-emerald-950">Dein verbundenes Konto · {citizenSession.snapshot.credential.address.slice(0, 8)}…</div>
            ) : (
              <label className="text-xs font-semibold">Testprofil<select value={persona?.id ?? ""} onChange={(event) => setPersona(config?.personas.find((entry) => entry.id === event.target.value) ?? null)} className="mt-1 w-full rounded-lg border border-border bg-background p-2 text-sm">{config?.personas.map((entry) => <option key={entry.id} value={entry.id}>{entry.name}</option>)}</select></label>
            )}
            <label className="text-xs font-semibold">Einordnung<select value={stance} onChange={(event) => setStance(event.target.value as "pro" | "con")} className="mt-1 w-full rounded-lg border border-border bg-background p-2 text-sm"><option value="pro">Pro</option><option value="con">Contra</option></select></label>
          </div>
          <textarea value={claim} onChange={(event) => setClaim(event.target.value)} maxLength={1_000} rows={3} placeholder="Begründetes Argument…" className="mt-3 w-full rounded-lg border border-border bg-background p-3 text-sm" />
          <div className="mt-3 flex justify-end gap-2"><button type="button" onClick={() => setReplyTo(null)} className="rounded-full px-4 py-2 text-sm font-semibold text-muted-foreground">Abbrechen</button><button type="button" onClick={publishClaim} disabled={submitting || !claim.trim()} className="rounded-full bg-primary px-4 py-2 text-sm font-bold text-primary-foreground disabled:opacity-50">{submitting ? "Wird signiert…" : citizenArgumentMode ? "Mit meinem Konto signieren" : "Nostr-Argument signieren"}</button></div>
        </section>
      )}

      <section className="rounded-xl border border-amber-300 bg-amber-50 p-4">
        <div className="flex items-start gap-3"><Bot className="mt-0.5 h-6 w-6 shrink-0 text-amber-800" /><div><h2 className="font-bold text-amber-950">@Mecky · geprüfte Assistenz</h2>{thread.mecky ? <><p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-amber-950">{thread.mecky.event.content}</p><p className="mt-2 text-xs text-amber-800">{thread.mecky.evidenceRefs.length} checksum-gebundene Quellen · KI-Antwort, keine Verwaltungsfreigabe</p></> : <div className="mt-2 flex items-center gap-2 text-sm text-amber-900"><RefreshCw className="h-4 w-4" /> Mecky verarbeitet die Erwähnung. <button type="button" onClick={() => void reload()} className="font-bold underline">Neu laden</button></div>}</div></div>
      </section>

      <section className="rounded-xl border border-border bg-card p-5">
        <div className="flex items-start gap-3"><FileSignature className="mt-0.5 h-6 w-6 shrink-0 text-primary" /><div><h2 className="text-lg font-bold">Röbel-Verbesserungsvorschlag</h2><p className="mt-1 text-sm leading-6 text-muted-foreground">Aus Diskussion und Mecky-Antwort entsteht erst nach Bürger-Signatur und menschlicher Aufnahme ein Fall. Danach folgen Verwaltungsfeedback, Citizen Brief und ein beratendes Meinungsbild im Mitmachen-Bereich.</p></div></div>
        <ol className="mt-5 space-y-4">
          <WorkflowStep label="Öffentliche Diskussion" done={true} detail="Signierte Nostr-Ereignisse, Pro/Contra-Struktur und @Mecky-Erwähnung." />
          <WorkflowStep label="Geprüfte Mecky-Antwort" done={Boolean(workflow.answer || thread.mecky)} detail="Mecky darf Quellen erklären, aber den Vorschlag nicht selbst einreichen." />
          <WorkflowStep label="Bürger-signierter Vorschlag" done={Boolean(workflow.suggestion)} detail="Die synthetische Testperson bestätigt Titel und Zusammenfassung." />
          <WorkflowStep label="Verwaltungsfeedback und Citizen Brief" done={Boolean(workflow.completion)} detail="Acht getrennte Fachpakete werden geprüft und öffentlich verständlich zusammengeführt." />
          <WorkflowStep label="Beratendes Meinungsbild im Mitmachen-Bereich" done={Boolean(workflow.publicView)} detail="In Staging sichtbar und nachvollziehbar, aber nicht bindend." />
        </ol>
        {!thread.caseBinding && (
          <div className="mt-5 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950">
            <p className="font-semibold">Noch kein CivicCase</p>
            <p className="mt-1 text-xs leading-5">
              Ein bürger-signierter Vorschlag ist der nächste menschliche Schritt.
              Erst seine ausdrückliche Aufnahme darf einen neuen Fall anlegen.
            </p>
          </div>
        )}
        <button type="button" onClick={startProposal} disabled={workflowBusy || !thread.mecky || !thread.rootEvent || !thread.caseBinding || !proposalPersona || Boolean(workflow.publicView)} className="mt-5 inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-full bg-primary px-5 py-2.5 text-sm font-bold text-primary-foreground disabled:opacity-50">{workflowBusy ? <><Loader2 className="h-4 w-4 animate-spin" /> Ablauf wird ausgeführt…</> : workflow.publicView ? <><CheckCircle2 className="h-4 w-4" /> Staging-Ablauf abgeschlossen</> : !thread.caseBinding ? <><Landmark className="h-4 w-4" /> Vorschlag ist der nächste menschliche Schritt</> : <><Landmark className="h-4 w-4" /> Verbesserungsvorschlag starten</>}</button>
        <div className="mt-4 grid gap-3 sm:grid-cols-2"><div className="rounded-lg border border-border bg-muted/50 p-3"><div className="flex items-center gap-2 text-sm font-bold"><Vote className="h-4 w-4" /> Keine echte Abstimmung</div><p className="mt-1 text-xs leading-5 text-muted-foreground">Das Staging-Ergebnis ist ein beratendes Meinungsbild ohne formale Rats- oder Governance-Wirkung.</p></div><div className="rounded-lg border border-border bg-muted/50 p-3"><div className="flex items-center gap-2 text-sm font-bold"><CircleDollarSign className="h-4 w-4" /> Stadtkasse getrennt</div><p className="mt-1 text-xs leading-5 text-muted-foreground">Budgetbedarf kann als Verwaltungsprüfung erscheinen; keine Auszahlung und keine Treasury-Transaktion wird ausgelöst.</p></div></div>
      </section>
    </div>
  );
}
