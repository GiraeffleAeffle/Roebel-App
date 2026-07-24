// Governance tab — the town's on-chain governance in one read-only view:
//   • Gemeinschaftskasse (town treasury) balance
//   • all proposals, status-grouped (Active first, then closed)
//   • tap a proposal → full detail with the Irys body (see ProposalDetailView)
// Voting stays private in the Röbel app. Best-effort fetches → never throws.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getTreasury, type Treasury } from "../lib/treasury";
import { getProposals, getMaciSignups, isActiveState, stateLabel, tally, type Proposal } from "../lib/proposals";
import { ChartCard, PageHeader, KpiCard, Pill, Skeleton, EmptyHint, SectionTitle } from "../components/ui";
import { SplitBar } from "../components/charts";
import { BallotBox, Vault, Users, Lock, ChevronRight } from "../components/icons";
import { fmt } from "../lib/format";
import { track } from "../lib/analytics";
import ProposalDetailView from "./ProposalDetailView";
import MunicipalDecisionCasesSection, {
  MunicipalDemoTopicView,
} from "./MunicipalDecisionCasesSection";
import {
  ROEBEL_MARIENFELDER_DEMO_TOPIC_BINDING,
  type CivicTopicBindingV1,
} from "../lib/municipalTopicBinding";

const VOTE_COLORS = { for: "#00498B", against: "#94a3b8", abstain: "#cbd5e1" } as const;

