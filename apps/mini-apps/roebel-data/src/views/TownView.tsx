// Gemeinde tab — the civic heart of the app: real citizen-verification data (how many
// verified citizens / attesters / verifications), the connected citizen's own standing
// ("Dein Beitrag"), the verification graph, and the citizen action tools. No coin /
// economy data here — that all lives on the Wirtschaft tab.
import type { Address } from "viem";
import { useCitizenGraph, myContribution } from "../lib/citizen-graph";
import { ChartCard, PageHeader, KpiCard, Pill, SkeletonGrid } from "../components/ui";
import { ShieldCheck, Users, Check, Activity, ChevronRight } from "../components/icons";
import CitizenGraphCanvas from "../components/graph/CitizenGraphCanvas";
import { DOCUMENTARY_VIDEOS } from "../lib/documentary";
import { withMiniAppBasePath } from "../lib/publicDemoMode";
import { useEffect, useState } from "react";
const inviteImg = withMiniAppBasePath("/assets/invite-citizen.png");
const eventImg = withMiniAppBasePath("/assets/event-creation.png");

export default function TownView({
  connected,
  onOpenInvite,
  onOpenEvent,
  onOpenDocumentary,
}: {
  connected: Address | null;
  onOpenInvite: () => void;
  onOpenEvent: () => void;
  onOpenDocumentary: () => void;
}) {
  const { counts, nodes, edges, isLoading, refresh } = useCitizenGraph();
  const contrib = myContribution(connected, nodes, edges);
  const loadingKpis = isLoading && counts.citizens === 0;

  return (
    <div className="space-y-4">
      <PageHeader
        title="Gemeinde"
        description="Verifizierte Bürger:innen aus Röbel – wer dazugehört und wer für wen bürgt."
        onRefresh={refresh}
        refreshing={isLoading}
      />

      {/* Dein Beitrag — the connected citizen's own civic standing */}
      {connected && (
        <ChartCard title="Dein Beitrag" subtitle="Deine Rolle in der Gemeinde">
          <div className="space-y-3">
            <div className="flex flex-wrap gap-2">
              {contrib.isCitizen ? (
                <Pill tone="primary">
                  <Check className="h-3 w-3" /> Verifizierte:r Bürger:in
                </Pill>
              ) : (
                <Pill tone="muted">Noch nicht verifiziert</Pill>
              )}
              {contrib.isAttester && (
                <Pill tone="primary">
                  <ShieldCheck className="h-3 w-3" /> Bescheiniger:in
                </Pill>
              )}
            </div>
            <KpiCard
              label="Mit-verifiziert"
              value={contrib.verifiedCount}
              sub="Bürger:innen mit-bestätigt"
              tone="primary"
              icon={<Users className="h-5 w-5" />}
            />
          </div>
        </ChartCard>
      )}

      {/* Civic KPI grid — town-wide verification data */}
      {loadingKpis ? (
        <SkeletonGrid count={4} />
      ) : (
        <div className="grid grid-cols-2 gap-3">
          <KpiCard
            label="Verifizierte Bürger:innen"
            value={counts.citizens}
            sub="in der Gemeinde"
            tone="primary"
            icon={<Users className="h-5 w-5" />}
          />
          <KpiCard
            label="Bescheiniger:innen"
            value={counts.attesters}
            sub="bürgen für neue"
            tone="muted"
            icon={<ShieldCheck className="h-5 w-5" />}
          />
          <KpiCard
            label="Verifizierungen"
            value={counts.verifications}
            sub="Bürgschaften insgesamt"
            tone="muted"
            icon={<Check className="h-5 w-5" />}
          />
          <KpiCard
            label="Offene Anträge"
            value={counts.pending}
            sub="warten auf Bürgschaft"
            tone="muted"
            icon={<Activity className="h-5 w-5" />}
          />
        </div>
      )}

      {/* Verification graph — who vouched for whom */}
      <ChartCard title="Verifizierungsnetz" subtitle="Wer für wen gebürgt hat">
        <CitizenGraphCanvas />
      </ChartCard>

      {/* Citizen tools — bold, image-forward action cards */}
      <div className="grid grid-cols-2 gap-3">
        <ToolCard
          title="Bürger:innen einladen"
          image={inviteImg}
          imgClassName="right-0 top-1/2 h-[122%] -translate-y-1/2 translate-x-[10%]"
          onClick={onOpenInvite}
        />
        <ToolCard
          title="Event-Belohnungen"
          image={eventImg}
          imgClassName="right-0 top-1/2 h-[122%] -translate-y-1/2 translate-x-[7%]"
          onClick={onOpenEvent}
        />
      </div>

      {/* Video documentation — navy card with an animated stacked-thumbnail loop */}
      <VideoDocCard onClick={onOpenDocumentary} />
    </div>
  );
}

