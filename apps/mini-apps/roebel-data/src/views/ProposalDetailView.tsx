// Proposal detail — read-only. Header (category + state + proposer), vote tallies,
// the full Irys body rendered as markdown/HTML, and a note that voting is private
// (cast in the Röbel app). Voting itself never happens here.
import { useEffect, useState } from "react";
import { fetchProposalBody, stateLabel, isActiveState, tally, type Proposal } from "../lib/proposals";
import { getProfiles, type Profile } from "../lib/circlesData";
import { Card, ChartCard, Pill, Skeleton, Banner, LinkChip, Avatar } from "../components/ui";
import { SplitBar } from "../components/charts";
import { ChevronLeft, Lock } from "../components/icons";
import { fmt } from "../lib/format";
import MarkdownRenderer from "../components/MarkdownRenderer";

const fmtDate = (iso: string) => {
  try {
    return new Date(iso).toLocaleDateString("de-DE", { day: "numeric", month: "short", year: "numeric" });
  } catch {
    return "";
  }
};

const VOTE_COLORS = { for: "#00498B", against: "#94a3b8", abstain: "#cbd5e1" } as const;

export default function ProposalDetailView({ proposal, onBack }: { proposal: Proposal; onBack: () => void }) {
  const [body, setBody] = useState<string | null>(null);
  const [proposer, setProposer] = useState<Profile | null>(null);

  useEffect(() => {
    let alive = true;
    setBody(null);
    fetchProposalBody(proposal).then((b) => alive && setBody(b)).catch(() => alive && setBody(""));
    return () => {
      alive = false;
    };
  }, [proposal]);

  useEffect(() => {
    const addr = proposal.proposer_address;
    if (!addr) return;
    let alive = true;
    getProfiles([addr])
      .then((m) => alive && setProposer(m.get(addr.toLowerCase()) ?? null))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [proposal.proposer_address]);

  const t = tally(proposal);
  const active = isActiveState(proposal.state);
  const snapshot = proposal.content?.metadata?.gemeinschaftskasse_snapshot;
  const proposerName = proposer?.name || "Bürger:in";
  const txHash = proposal.transaction_hash || proposal.proposal_id;

  return (
    <div className="space-y-4">
      <button
        onClick={onBack}
        className="-ml-1.5 inline-flex items-center gap-1 rounded-[10px] px-1.5 py-1 text-[13px] font-medium text-muted-foreground transition hover:text-foreground active:scale-[0.98]"
      >
        <ChevronLeft className="h-4 w-4" />
        Mitbestimmung
      </button>

      {/* Header */}
      <Card className="p-4">
        <div className="mb-2 flex flex-wrap items-center gap-1.5">
          {proposal.category && <Pill tone="muted">{proposal.category}</Pill>}
          <Pill tone={active ? "primary" : "muted"}>{stateLabel(proposal.state)}</Pill>
          {proposal.proposal_number != null && (
            <span className="ml-auto text-[11px] text-muted-foreground">#{proposal.proposal_number}</span>
          )}
        </div>
        <h1 className="font-display text-lg font-bold leading-snug tracking-tight text-foreground">{proposal.title}</h1>
        <div className="mt-3 flex items-center gap-2.5">
          {proposal.proposer_address && (
            <Avatar address={proposal.proposer_address} name={proposerName} imageUrl={proposer?.imageUrl ?? null} size={28} />
          )}
          <div className="min-w-0">
            <div className="truncate text-[13px] font-medium text-foreground">{proposerName}</div>
            <div className="text-[11px] text-muted-foreground">Vorgeschlagen am {fmtDate(proposal.created_at)}</div>
          </div>
        </div>
      </Card>

      {/* Votes */}
      <ChartCard title="Stimmen">
        {active && t.total === 0 ? (
          <div className="flex items-center gap-2.5 text-[13px] text-muted-foreground">
            <Lock className="h-4 w-4 shrink-0 text-[#00498B]" />
            Abstimmung läuft — die Stimmen sind bis zur Auszählung verschlüsselt.
          </div>
        ) : t.total === 0 ? (
          <p className="text-[13px] text-muted-foreground">Noch keine Stimmen.</p>
        ) : (
          <div className="space-y-2.5">
            <SplitBar
              parts={[
                { value: t.forV, color: VOTE_COLORS.for },
                { value: t.against, color: VOTE_COLORS.against },
                { value: t.abstain, color: VOTE_COLORS.abstain },
              ]}
            />
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-[12px]">
              <VoteLegend color={VOTE_COLORS.for} label="Dafür" value={t.forV} />
              <VoteLegend color={VOTE_COLORS.against} label="Dagegen" value={t.against} />
              <VoteLegend color={VOTE_COLORS.abstain} label="Enthaltung" value={t.abstain} />
            </div>
          </div>
        )}
      </ChartCard>

      <Card className="border-dashed bg-muted/25 p-4 shadow-none">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-[12px] font-semibold uppercase tracking-wide text-foreground">
            Stadtstack-Fallstatus
          </p>
          <Pill tone="muted">Nicht verknüpft</Pill>
        </div>
        <p className="mt-2 text-[12.5px] leading-relaxed text-muted-foreground">
          Ein kommunaler Fallstatus erscheint hier erst, wenn eine explizite,
          menschlich geprüfte Zuordnung genau zu diesem Vorschlag veröffentlicht
          wurde. Titel, Kategorie und Tags werden nicht automatisch abgeglichen.
        </p>
      </Card>

      {/* Treasury snapshot at proposal time */}
      {snapshot && (
        <Banner kind="info">
          Gemeinschaftskasse zum Zeitpunkt des Vorschlags: <span className="font-semibold text-foreground">€{fmt(snapshot.euro, 2)}</span>
        </Banner>
      )}

      {/* Body */}
      <ChartCard title="Vorschlag">
        {body === null ? (
          <div className="space-y-2">
            <Skeleton className="h-4 w-3/4" />
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-5/6" />
            <Skeleton className="h-4 w-2/3" />
          </div>
        ) : body ? (
          <MarkdownRenderer content={body} />
        ) : (
          <p className="text-[13px] text-muted-foreground">Kein Inhalt verfügbar.</p>
        )}
      </ChartCard>

      {/* Read-only voting note */}
      <Banner kind="warn">
        Abstimmen ist privat und läuft in der Röbel-App. Öffne diesen Vorschlag dort, um verschlüsselt abzustimmen.
      </Banner>

      {/* On-chain links */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 px-1">
        {txHash && <LinkChip href={`https://gnosisscan.io/tx/${txHash}`}>Transaktion</LinkChip>}
        {(proposal.irys_url || proposal.irys_content_id) && (
          <LinkChip href={proposal.irys_url || `https://gateway.irys.xyz/${proposal.irys_content_id}`}>Dauerhafte Kopie</LinkChip>
        )}
      </div>
    </div>
  );
}

function VoteLegend({ color, label, value }: { color: string; label: string; value: number }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-muted-foreground">
      <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: color }} />
      {label} <span className="font-semibold text-foreground tnum">{fmt(value, 0)}</span>
    </span>
  );
}
