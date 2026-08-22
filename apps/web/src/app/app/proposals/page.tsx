"use client";

export const dynamic = "force-dynamic";

import Link from "next/link";
import { ProposalCard } from "@/components/proposals/ProposalCard";
import { Card } from "@/components/ui/card";
import { useEffect, useState } from "react";
import { getProposals } from "@/lib/supabase";
import type { Proposal } from "@/lib/proposal-types";
import { de } from "@/lib/translations/de";
import { Network, Layers, ArrowUpRight } from "lucide-react";
import { StadtstackAdvisoryParticipation } from "@/components/app/StadtstackAdvisoryParticipation";
import { resolveStadtstackStagingLab } from "@/lib/stadtstack/staging-lab";

export default function ProposalsPage() {
  const stadtstackStagingLab = resolveStadtstackStagingLab(
    process.env.NEXT_PUBLIC_STADTSTACK_STAGING_LAB,
  );
  const [proposals, setProposals] = useState<Proposal[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [stadtstackCaseId, setStadtstackCaseId] = useState<string | null | undefined>(undefined);
  const [stadtstackTopicId, setStadtstackTopicId] = useState<string | null>(null);

  useEffect(() => {
    const search = new URLSearchParams(window.location.search);
    setStadtstackCaseId(search.get("case"));
    setStadtstackTopicId(search.get("topic"));
  }, []);

  // Fetch proposals from Supabase
  useEffect(() => {
    async function fetchProposals() {
      setIsLoading(true);
      setError(null);

      console.log("📋 Fetching proposals from Supabase...");

      const result = await getProposals({
        orderBy: "created_at",
        orderDirection: "desc",
        limit: 50,
      });

      if (result.success && result.data) {
        setProposals(result.data.proposals);
        console.log(`✅ Loaded ${result.data.proposals.length} proposals`);
      } else {
        setError(result.error || "Failed to load proposals");
        console.error("❌ Failed to load proposals:", result.error);
      }

      setIsLoading(false);
    }

    fetchProposals();
  }, []);

  return (
    <div className="space-y-6">
        <div className="max-w-6xl mx-auto">

          <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-8">
            <div>
              <h1 className="text-3xl font-medium text-foreground">{de.proposals.title}</h1>
              <p className="text-muted-foreground mt-1">{de.proposals.subtitle}</p>
            </div>
          </div>

          {stadtstackStagingLab && (
            <StadtstackAdvisoryParticipation caseId={stadtstackCaseId} topicId={stadtstackTopicId} />
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-8">
            <Link
              href="/graph"
              target="_blank"
              rel="noopener noreferrer"
              className="group block focus:outline-none"
            >
              <Card className="px-4 py-3 shadow-none transition-colors hover:border-primary/50 hover:bg-accent/40">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-start gap-3 min-w-0">
                    <Network className="h-5 w-5 text-muted-foreground flex-shrink-0 mt-0.5" />
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-foreground">
                        Bürger-Netzwerk
                      </p>
                      <p className="text-xs text-muted-foreground">
                        Verifizierungs-Graph aller Bürger.
                      </p>
                    </div>
                  </div>
                  <ArrowUpRight className="h-4 w-4 text-muted-foreground flex-shrink-0 transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
                </div>
              </Card>
            </Link>

            <Link
              href="/proposals/timeline"
              target="_blank"
              rel="noopener noreferrer"
              className="group block focus:outline-none"
            >
              <Card className="px-4 py-3 shadow-none transition-colors hover:border-primary/50 hover:bg-accent/40">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-start gap-3 min-w-0">
                    <Layers className="h-5 w-5 text-muted-foreground flex-shrink-0 mt-0.5" />
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-foreground">
                        Zeitleiste
                      </p>
                      <p className="text-xs text-muted-foreground">
                        Geschichte aller Vorschläge mit Basescan-Verlinkung.
                      </p>
                    </div>
                  </div>
                  <ArrowUpRight className="h-4 w-4 text-muted-foreground flex-shrink-0 transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
                </div>
              </Card>
            </Link>
          </div>

          <div className="space-y-6">
            {error && !stadtstackStagingLab && (
              <div className="bg-red-50 border border-red-200 rounded-lg p-4">
                <p className="text-sm text-red-800">{de.errors.loadingDataFailed}: {error}</p>
              </div>
            )}

            <div className="bg-card border border-border rounded-xl shadow-sm p-6">
              <div className="flex items-center justify-between mb-6">
                <div>
                  <h2 className="text-xl font-medium text-foreground">{de.proposals.allProposals}</h2>
                  {stadtstackStagingLab && <p className="mt-1 text-xs text-muted-foreground">Formale Governance · technisch und rechtlich vom beratenden Staging-Fall getrennt</p>}
                </div>
                <span className="text-sm text-muted-foreground bg-muted px-3 py-1 rounded-full">
                  Gesamt: {proposals.length}
                </span>
              </div>

              {isLoading ? (
                <div className="text-center py-12">
                  <div className="inline-block w-8 h-8 border-4 border-black border-t-transparent rounded-full animate-spin mb-4" />
                  <p className="text-muted-foreground">{de.proposals.loadingProposals}</p>
                </div>
              ) : proposals.length > 0 ? (
                <div className="space-y-4">
                  {proposals.map((proposal: Proposal) => (
                    <ProposalCard
                      key={proposal.id}
                      proposal={proposal}
                      basePath="/app/proposals"
                    />
                  ))}
                </div>
              ) : (
                <div className="text-center py-12">
                  <p className="text-muted-foreground">{stadtstackStagingLab && error ? "Der formale Governance-Dienst ist in diesem Prüfstand nicht verbunden." : de.proposals.noProposals}</p>
                </div>
              )}
            </div>

              <div className="bg-blue-50 border border-blue-200 rounded-xl shadow-sm p-6">
                <h3 className="text-lg font-medium mb-4 text-blue-900">{de.proposals.howVotingWorks}</h3>
                <div className="space-y-3 text-blue-800 text-sm">
                  {de.proposals.votingInfo.map((info, index) => (
                    <div key={index} className="flex items-start gap-3">
                      <span className="font-medium">{index + 1}.</span>
                      <span>{info}</span>
                    </div>
                  ))}
                </div>
              </div>
          </div>
        </div>
    </div>
  );
}