// Bold, image-forward action card (Invite / Event). Big stacked headline top-left,
// a navy circular arrow bottom-left, and the artwork bleeding off the right edge.
function ToolCard({
  title,
  image,
  imgClassName = "",
  onClick,
}: {
  title: string;
  image: string;
  imgClassName?: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="group relative flex h-32 flex-col justify-between overflow-hidden rounded-[12px] border border-border bg-card p-3.5 text-left shadow-sm transition hover:shadow-md active:scale-[0.99]"
    >
      <img
        src={image}
        alt=""
        aria-hidden
        className={`pointer-events-none absolute max-w-none select-none object-contain transition duration-300 group-hover:scale-105 ${imgClassName}`}
      />
      <h3 className="relative z-10 max-w-[68%] font-display text-lg font-extrabold uppercase leading-[1.04] tracking-tight text-foreground">
        {title}
      </h3>
      <span className="relative z-10 flex h-11 w-11 items-center justify-center rounded-full bg-[#00498B] text-white shadow-md transition group-hover:scale-105">
        <ChevronRight className="h-5 w-5" />
      </span>
    </button>
  );
}

// Navy "Video-Doku" card: stacked headline + outlined pill button on the left,
// an animated 3-thumbnail loop on the right.
function VideoDocCard({ onClick }: { onClick: () => void }) {
  // The three most recent episodes, front-most first.
  const thumbs = DOCUMENTARY_VIDEOS.slice(-3).reverse().map((v) => v.thumb);
  return (
    <button
      onClick={onClick}
      className="group relative block h-32 w-full overflow-hidden rounded-[14px] bg-[#00498B] p-4 text-left shadow-sm transition hover:shadow-md active:scale-[0.99]"
    >
      <div className="flex h-full items-center gap-4">
        <div className="relative z-10 min-w-0 flex-1">
          <h3 className="font-display text-xl font-extrabold uppercase leading-[1.04] tracking-tight text-white">
            <span className="block">Video</span>
            <span className="block">Doku</span>
          </h3>
          <span className="mt-3 inline-flex items-center gap-2 rounded-full border border-white/80 px-4 py-2 text-[13px] font-semibold text-white transition group-hover:bg-white/10">
            Jetzt ansehen
            <ChevronRight className="h-4 w-4" />
          </span>
        </div>
        <div className="relative h-full w-[150px] shrink-0">
          <ThumbStack thumbs={thumbs} />
        </div>
      </div>
    </button>
  );
}

// Three fixed positions for the looping stack — front, middle, back. The back
// cards fan up and to the right so their edges peek out behind the front one.
const STACK_SLOTS = [
  { x: 0, y: 0, scale: 1, rot: 0, z: 30, o: 1 }, // front
  { x: 18, y: -16, scale: 0.9, rot: 4, z: 20, o: 0.92 }, // middle
  { x: 36, y: -32, scale: 0.8, rot: 8, z: 10, o: 0.8 }, // back
];

// Continuously rotates three thumbnails: the front card recedes all the way to the
// back while the next one rises to the front and scales up — a smooth, looping
// stack. Driven by a tick counter so CSS transitions (and instant z-index changes)
// animate each card between its fixed slots. Honours prefers-reduced-motion.
function ThumbStack({ thumbs }: { thumbs: string[] }) {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
    const id = setInterval(() => setTick((t) => t + 1), 2200);
    return () => clearInterval(id);
  }, []);
  return (
    <div className="absolute inset-0" style={{ perspective: 900 }}>
      {thumbs.map((src, i) => {
        const slot = STACK_SLOTS[(((i - tick) % 3) + 3) % 3];
        return (
          <div
            key={i}
            className="absolute left-1/2 top-1/2 w-[130px]"
            style={{
              transform: `translate(calc(-50% + ${slot.x}px), calc(-50% + ${slot.y}px)) scale(${slot.scale}) rotate(${slot.rot}deg)`,
              zIndex: slot.z,
              opacity: slot.o,
              transition: "transform 900ms cubic-bezier(0.22, 1, 0.36, 1), opacity 900ms ease",
              willChange: "transform, opacity",
            }}
          >
            <div className="overflow-hidden rounded-[9px] border border-white/20 bg-black shadow-xl ring-1 ring-black/30">
              <img src={src} alt="" loading="lazy" className="aspect-video w-full object-cover" />
            </div>
          </div>
        );
      })}
    </div>
  );
}
