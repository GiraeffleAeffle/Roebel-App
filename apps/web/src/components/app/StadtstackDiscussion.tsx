"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  Bot,
  CheckCircle2,
  FileSignature,
  GitFork,
  Landmark,
  Loader2,
  PieChart,
  RefreshCw,
  ShieldAlert,
} from "lucide-react";
import {
  buildArgumentTree,
  buildSunburstSegments,
  summarizeArgumentTree,
  type ArgumentTreeNode,
  type StagingArgument,
} from "@/lib/stadtstack/discussion-tree";
import {
  stagingPost,
  loadStadtstackAdministrationProgress,
  type StagingConfigResponse,
  type StagingPersona,
  type StagingThreadResponse,
} from "@/lib/stadtstack/staging-api";
import {
  loadPublicCivicDiscussion,
  loadPublicCivicInstance,
} from "@/lib/stadtstack/civic-projection-client";
import type { StadtstackAdministrationProgress as AdministrationProgress } from "@/lib/stadtstack/administration-progress";
import { projectCivicJourney } from "@/lib/stadtstack/civic-journey";
import {
  loadVerifiedPublicCaseBindingReceipt,
  type VerifiedPublicCaseBindingReceipt,
} from "@/lib/stadtstack/public-case-binding-receipt-client";
import { bindPublicCaseReceiptToProposal } from "@/lib/stadtstack/proposal-signature";
import { useCitizenSession } from "@/lib/citizen-session/CitizenSessionContext";
import { resolveStadtstackStagingLab } from "@/lib/stadtstack/staging-lab";
import {
  hasPendingStagingParticipantTopicSuggestion,
  resumeStagingParticipantTopicSuggestion,
  signStagingParticipantTopicSuggestion,
} from "@/lib/staging-participant/topic-tracer";
import type { PublicCitizenAdoptionProjection } from "@/lib/staging-participant/citizen-adoption";
import { StadtstackAdministrationProgress } from "./StadtstackAdministrationProgress";
import { CivicJourneyRail } from "./CivicJourneyRail";
import { StadtstackProposalReceipts } from "./StadtstackProposalReceipts";
import { StadtstackCitizenAdoption } from "./StadtstackCitizenAdoption";

