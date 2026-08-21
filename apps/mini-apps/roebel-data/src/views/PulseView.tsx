// Wirtschaft tab — the town's live Röbel-Münzen economy. Opens with the connected
// citizen's own standing ("Dein Wirtschafts-Beitrag"), then one batched snapshot
// (getEconomy) feeds an interactive dashboard: KPI strip, supply & deckung, money
// flows, composition, holder distribution, velocity, reputation, the trust network,
// and a flow feed + CSV export. The range selector recomputes every series in memory.
import { useEffect, useMemo, useState } from "react";
import type { Address } from "viem";
import {
  getEconomy,
  getProfiles,
  getMyImpact,
  getTrustGraph,
  buildKpis,
  cumulativeSupplySeries,
  flowsByDay,
  transfersInRange,
  velocitySeries,
  reputationFrom,
  type EconomySnapshot,
  type RangeKey,
  type Profile,
} from "../lib/circlesData";
import { fetchRoebelCitizens } from "../lib/citizens-onchain";
import { ROEBEL_CITIZENS, type Citizen } from "../lib/citizens";
import { fmt, fmtInt, shortAddr } from "../lib/format";
import { ChartCard, PageHeader, KpiCard, SkeletonGrid, Skeleton } from "../components/ui";
import { Trophy, Activity } from "../components/icons";
import RadialGraph, { type RadialNode } from "../components/RadialGraph";
import { RangeSelector } from "./economy/RangeSelector";
import { KpiStrip } from "./economy/KpiStrip";
import { SupplyBackingSection } from "./economy/SupplyBackingSection";
import { MoneyFlowsSection } from "./economy/MoneyFlowsSection";
import { FlowCompositionSection } from "./economy/FlowCompositionSection";
import { HolderDistributionSection } from "./economy/HolderDistributionSection";
import { VelocitySection } from "./economy/VelocitySection";
import { ReputationSection } from "./economy/ReputationSection";
import { FlowFeedSection } from "./economy/FlowFeedSection";
import { ExportCard } from "./economy/ExportCard";
import { withMiniAppBasePath } from "../lib/publicDemoMode";

const coinImg = withMiniAppBasePath("/assets/roebel-coin.png");
const roebelLogo = withMiniAppBasePath("/assets/roebel-logo.png");