export default function GovernanceView({
  initialProposalId = null,
  initialCivicTopicBinding = null,
  onOpenMunicipalCase,
  publicDemoOnly = false,
}: {
  initialProposalId?: string | null;
  initialCivicTopicBinding?: CivicTopicBindingV1 | null;
  onOpenMunicipalCase: (url: string) => void;
  /** A standalone read-only staging build: no treasury, proposals or wallet paths. */
  publicDemoOnly?: boolean;
}) {
  const [treasury, setTreasury] = useState<Treasury | null>(null);
  const [proposals, setProposals] = useState<Proposal[] | null>(null);
  const [signups, setSignups] = useState<number | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(initialProposalId);
  const [selectedTopic, setSelectedTopic] =
    useState<CivicTopicBindingV1 | null>(initialCivicTopicBinding);
  const [loading, setLoading] = useState(true);
  const deepLinked = useRef(false);

  const load = useCallback(async () => {
    setLoading(true);
    const [tre, props] = await Promise.all([getTreasury(), getProposals()]);
    setTreasury(tre);
    setProposals(props);
    setLoading(false);
    // The electorate = MACI sign-ups (registered voting keys), the same number the
    // apps/web admin "DAO & Bürger" page shows. Fill in after the core view.
    getMaciSignups().then(setSignups).catch(() => {});
  }, []);
  useEffect(() => {
    if (publicDemoOnly) return;
    void load();
  }, [load, publicDemoOnly]);

  // A ?proposal=<id> deep-link opens straight onto the matching detail once loaded.
  useEffect(() => {
    if (publicDemoOnly) return;
    if (deepLinked.current || !initialProposalId || !proposals) return;
    deepLinked.current = true;
    const hit = proposals.find(
      (p) => p.proposal_id === initialProposalId || p.transaction_hash === initialProposalId,
    );
    if (hit) setSelectedId(hit.proposal_id);
  }, [initialProposalId, proposals, publicDemoOnly]);

  const selected = useMemo(
    () => proposals?.find((p) => p.proposal_id === selectedId) ?? null,
    [proposals, selectedId],
  );

  const open = (p: Proposal) => {
    if (publicDemoOnly) return;
    setSelectedTopic(null);
    setSelectedId(p.proposal_id);
    track("proposal_open", { id: p.proposal_id, state: p.state });
  };

  // This shortcut is intentionally before every treasury/proposal render. It
  // is the whole public staging surface: one fixed, unbound, synthetic topic.
  // The normal Mini App keeps its existing Governance behaviour whenever the
  // explicit public-demo build switch is absent.
  if (publicDemoOnly) {
    return (
      <MunicipalDemoTopicView
        binding={ROEBEL_MARIENFELDER_DEMO_TOPIC_BINDING}
        onBack={() => {}}
        showBack={false}
      />
    );
  }

  if (selected) {
    return <ProposalDetailView proposal={selected} onBack={() => setSelectedId(null)} />;
  }
  if (selectedTopic) {
    return (
      <MunicipalDemoTopicView
        binding={selectedTopic}
        onBack={() => setSelectedTopic(null)}
      />
    );
  }

  const active = (proposals ?? []).filter((p) => isActiveState(p.state));
  const closed = (proposals ?? []).filter((p) => !isActiveState(p.state));

  return (
    <div className="space-y-4">
      <PageHeader
        title="Mitbestimmung"
        description="Gemeinschaftskasse und Vorschläge im Überblick. Stimme in der Röbel-App privat ab."
        onRefresh={load}
        refreshing={loading}
      />

      {/* Town treasury */}
      <ChartCard title="Gemeinschaftskasse" subtitle="Gemeinschaftskasse der Gemeinde">
        {!treasury ? (
          <Skeleton className="h-[120px]" />
        ) : (
          <div>
            <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Kassenstand</div>
            <div className="mt-1 text-4xl font-semibold leading-none tracking-tight text-foreground tnum">€{fmt(treasury.euro, 2)}</div>
            <div className="mt-4 space-y-2.5 border-t border-border pt-3.5">
              <AssetRow label="Reserve" sub="Netz-Guthaben" value={fmt(treasury.xdai, 2)} />
              <AssetRow label="Euro" sub="Digitaler Euro" value={fmt(treasury.eure, 2)} />
              <AssetRow label="Röbel-Münzen" sub="Gemeinschaftswährung" value={fmt(treasury.muenzen, 0)} />
            </div>
          </div>
        )}
      </ChartCard>

      {/* Governance KPIs */}
      <div className="grid grid-cols-3 gap-3">
        <KpiCard
          label="Offen"
          value={proposals ? active.length : "—"}
          sub="Vorschläge"
          tone="primary"
          icon={<BallotBox className="h-5 w-5" />}
        />
        <KpiCard
          label="Gesamt"
          value={proposals ? proposals.length : "—"}
          sub="Vorschläge"
          tone="info"
          icon={<Vault className="h-5 w-5" />}
        />
        <KpiCard
          label="Angemeldet"
          value={signups ?? "—"}
          sub="zum Abstimmen"
          tone="success"
          icon={<Users className="h-5 w-5" />}
        />
      </div>

      {/* Reviewed municipal cases are a separate information rail. They do not
          become on-chain proposals and this mini app never writes back. */}
      <MunicipalDecisionCasesSection
        onOpenCase={onOpenMunicipalCase}
        onOpenDemoTopic={(binding) => {
          setSelectedId(null);
          setSelectedTopic(binding);
        }}
      />

      {/* Proposals */}
      {!proposals ? (
        <div className="space-y-3">
          <Skeleton className="h-[96px]" />
          <Skeleton className="h-[96px]" />
        </div>
      ) : proposals.length === 0 ? (
        <EmptyHint>Noch keine Vorschläge. Neue Vorschläge aus der Röbel-App erscheinen hier.</EmptyHint>
      ) : (
        <div className="space-y-4">
          {active.length > 0 && (
            <div className="space-y-2.5">
              <SectionTitle>Aktiv</SectionTitle>
              {active.map((p) => (
                <ProposalCard key={p.proposal_id} p={p} onClick={() => open(p)} />
              ))}
            </div>
          )}
          {closed.length > 0 && (
            <div className="space-y-2.5">
              <SectionTitle>Abgeschlossen</SectionTitle>
              {closed.map((p) => (
                <ProposalCard key={p.proposal_id} p={p} onClick={() => open(p)} />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function AssetRow({ label, sub, value }: { label: string; sub: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <div className="min-w-0">
        <div className="text-[13px] font-medium text-foreground">{label}</div>
        <div className="text-[11px] text-muted-foreground">{sub}</div>
      </div>
      <div className="shrink-0 text-[15px] font-semibold text-foreground tnum">{value}</div>
    </div>
  );
}

function ProposalCard({ p, onClick }: { p: Proposal; onClick: () => void }) {
  const active = isActiveState(p.state);
  const t = tally(p);
  return (
    <button
      onClick={onClick}
      className="block w-full rounded-[10px] border border-border bg-card p-4 text-left shadow-sm transition hover:bg-muted active:scale-[0.99]"
    >
      <div className="mb-1.5 flex items-center gap-1.5">
        {p.category && <Pill tone="muted">{p.category}</Pill>}
        <Pill tone={active ? "primary" : "muted"}>{stateLabel(p.state)}</Pill>
        {p.proposal_number != null && <span className="ml-auto text-[11px] text-muted-foreground">#{p.proposal_number}</span>}
      </div>
      <div className="flex items-start gap-2">
        <h4 className="min-w-0 flex-1 text-sm font-semibold leading-snug text-foreground line-clamp-2">{p.title}</h4>
        <ChevronRight className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
      </div>
      {p.summary && <p className="mt-1 text-[12.5px] leading-relaxed text-muted-foreground line-clamp-2">{p.summary}</p>}
      <div className="mt-2.5">
        {active && t.total === 0 ? (
          <span className="inline-flex items-center gap-1.5 text-[11px] text-muted-foreground">
            <Lock className="h-3.5 w-3.5 text-[#00498B]" />
            Abstimmung läuft — verschlüsselt
          </span>
        ) : t.total > 0 ? (
          <SplitBar
            parts={[
              { value: t.forV, color: VOTE_COLORS.for },
              { value: t.against, color: VOTE_COLORS.against },
              { value: t.abstain, color: VOTE_COLORS.abstain },
            ]}
          />
        ) : (
          <span className="text-[11px] text-muted-foreground">Noch keine Stimmen</span>
        )}
      </div>
    </button>
  );
}
