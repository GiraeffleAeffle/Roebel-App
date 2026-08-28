"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ArrowRight, Check, Circle, GitFork } from "lucide-react";

import type { PublicCivicPostLink } from "@/lib/stadtstack/civic-topic-detail";
import { loadPublicCivicPostLink } from "@/lib/stadtstack/civic-projection-client";
import { resolveStadtstackStagingLab } from "@/lib/stadtstack/staging-lab";
import { StadtstackPostPromotion } from "./StadtstackPostPromotion";

type PromotionPost = Readonly<{
  id: string;
  walletAddress: string;
  content: string;
  createdAt: string;
}>;

const FRONT_STAGES = new Set([
  "topic",
  "discussion",
  "mecky",
  "proposal",
  "case",
  "administration",
  "participation",
]);

export function StadtstackPostJourney({
  sourceAppPostId,
  promotionPost,
}: {
  sourceAppPostId: string;
  promotionPost?: PromotionPost;
}) {
  const enabled = resolveStadtstackStagingLab(
    process.env.NEXT_PUBLIC_STADTSTACK_STAGING_LAB
  );
  const [link, setLink] = useState<PublicCivicPostLink | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [projectionAvailable, setProjectionAvailable] = useState(true);

  useEffect(() => {
    let active = true;
    setLink(null);
    setLoaded(false);
    setProjectionAvailable(true);
    if (!enabled)
      return () => {
        active = false;
      };
    void loadPublicCivicPostLink(sourceAppPostId)
      .then((nextLink) => {
        if (active) setLink(nextLink);
      })
      .catch(() => {
        // Civic linkage is additive. A temporary projection outage must not
        // make the ordinary source post unreadable.
        if (active) setProjectionAvailable(false);
      })
      .finally(() => {
        if (active) setLoaded(true);
      });
    return () => {
      active = false;
    };
  }, [enabled, sourceAppPostId]);

  if (!enabled || !loaded || !projectionAvailable) return null;
  if (!link)
    return promotionPost ? (
      <StadtstackPostPromotion post={promotionPost} />
    ) : null;

  const current = link.journey.stages.find(
    (stage) => stage.id === link.journey.currentStageId
  );
  const visibleStages = link.journey.stages.filter((stage) =>
    FRONT_STAGES.has(stage.id)
  );
  const topic = link.detail.topic;

  return (
    <section
      data-civic-post-journey
      className="border-t border-primary/20 bg-primary/[0.035] px-4 py-4"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="inline-flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-primary">
            <GitFork className="h-4 w-4" /> Bürgerprozess aus diesem Beitrag
          </p>
          <h2 className="mt-1 text-sm font-semibold text-foreground">
            {topic.topicTitle}
          </h2>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">
            Der ursprüngliche Beitrag bleibt unverändert. Diskussion,
            Mecky-Antwort, Vorschlag und spätere öffentliche Schritte sind über
            dieses Thema nachvollziehbar verbunden.
          </p>
        </div>
        <Link
          href={`/app/themen/${encodeURIComponent(topic.topicId)}`}
          className="inline-flex items-center gap-1 rounded-full bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground"
        >
          Bürgerprozess öffnen <ArrowRight className="h-3.5 w-3.5" />
        </Link>
      </div>

      <ol
        aria-label="Stand des Bürgerprozesses"
        className="mt-3 flex flex-wrap gap-1.5"
      >
        {visibleStages.map((stage) => (
          <li
            key={stage.id}
            aria-current={stage.state === "current" ? "step" : undefined}
            className={`inline-flex items-center gap-1 rounded-full border px-2 py-1 text-[11px] font-semibold ${
              stage.state === "complete"
                ? "border-emerald-300 bg-emerald-50 text-emerald-900"
                : stage.state === "current"
                  ? "border-primary bg-background text-primary"
                  : "border-border bg-muted/40 text-muted-foreground"
            }`}
          >
            {stage.state === "complete" ? (
              <Check className="h-3 w-3" aria-hidden="true" />
            ) : (
              <Circle className="h-3 w-3" aria-hidden="true" />
            )}
            {stage.label}
          </li>
        ))}
      </ol>
      <p className="mt-2 text-xs font-medium text-foreground">
        {current
          ? `Nächster Schritt: ${current.label} — ${current.detail}`
          : "Die öffentlich nachvollziehbaren Schritte sind abgeschlossen."}
      </p>
    </section>
  );
}