export default function PulseView({ connected }: { connected: Address | null }) {
  const [snap, setSnap] = useState<EconomySnapshot | null>(null);
  const [profiles, setProfiles] = useState<Map<string, Profile>>(new Map());
  const [range, setRange] = useState<RangeKey>("30d");
  const [loading, setLoading] = useState(true);
  // Trust network (radial group graph) + citizen list for the CSV export.
  const [trustNodes, setTrustNodes] = useState<RadialNode[] | null>(null);
  const [citizens, setCitizens] = useState<Citizen[]>(ROEBEL_CITIZENS);

  const load = async () => {
    setLoading(true);
    setSnap(null);
    setProfiles(new Map());
    const s = await getEconomy();
    setSnap(s);
    setLoading(false);
    // Progressive enhancement: resolve real names + pictures for the leaderboard
    // and the recent feed, then re-render. Best-effort, never blocks.
    const reps = reputationFrom(s).slice(0, 12).map((n) => n.address);
    const recent = s.transfers.slice(0, 40).flatMap((t) => [t.from, t.to]);
    getProfiles([...reps, ...recent]).then(setProfiles).catch(() => {});
  };
  useEffect(() => {
    void load();
  }, []);

  // Trust network — independent, read-only. Loads the group→member star + avatars.
  useEffect(() => {
    (async () => {
      const list = await fetchRoebelCitizens().catch(() => ROEBEL_CITIZENS);
      setCitizens(list);
      const s = await getEconomy().catch(() => null);
      const verified = s?.verified ?? new Set<string>();
      const [g, profs] = await Promise.all([
        getTrustGraph(verified),
        getProfiles(list.map((c) => c.address)).catch(() => new Map<string, Profile>()),
      ]);
      const nodes: RadialNode[] = g.nodes.map((nd) => {
        const p = profs.get(nd.id.toLowerCase());
        return {
          id: nd.id,
          address: nd.id,
          label: p?.name || shortAddr(nd.id),
          name: p?.name ?? null,
          imageUrl: p?.imageUrl ?? null,
          tone: nd.tone,
          dashed: !nd.trusted,
        };
      });
      setTrustNodes(nodes);
    })().catch(() => setTrustNodes([]));
  }, []);

  const kpis = useMemo(() => (snap ? buildKpis(snap, range) : []), [snap, range]);
  const supplySeries = useMemo(() => (snap ? cumulativeSupplySeries(snap.transfers, snap.supply, range) : []), [snap, range]);
  const flows = useMemo(() => (snap ? flowsByDay(snap.transfers, range) : []), [snap, range]);
  const inRange = useMemo(() => (snap ? transfersInRange(snap.transfers, range) : []), [snap, range]);
  const vel = useMemo(() => (snap ? velocitySeries(snap.transfers, snap.supply, range) : null), [snap, range]);
  const rep = useMemo(() => (snap ? reputationFrom(snap) : []), [snap]);
  const impact = useMemo(() => (connected && snap ? getMyImpact(connected, rep) : null), [connected, snap, rep]);

  return (
    <div className="space-y-4">
      <PageHeader title="Wirtschaft" description="Die Röbel-Münzen der Gemeinde in Echtzeit." onRefresh={load} refreshing={loading} />

      {/* Dein Wirtschafts-Beitrag — the connected citizen's own standing, up top */}
      {connected &&
        (impact ? (
          <ChartCard title="Dein Wirtschafts-Beitrag" subtitle="Dein Stand in der Röbel-Münzen-Wirtschaft">
            <div className="grid grid-cols-3 gap-3">
              <KpiCard label="Deine Münzen" value={fmt(impact.balance, 0)} sub="Röbel-Münzen" tone="primary" icon={<img src={coinImg} alt="" className="h-6 w-6" />} />
              <KpiCard label="Dein Rang" value={impact.rank ? `#${impact.rank}` : "—"} sub={`von ${impact.total}`} tone="muted" icon={<Trophy className="h-5 w-5" />} />
              <KpiCard label="Bewegungen" value={`${impact.inCount}↓ ${impact.outCount}↑`} sub="rein / raus" tone="muted" icon={<Activity className="h-5 w-5" />} />
            </div>
          </ChartCard>
        ) : (
          <Skeleton className="h-[110px]" />
        ))}

      {/* Live status + global range selector */}
      <div className="flex items-center justify-between gap-2">
        <span className="inline-flex items-center gap-1.5 text-[11px] text-muted-foreground">
          <span className={`h-1.5 w-1.5 rounded-full ${snap ? "bg-[#00498B]" : "bg-neutral-300"}`} />
          {snap ? `${fmtInt(snap.transfers.length)} Übertragungen · ${fmtInt(snap.holders.length)} Halter:innen` : "Lade Daten…"}
        </span>
        <RangeSelector value={range} onChange={setRange} />
      </div>

      {snap === null ? (
        <>
          <SkeletonGrid count={8} />
          <Skeleton className="h-72" />
          <Skeleton className="h-72" />
        </>
      ) : (
        <>
          <KpiStrip kpis={kpis} />
          <SupplyBackingSection series={supplySeries} supply={snap.supply} collateral={snap.collateral} />
          <MoneyFlowsSection buckets={flows} />
          <FlowCompositionSection transfers={inRange} />
          <HolderDistributionSection holders={snap.holders} />
          {vel && <VelocitySection vel={vel} />}
          <ReputationSection rep={rep} profiles={profiles} />

          {/* Trust network — the radial group→member star (moved from the Gemeinde tab) */}
          <ChartCard title="Vertrauensnetz der Röbel-Münzen" subtitle="Wer die Röbel-Münzen nutzt">
            {trustNodes === null ? (
              <Skeleton className="h-[440px]" />
            ) : (
              <RadialGraph
                center={{ label: "Röbel-Münzen", sub: `${snap.verified.size} verifiziert`, imageUrl: roebelLogo }}
                nodes={trustNodes}
                emptyLabel="noch keine Mitglieder"
              />
            )}
          </ChartCard>

          <FlowFeedSection transfers={snap.transfers} profiles={profiles} />
          <ExportCard verifiedSet={snap.verified} rep={rep} citizens={citizens} />
        </>
      )}
    </div>
  );
}
