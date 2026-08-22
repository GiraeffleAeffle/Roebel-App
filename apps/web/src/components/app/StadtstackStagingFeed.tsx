"use client";

import Link from "next/link";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import {
  ChevronRight,
  FileText,
  GitFork,
  Loader2,
  ShieldCheck,
} from "lucide-react";
import {
  stagingGet,
  stagingPost,
  type StagingConfigResponse,
  type StagingFeedPost,
  type StagingFeedResponse,
  type StagingOrdinaryPost,
} from "@/lib/stadtstack/staging-api";
import { useCitizenSession } from "@/lib/citizen-session/CitizenSessionContext";
import { CivicTopicActivityCard } from "@/components/app/CivicTopicActivityCard";

const MARIENFELDER_TOPIC_ID =
  "urn:stadtstack:topic:municipality:roebel-mueritz:marienfelder-strasse";
const MARIENFELDER_CASE_ID =
  "urn:stadtstack:case:municipality:roebel-mueritz:018f0000-0000-7000-8000-000000000001";

function shortTime(value: string): string {
  return new Date(value).toLocaleString("de-DE", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function OrdinaryPostCard({
  busy,
  onCancelPromotion,
  onOpenPromotion,
  onPromote,
  post,
  promotionOpen,
  promotionQuestion,
  setPromotionQuestion,
}: {
  busy: boolean;
  onCancelPromotion: () => void;
  onOpenPromotion: () => void;
  onPromote: (event: FormEvent<HTMLFormElement>) => void;
  post: StagingOrdinaryPost;
  promotionOpen: boolean;
  promotionQuestion: string;
  setPromotionQuestion: (value: string) => void;
}) {
  return (
    <article className="rounded-xl border border-border bg-card p-4 shadow-sm">
      <div className="flex items-start gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-muted text-sm font-bold text-foreground">
          {post.author.name.slice(0, 2).toUpperCase()}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <span className="font-semibold text-foreground">
              {post.author.name}
            </span>
            <span>
              {post.synthetic
                ? "Synthetisches Profil"
                : "Verknüpftes Staging-Konto"}
            </span>
            <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 font-semibold">
              <FileText className="h-3 w-3" /> Normaler Beitrag
            </span>
            <span>·</span>
            <span>{shortTime(post.createdAt)}</span>
          </div>
          <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-foreground">
            {post.content}
          </p>

          {post.promotedDiscussionId ? (
            <div className="mt-3 flex flex-wrap items-center gap-3 border-t border-border pt-3 text-xs">
              <span className="text-muted-foreground">
                Der ursprüngliche Beitrag bleibt unverändert und ist als Quelle
                verknüpft.
              </span>
              <Link
                href={`/app/diskussion/${post.promotedDiscussionId}`}
                className="ml-auto inline-flex items-center gap-1 font-semibold text-primary hover:underline"
              >
                Thema öffnen <ChevronRight className="h-4 w-4" />
              </Link>
            </div>
          ) : promotionOpen ? (
            <form
              onSubmit={onPromote}
              className="mt-3 space-y-3 rounded-lg border border-primary/25 bg-primary/5 p-3"
            >
              <div>
                <label
                  htmlFor={`promotion-${post.id}`}
                  className="text-xs font-semibold text-foreground"
                >
                  Was soll gemeinsam geklärt werden?
                </label>
                <textarea
                  id={`promotion-${post.id}`}
                  value={promotionQuestion}
                  onChange={(event) => setPromotionQuestion(event.target.value)}
                  rows={3}
                  maxLength={1_000}
                  required
                  className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground"
                />
              </div>
              <p className="text-xs text-muted-foreground">
                Der ursprüngliche Beitrag bleibt unverändert. Die neue
                Diskussion zitiert ihn als Quelle und wird erst durch diesen
                Klick erstellt.
              </p>
              <div className="flex flex-wrap justify-end gap-2">
                <button
                  type="button"
                  onClick={onCancelPromotion}
                  disabled={busy}
                  className="rounded-full border border-border px-3 py-1.5 text-xs font-semibold text-foreground disabled:opacity-50"
                >
                  Abbrechen
                </button>
                <button
                  type="submit"
                  disabled={busy || !promotionQuestion.trim()}
                  className="inline-flex items-center gap-1 rounded-full bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground disabled:opacity-50"
                >
                  {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}{" "}
                  Thema anlegen
                </button>
              </div>
            </form>
          ) : (
            <div className="mt-3 flex justify-end border-t border-border pt-3">
              <button
                type="button"
                onClick={onOpenPromotion}
                className="inline-flex items-center gap-1 rounded-full border border-primary/30 px-3 py-1.5 text-xs font-semibold text-primary hover:bg-primary/5"
              >
                <GitFork className="h-4 w-4" /> Als Thema weiterführen
              </button>
            </div>
          )}
        </div>
      </div>
    </article>
  );
}

export function StadtstackStagingFeed() {
  const citizenSession = useCitizenSession();
  const [config, setConfig] = useState<StagingConfigResponse | null>(null);
  const [posts, setPosts] = useState<StagingFeedPost[]>([]);
  const [status, setStatus] = useState<"loading" | "ready" | "unavailable">(
    "loading"
  );
  const [draftContent, setDraftContent] = useState("");
  const [draftPersonaId, setDraftPersonaId] = useState("");
  const [admittedPubkey, setAdmittedPubkey] = useState<string | null>(null);
  const [promotionPostId, setPromotionPostId] = useState<string | null>(null);
  const [promotionQuestion, setPromotionQuestion] = useState("");
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    const [feed, nextConfig] = await Promise.all([
      stagingGet<StagingFeedResponse>("/feed"),
      stagingGet<StagingConfigResponse>("/config"),
    ]);
    setPosts(feed.posts);
    setConfig(nextConfig);
    setDraftPersonaId((current) => current || nextConfig.personas[0]?.id || "");
    setStatus("ready");
  }, []);

  useEffect(() => {
    let active = true;
    reload().catch(() => {
      if (active) setStatus("unavailable");
    });
    return () => {
      active = false;
    };
  }, [reload]);

  useEffect(() => {
    setAdmittedPubkey(null);
  }, [citizenSession?.snapshot.credential.address]);

  const ensureCitizenAdmission = useCallback(async (): Promise<string> => {
    if (!citizenSession)
      throw new Error("Bitte zuerst mit deinem Röbel-Konto anmelden.");
    if (admittedPubkey) return admittedPubkey;
    const proof = await citizenSession.createAdmissionProof();
    const admitted = await stagingPost<{
      status: "admitted";
      pubkey: string;
    }>("/session/admit", proof);
    setAdmittedPubkey(admitted.pubkey);
    return admitted.pubkey;
  }, [admittedPubkey, citizenSession]);

  const publishPost = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (
      (!citizenSession && !draftPersonaId) ||
      !draftContent.trim() ||
      busy ||
      !config
    )
      return;
    setBusy(true);
    setActionError(null);
    try {
      if (citizenSession) {
        await ensureCitizenAdmission();
        const signed = await citizenSession.signPublicPost({
          content: draftContent.trim(),
          mentionPubkeys: /@mecky\b/i.test(draftContent)
            ? [config.meckyPubkey]
            : [],
        });
        await stagingPost<{ status: string }>("/signed-event", {
          intent: "post",
          event: signed,
        });
      } else {
        await stagingPost<{ status: string }>("/post", {
          personaId: draftPersonaId,
          content: draftContent.trim(),
        });
      }
      setDraftContent("");
      await reload();
    } catch (error) {
      setActionError(
        error instanceof Error
          ? error.message
          : "Beitrag konnte nicht veröffentlicht werden."
      );
    } finally {
      setBusy(false);
    }
  };

  const promotePost = async (
    event: FormEvent<HTMLFormElement>,
    post: StagingOrdinaryPost
  ) => {
    event.preventDefault();
    if (!promotionQuestion.trim() || busy || !config) return;
    setBusy(true);
    setActionError(null);
    try {
      if (post.synthetic) {
        const actor = config.personas.find(
          (persona) => persona.publicKey === post.author.pubkey
        );
        if (!actor)
          throw new Error(
            "Das Testprofil des Quellbeitrags ist nicht verfügbar."
          );
        await stagingPost<{ status: string }>("/promote", {
          personaId: actor.id,
          sourcePostId: post.id,
          topicId: MARIENFELDER_TOPIC_ID,
          question: promotionQuestion.trim(),
        });
      } else {
        if (!citizenSession)
          throw new Error("Bitte zuerst mit deinem Röbel-Konto anmelden.");
        const pubkey = await ensureCitizenAdmission();
        if (pubkey !== post.author.pubkey) {
          throw new Error(
            "Nur die Autorin oder der Autor kann diesen Beitrag weiterführen."
          );
        }
        const signed = await citizenSession.promotePublicPost({
          sourcePost: post.event,
          municipalityId: "roebel-mueritz",
          sourceCaseId: "marienfelder-strasse",
          canonicalCaseId: MARIENFELDER_CASE_ID,
          topicId: MARIENFELDER_TOPIC_ID,
          agentPubkey: config.meckyPubkey,
          content: `@Mecky, ${promotionQuestion.trim()}`,
          createdAt: Math.max(
            Math.floor(Date.now() / 1_000),
            post.event.created_at + 1
          ),
        });
        await stagingPost<{ status: string }>("/signed-event", {
          intent: "promotion",
          event: signed,
        });
      }
      setPromotionPostId(null);
      setPromotionQuestion("");
      await reload();
    } catch (error) {
      setActionError(
        error instanceof Error
          ? error.message
          : "Thema konnte nicht angelegt werden."
      );
    } finally {
      setBusy(false);
    }
  };

  if (status === "loading") {
    return (
      <div
        aria-label="Staging-Beiträge werden geladen"
        className="h-40 animate-pulse rounded-xl border border-border bg-card"
      />
    );
  }
  if (status === "unavailable") {
    return (
      <section className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-950">
        Die isolierte Staging-Timeline ist gerade nicht erreichbar. Der normale
        Röbel-Feed bleibt unverändert.
      </section>
    );
  }

  return (
    <section
      aria-labelledby="stadtstack-staging-feed-title"
      className="contents"
    >
      <div className="flex flex-wrap items-center justify-between gap-2 px-1">
        <h2
          id="stadtstack-staging-feed-title"
          className="text-sm font-semibold text-foreground"
        >
          Staging-Testspur im normalen Feed
        </h2>
        <span className="inline-flex items-center gap-1 rounded-full border border-emerald-300 bg-emerald-50 px-2.5 py-1 text-[11px] font-semibold text-emerald-900">
          <ShieldCheck className="h-3.5 w-3.5" /> signiertes Nostr ·
          {citizenSession
            ? " dein verbundenes Konto"
            : " synthetische Testprofile"}
        </span>
      </div>

      <form
        onSubmit={publishPost}
        className="rounded-xl border border-dashed border-primary/35 bg-card p-4 shadow-sm"
      >
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start">
          {citizenSession ? (
            <div className="rounded-lg border border-emerald-300 bg-emerald-50 px-3 py-2 text-xs font-semibold text-emerald-950 sm:w-56">
              Dein Konto ·{" "}
              {citizenSession.snapshot.credential.address.slice(0, 8)}…
            </div>
          ) : (
            <select
              aria-label="Synthetisches Testprofil"
              value={draftPersonaId}
              onChange={(event) => setDraftPersonaId(event.target.value)}
              className="rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground sm:w-48"
            >
              {config?.personas.map((persona) => (
                <option key={persona.id} value={persona.id}>
                  {persona.name}
                </option>
              ))}
            </select>
          )}
          <textarea
            aria-label="Normalen Testbeitrag schreiben"
            value={draftContent}
            onChange={(event) => setDraftContent(event.target.value)}
            rows={2}
            maxLength={1_000}
            placeholder="Was gibt es Neues, Nachbar? Dieser Beitrag bleibt zunächst ein normaler Post."
            className="min-h-20 flex-1 rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground"
          />
          <button
            type="submit"
            disabled={
              busy ||
              (!citizenSession && !draftPersonaId) ||
              !draftContent.trim()
            }
            className="inline-flex items-center justify-center gap-1 rounded-full bg-primary px-4 py-2 text-xs font-semibold text-primary-foreground disabled:opacity-50"
          >
            {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}{" "}
            {citizenSession
              ? "Mit meinem Konto signieren"
              : "Signierten Testbeitrag veröffentlichen"}
          </button>
        </div>
      </form>

      {actionError && (
        <p
          role="alert"
          className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive"
        >
          {actionError}
        </p>
      )}

      {posts.map((post) =>
        post.entryType === "post" ? (
          <OrdinaryPostCard
            key={post.id}
            post={post}
            busy={busy}
            promotionOpen={promotionPostId === post.id}
            promotionQuestion={
              promotionPostId === post.id ? promotionQuestion : ""
            }
            setPromotionQuestion={setPromotionQuestion}
            onOpenPromotion={() => {
              setPromotionPostId(post.id);
              setPromotionQuestion("");
              setActionError(null);
            }}
            onCancelPromotion={() => {
              setPromotionPostId(null);
              setPromotionQuestion("");
            }}
            onPromote={(event) => void promotePost(event, post)}
          />
        ) : (
          <CivicTopicActivityCard key={post.id} topic={post} />
        )
      )}
    </section>
  );
}