type WorkflowState = {
  answer?: Record<string, unknown>;
  suggestion?: Record<string, unknown>;
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
  const [proposalTitle, setProposalTitle] = useState("");
  const [proposalSummary, setProposalSummary] = useState("");
  const [administrationProgress, setAdministrationProgress] =
    useState<AdministrationProgress | null>(null);
  const [administrationProgressLoading, setAdministrationProgressLoading] =
    useState(false);
  const [administrationProgressError, setAdministrationProgressError] =
    useState<string | null>(null);
  const [bindingReceipt, setBindingReceipt] =
    useState<VerifiedPublicCaseBindingReceipt | null>(null);
  const [bindingReceiptUnavailable, setBindingReceiptUnavailable] =
    useState(false);
  const [citizenAdoptionProjection, setCitizenAdoptionProjection] =
    useState<PublicCitizenAdoptionProjection | null>(null);
  const meckyPollAttempts = useRef(0);
  const administrationRequestId = useRef(0);
  const topicSuggestionResumeRoot = useRef<string | null>(null);
  const [topicSuggestionReceiptPending, setTopicSuggestionReceiptPending] =
    useState(false);
  const topicBindingReceipt = thread?.topic
    ? bindPublicCaseReceiptToProposal({
        suggestion: thread.suggestion,
        receipt: bindingReceipt,
        rootEventId: rootId,
        topicId: thread.topic.id,
      })
    : null;
  const bindingReceiptMismatch = Boolean(
    bindingReceipt && thread?.topic && !topicBindingReceipt
  );
  const citizenAdoptionVerified = Boolean(citizenAdoptionProjection);
  const canonicalCaseId = topicBindingReceipt?.caseId ?? null;
  const updateCitizenAdoptionProjection = useCallback(
    (projection: PublicCitizenAdoptionProjection | null) => {
      setCitizenAdoptionProjection(projection);
    },
    []
  );

  const reload = useCallback(async () => {
    try {
      setError(null);
      const [nextThread, nextConfig] = await Promise.all([
        loadPublicCivicDiscussion(rootId),
        loadPublicCivicInstance(),
      ]);
      setThread(nextThread);
      setConfig(nextConfig);
      setPersona((current) => current ?? nextConfig.personas[0] ?? null);
      if (nextThread.mecky || nextThread.suggestion) {
        setWorkflow((current) => ({
          ...current,
          ...(nextThread.mecky ? { answer: nextThread.mecky.event } : {}),
          ...(nextThread.suggestion
            ? { suggestion: nextThread.suggestion }
            : {}),
        }));
      }
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
    let active = true;
    setBindingReceipt(null);
    setBindingReceiptUnavailable(false);
    setCitizenAdoptionProjection(null);
    void loadVerifiedPublicCaseBindingReceipt(rootId)
      .then((receipt) => {
        if (active) setBindingReceipt(receipt);
      })
      .catch(() => {
        if (active) setBindingReceiptUnavailable(true);
      });
    return () => {
      active = false;
    };
  }, [rootId]);

  const refreshAdministrationProgress = useCallback(async () => {
    if (!canonicalCaseId) return;
    const requestId = ++administrationRequestId.current;
    setAdministrationProgressLoading(true);
    setAdministrationProgressError(null);
    try {
      const progress = await loadStadtstackAdministrationProgress(
        canonicalCaseId
      );
      if (administrationRequestId.current !== requestId) return;
      setAdministrationProgress(progress);
    } catch {
      if (administrationRequestId.current !== requestId) return;
      setAdministrationProgressError(
        "Der öffentlich geprüfte Verwaltungsstand ist gerade nicht erreichbar."
      );
    } finally {
      if (administrationRequestId.current === requestId) {
        setAdministrationProgressLoading(false);
      }
    }
  }, [canonicalCaseId]);

  useEffect(() => {
    setAdministrationProgress(null);
    setAdministrationProgressError(null);
    if (!canonicalCaseId) {
      administrationRequestId.current += 1;
      setAdministrationProgressLoading(false);
      return;
    }
    void refreshAdministrationProgress();
  }, [canonicalCaseId, refreshAdministrationProgress]);

  useEffect(() => {
    if (!thread?.topic || topicBindingReceipt || thread.suggestion) return;
    setProposalTitle((current) =>
      current || `${thread.topic!.title} prüfen`
    );
    setProposalSummary(
      (current) =>
        current ||
        "Die in der öffentlichen Diskussion genannten Optionen sollen durch die zuständigen Menschen geprüft und nachvollziehbar zurückgespielt werden."
    );
  }, [thread, topicBindingReceipt]);

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
  const argumentSummary = useMemo(
    () => graph ? summarizeArgumentTree(graph.root) : null,
    [graph],
  );
  const rootEvent = graph?.root.argument;
  const syntheticLegacyMode = Boolean(rootEvent?.author.synthetic);
  const participantTracerMode = Boolean(
    resolveStadtstackStagingLab(process.env.NEXT_PUBLIC_STADTSTACK_STAGING_LAB) &&
      !syntheticLegacyMode,
  );
  const citizenArgumentMode = Boolean(
    citizenSession && thread?.topic && !topicBindingReceipt,
  );

  useEffect(() => {
    if (
      !participantTracerMode ||
      !thread?.rootEvent ||
      topicSuggestionResumeRoot.current === rootId
    ) {
      return;
    }
    let pending = false;
    try {
      pending = hasPendingStagingParticipantTopicSuggestion(rootId);
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Der offene Vorschlagsschritt ist nicht lesbar.",
      );
      return;
    }
    if (!pending) return;
    topicSuggestionResumeRoot.current = rootId;
    setTopicSuggestionReceiptPending(true);
    setWorkflowBusy(true);
    void resumeStagingParticipantTopicSuggestion(rootId)
      .then(async (receipt) => {
        if (!receipt) {
          setTopicSuggestionReceiptPending(false);
          return;
        }
        setWorkflow((current) => ({ ...current, suggestion: receipt }));
        setTopicSuggestionReceiptPending(false);
        await reload();
      })
      .catch((cause) => {
        setError(
          cause instanceof Error
            ? cause.message
            : "Die Vorschlagsquittung konnte noch nicht abgeschlossen werden.",
        );
      })
      .finally(() => setWorkflowBusy(false));
  }, [participantTracerMode, reload, rootId, thread?.rootEvent]);

  const ensureCitizenRelayAdmitted = async (): Promise<string> => {
    if (!citizenSession) throw new Error("citizen_session_required");
    if (admittedPubkey) return admittedPubkey;
    const proof = await citizenSession.createAdmissionProof();
    const admitted = await stagingPost<{
      status: "admitted";
      pubkey: string;
    }>("/session/admit", proof);
    if (admitted.pubkey !== proof.bindingEvent.pubkey) {
      throw new Error("citizen_relay_admission_invalid");
    }
    setAdmittedPubkey(admitted.pubkey);
    return admitted.pubkey;
  };

  const publishClaim = async () => {
    if ((!citizenArgumentMode && !persona) || !replyTo || !claim.trim()) return;
    setSubmitting(true);
    try {
      if (citizenArgumentMode && citizenSession && thread?.rootEvent && thread.topic) {
        const pubkey = await ensureCitizenRelayAdmitted();
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
    if (!thread?.mecky || !thread.rootEvent || !rootEvent) return;
    setWorkflowBusy(true);
    try {
      if (!thread.topic || topicBindingReceipt) {
        throw new Error("case_steward_admission_is_separate");
      }
      if (
        !citizenSession ||
        !config ||
        !proposalTitle.trim() ||
        !proposalSummary.trim()
      ) {
        throw new Error("citizen_topic_suggestion_not_ready");
      }
      let published: Record<string, unknown>;
      if (participantTracerMode) {
        if (!thread.sourceAppPostId) {
          throw new Error("staging_participant_source_post_required");
        }
        const witnesses = thread.sourceConversationWitnesses;
        if (
          !thread.sourceConversation ||
          !witnesses ||
          witnesses.mentionEvent.id !== thread.sourceConversation.mentionId ||
          witnesses.replyEvent.id !== thread.sourceConversation.replyId
        ) {
          throw new Error("staging_participant_conversation_witness_required");
        }
        const signed = await citizenSession.signParticipantTopicSuggestion({
          binding: {
            municipalityId: "roebel-mueritz",
            topicId: thread.topic.id,
          },
          sourcePost: witnesses.mentionEvent,
          sourceDiscussion: thread.rootEvent,
          sourceAnswer: thread.mecky.event,
          conversationWitnesses: {
            conversationTopic: witnesses.conversationTopic,
            mentionEvent: witnesses.mentionEvent,
            replyEvent: witnesses.replyEvent,
          },
          agentPubkey: config.meckyPubkey,
          title: proposalTitle.trim(),
          summary: proposalSummary.trim(),
          createdAt: Math.max(
            Math.floor(Date.now() / 1_000),
            thread.rootEvent.created_at + 1,
            thread.mecky.event.created_at + 1,
          ),
        });
        if (signed.signerPubkey !== thread.rootEvent.pubkey) {
          throw new Error("staging_participant_suggestion_signer_mismatch");
        }
        published = {
          ...(await signStagingParticipantTopicSuggestion({
            discussionRootEvent: thread.rootEvent,
            meckyAnswerEvent: thread.mecky.event,
            suggestionEvent: signed.event,
          })),
        };
      } else if (syntheticLegacyMode) {
        const pubkey = await ensureCitizenRelayAdmitted();
        const signed = await citizenSession.signTopicSuggestion({
          binding: {
            municipalityId: "roebel-mueritz",
            topicId: thread.topic.id,
          },
          sourceDiscussion: thread.rootEvent,
          sourceAnswer: thread.mecky.event,
          agentPubkey: config.meckyPubkey,
          title: proposalTitle.trim(),
          summary: proposalSummary.trim(),
          createdAt: Math.max(
            Math.floor(Date.now() / 1_000),
            thread.rootEvent.created_at + 1,
            thread.mecky.event.created_at + 1,
          ),
        });
        if (signed.signerPubkey !== pubkey) {
          throw new Error("citizen_topic_suggestion_signer_mismatch");
        }
        published = await stagingPost<{
          status: "signed";
          suggestion: Record<string, unknown>;
        }>("/signed-event", {
          intent: "suggestion",
          event: signed.event,
        });
      } else {
        throw new Error("staging_participant_gateway_required");
      }
      setWorkflow((current) => ({
        ...current,
        answer: thread.mecky!.event,
        suggestion: published,
      }));
      setTopicSuggestionReceiptPending(false);
      await reload();
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Vorschlagsfluss fehlgeschlagen");
    } finally { setWorkflowBusy(false); }
  };

  const topicProposalMode = Boolean(thread?.topic && !topicBindingReceipt);
  const topicSuggestionSigned = Boolean(
    topicProposalMode &&
      !topicSuggestionReceiptPending &&
      (thread?.suggestion || workflow.suggestion)
  );
  const visibleProposalRequest = topicSuggestionSigned
    ? {
        title: thread?.suggestion?.draft.title ?? proposalTitle.trim(),
        summary: thread?.suggestion?.draft.summary ?? proposalSummary.trim(),
      }
    : null;
  const proposalDisabled = Boolean(
    workflowBusy ||
      !topicProposalMode ||
      !thread?.mecky ||
      !thread.rootEvent ||
      !citizenSession ||
      !proposalTitle.trim() ||
      !proposalSummary.trim() ||
      topicSuggestionSigned
  );
  const journey = useMemo(() => {
    if (!thread?.topic) return null;
    const admitted = Boolean(topicBindingReceipt);
    const administrationStatus =
      administrationProgress?.status === "citizen_brief_current"
        ? "brief_current"
        : administrationProgress
          ? "in_review"
          : "not_available";
    return projectCivicJourney({
      sourcePostCount: thread.sourceAppPostId ? 1 : 0,
      discussionCount: 1,
      meckyMentioned: Boolean(
        thread.rootEvent?.tags.some(
          (tag) => tag[0] === "p" && tag[1] === config?.meckyPubkey
        )
      ),
      meckyAnswered: Boolean(thread.mecky || workflow.answer),
      proposalSigned: Boolean(thread.suggestion || workflow.suggestion),
      citizenAdoptionVerified,
      caseAdmitted: admitted,
      administrationStatus,
      participationStatus:
        administrationStatus === "brief_current"
          ? "brief_ready"
          : "not_available",
    });
  }, [administrationProgress, citizenAdoptionVerified, config?.meckyPubkey, thread, topicBindingReceipt, workflow]);

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

      {journey && <CivicJourneyRail journey={journey} />}

      {thread.sourceConversation && (
        <section className="rounded-xl border border-blue-200 bg-blue-50 p-4 text-blue-950">
          <div className="flex items-start gap-3">
            <Bot className="mt-0.5 h-5 w-5 shrink-0" />
            <div className="min-w-0">
              <h2 className="text-sm font-bold">
                Aus einem ausdrücklich ausgewählten @Mecky-Austausch
              </h2>
              <p className="mt-1 text-xs leading-5 text-blue-900">
                Die Autorin oder der Autor hat genau diese beantwortete
                Erwähnung als Kontext übernommen. Sie bleibt Quellenkontext und
                ist weder die Antwort dieser neuen Diskussion noch ein
                Vorschlag oder CivicCase.
              </p>
              <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs">
                <Link
                  href={`/app/posts/${thread.sourceConversation.sourceAppPostId}`}
                  className="font-semibold underline underline-offset-2"
                >
                  Originalen Verlauf öffnen
                </Link>
                <span>
                  Erwähnung {thread.sourceConversation.mentionId.slice(0, 10)}…
                </span>
                <span>
                  von {thread.sourceConversation.mentionAuthor.name}
                </span>
                <span>
                  Antwort {thread.sourceConversation.replyId.slice(0, 10)}…
                </span>
                {thread.sourceConversation.sourceAppCommentId && (
                  <span>aus einem Kommentar</span>
                )}
              </div>
              <div className="mt-2 flex flex-wrap gap-2">
                {thread.sourceConversation.evidenceRefs.map((evidence, index) => (
                  <a
                    key={evidence.digest}
                    href={evidence.url}
                    target="_blank"
                    rel="noreferrer"
                    className="rounded-full border border-blue-300 bg-white px-2.5 py-1 text-xs font-semibold text-blue-900"
                  >
                    Quelle {index + 1}
                  </a>
                ))}
              </div>
            </div>
          </div>
        </section>
      )}

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
        <div className="flex items-start gap-3"><FileSignature className="mt-0.5 h-6 w-6 shrink-0 text-primary" /><div><h2 className="text-lg font-bold">Röbel-Verbesserungsvorschlag</h2><p className="mt-1 text-sm leading-6 text-muted-foreground">Hier wird aus der Diskussion ein unveränderlicher Entwurf. Der Bürgerprozess oben zeigt den aktuellen Stand und alle späteren, getrennten Zuständigkeiten.</p></div></div>
        {argumentSummary && (
          <div className="mt-5 rounded-lg border border-blue-200 bg-blue-50 p-3 text-blue-950">
            <p className="text-xs font-bold uppercase tracking-wide">Diskussionsgrundlage für die Anfrage</p>
            <p className="mt-1 text-sm font-semibold">
              {argumentSummary.argumentCount} {argumentSummary.argumentCount === 1 ? "verbundenes Argument" : "verbundene Argumente"} · {argumentSummary.proArgumentCount} Pro · {argumentSummary.conArgumentCount} Contra
            </p>
            <p className="mt-1 text-xs leading-5 text-blue-900">
              Argumentbaum, Sunburst und Vorschlagsanfrage verwenden dieselbe signierte Diskussion. Das sind Argumentzweige, keine Stimmen, Mehrheiten oder Abstimmungsergebnisse.
            </p>
          </div>
        )}
        {topicBindingReceipt && (
          <StadtstackAdministrationProgress
            progress={administrationProgress}
            loading={administrationProgressLoading}
            error={administrationProgressError}
            onRefresh={() => void refreshAdministrationProgress()}
            participationHref={administrationProgress?.status === "citizen_brief_current" && thread.topic ? `/app/proposals?case=${encodeURIComponent(topicBindingReceipt.caseId)}&topic=${encodeURIComponent(thread.topic.id)}` : null}
          />
        )}
        {thread.caseBinding && !topicBindingReceipt && (
          <div className="mt-5 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950">
            <p className="font-semibold">Synthetische Legacy-Case-Markierung</p>
            <p className="mt-1 text-xs leading-5">Ein Nostr-Tag bleibt als Staging-Historie sichtbar. Er ist keine öffentliche Case-Steward-Quittung, öffnet keinen Verwaltungsstand und setzt keinen CivicCase fort.</p>
          </div>
        )}
        {bindingReceiptUnavailable && (
          <div className="mt-5 rounded-lg border border-amber-300 bg-amber-50 p-3 text-xs text-amber-950">Die öffentliche Case-Steward-Quittung ist gerade nicht erreichbar; der Journey-Stand bleibt unverändert.</div>
        )}
        {bindingReceiptMismatch && (
          <div className="mt-5 rounded-lg border border-amber-300 bg-amber-50 p-3 text-xs text-amber-950">Die öffentliche Fallquittung passt nicht exakt zur projizierten Vorschlagssignatur. Insbesondere kann eine v1-Quittung keinen Teilnahme-Entwurf als Bürgerübernahme relabeln; CivicCase und Verwaltung bleiben gesperrt.</div>
        )}
        {thread.topic && (thread.suggestion || topicBindingReceipt) && (
          <StadtstackProposalReceipts suggestion={thread.suggestion} bindingReceipt={topicBindingReceipt} adoptionProjection={citizenAdoptionProjection} rootId={rootId} topicId={thread.topic.id} />
        )}
        {!topicBindingReceipt && (
          <>
            <div className={`mt-5 rounded-lg border p-3 text-sm ${topicSuggestionSigned ? "border-emerald-300 bg-emerald-50 text-emerald-950" : "border-amber-300 bg-amber-50 text-amber-950"}`}>
              <p className="text-[11px] font-bold uppercase tracking-wide opacity-75">Aktueller Vorschlagsstand</p>
              <p className="font-semibold">{topicSuggestionSigned ? participantTracerMode ? "Teilnahme-Entwurf signiert" : "Vorschlag bürger-signiert" : "Noch kein CivicCase"}</p>
              <p className="mt-1 text-xs leading-5">
                {topicSuggestionSigned
                  ? participantTracerMode
                    ? citizenAdoptionVerified
                      ? "Die Bürgerübernahme wurde geprüft und wartet auf die getrennte Aufnahmeprüfung durch einen Case Steward. Es wurde noch kein CivicCase angelegt."
                      : "Der Entwurf verlangt zuerst eine getrennte, verifizierte Bürgerübernahme. Er wurde nicht als Bürger-Vorschlag oder CivicCase relabelt und kann keinen Case Steward erreichen."
                    : "Der Vorschlag wartet auf die getrennte, rollenbasierte Prüfung durch einen Case Steward. Es wurde kein CivicCase automatisch angelegt. Diese öffentliche App kann die Aufnahme nicht auslösen; sie zeigt anschließend nur die öffentliche Aufnahme-Quittung."
                  : participantTracerMode
                    ? "Als Nächstes kann die Staging-Teilnahme den unveränderten Entwurf signieren. Das ist noch keine Bürgerübernahme und legt keinen CivicCase an."
                    : "Ein bürger-signierter Vorschlag ist der nächste menschliche Schritt. Erst seine ausdrückliche Aufnahme darf einen neuen Fall anlegen."}
              </p>
            </div>
            {visibleProposalRequest && (
              <article className="mt-4 rounded-xl border border-emerald-300 bg-white p-4" aria-label="Angefragter Röbel-Verbesserungsvorschlag">
                <p className="text-xs font-bold uppercase tracking-wide text-emerald-800">Zur Prüfung angefragt</p>
                <h3 className="mt-2 text-base font-bold text-foreground">{visibleProposalRequest.title}</h3>
                <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-muted-foreground">{visibleProposalRequest.summary}</p>
                <p className="mt-3 text-xs leading-5 text-emerald-950">
                  Quelle: signierte Diskussion {rootId.slice(0, 12)}… · Keine Verwaltungsfreigabe, kein bindender kommunaler Beschluss, kein CivicCase, keine Abstimmung und keine Auszahlung.
                </p>
              </article>
            )}
            {participantTracerMode &&
              thread.suggestion?.schemaVersion ===
                "staging_participant_signed_topic_suggestion_v1" && (
                <StadtstackCitizenAdoption
                  suggestion={thread.suggestion}
                  session={citizenSession}
                  onProjectionChange={updateCitizenAdoptionProjection}
                />
              )}
            {!topicSuggestionSigned && (
              <div className="mt-4 grid gap-3">
                <label className="text-xs font-semibold">
                  Titel des Vorschlags
                  <input
                    value={proposalTitle}
                    onChange={(event) => setProposalTitle(event.target.value)}
                    maxLength={240}
                    className="mt-1 w-full rounded-lg border border-border bg-background p-3 text-sm font-normal"
                  />
                </label>
                <label className="text-xs font-semibold">
                  Zusammenfassung
                  <textarea
                    value={proposalSummary}
                    onChange={(event) => setProposalSummary(event.target.value)}
                    maxLength={2_000}
                    rows={4}
                    className="mt-1 w-full rounded-lg border border-border bg-background p-3 text-sm font-normal"
                  />
                </label>
              </div>
            )}
          </>
        )}
        {(!topicSuggestionSigned || topicBindingReceipt) && (
          <button type="button" onClick={startProposal} disabled={proposalDisabled} className="mt-5 inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-full bg-primary px-5 py-2.5 text-sm font-bold text-primary-foreground disabled:opacity-50">{workflowBusy ? <><Loader2 className="h-4 w-4 animate-spin" /> {topicSuggestionReceiptPending ? "Quittung wird abgeschlossen…" : participantTracerMode ? "Entwurf wird signiert…" : "Vorschlag wird signiert…"}</> : topicBindingReceipt ? <><CheckCircle2 className="h-4 w-4" /> CivicCase quittiert</> : topicSuggestionReceiptPending ? <><RefreshCw className="h-4 w-4" /> Quittung erneut abschließen</> : topicProposalMode && !citizenSession ? <><Landmark className="h-4 w-4" /> Anmelden, um {participantTracerMode ? "Entwurf" : "Vorschlag"} zu signieren</> : <><FileSignature className="h-4 w-4" /> {participantTracerMode ? "Entwurf" : "Vorschlag"} prüfen und signieren</>}</button>
        )}
        <aside aria-label="Wirkungsgrenzen" className="mt-4 rounded-lg border border-border bg-muted/40 p-3">
          <p className="text-sm font-bold">Beratend, nicht bindend</p>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">Keine echte Abstimmung, keine Verwaltungsfreigabe und kein kommunaler Beschluss. Die Stadtkasse bleibt getrennt: keine Auszahlung und keine Treasury-Transaktion.</p>
        </aside>
      </section>
    </div>
  );
}
