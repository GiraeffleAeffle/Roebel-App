"use client";

export const dynamic = "force-dynamic";

import { Header } from "@/components/layout/Header";
import { useActiveAccount, useReadContract } from "thirdweb/react";
import { governorContract, governanceCitizenNFTContract as nftContract } from "@/lib/contracts";
import { balanceOf } from "thirdweb/extensions/erc721";
import { useState, useEffect } from "react";
import { useParams } from "next/navigation";
import { getProposal } from "@/lib/supabase";
import { fetchFromIrys } from "@/lib/irys";
import type { Proposal } from "@/lib/proposal-types";
import { ProposalHero } from "@/components/proposals/ProposalHero";
import { ProposalMetadata } from "@/components/proposals/ProposalMetadata";
import { VoteResults } from "@/components/proposals/VoteResults";
import { ProposalContent } from "@/components/proposals/ProposalContent";
import { ProposalTimeline } from "@/components/proposals/ProposalTimeline";
import Link from "next/link";
import { de } from "@/lib/translations/de";

export default function ProposalDetailPage() {
  const params = useParams();
  const proposalId = params.id as string;
  const account = useActiveAccount();

  // Local state
  const [proposal, setProposal] = useState<Proposal | null>(null);
  const [markdownContent, setMarkdownContent] = useState<string>("");
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingContent, setIsLoadingContent] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Fetch proposal from Supabase
  useEffect(() => {
    async function loadProposal() {
      setIsLoading(true);
      setError(null);

      console.log("📖 Loading proposal:", proposalId);

      const result = await getProposal(proposalId);

      if (result.success && result.data) {
        setProposal(result.data);
        console.log("✅ Proposal loaded from Supabase");

        // Fetch markdown from Irys
        loadMarkdownContent(result.data);
      } else {
        setError(result.error || "Failed to load proposal");
        console.error("❌ Failed to load proposal:", result.error);
      }

      setIsLoading(false);
    }

    if (proposalId) {
      loadProposal();
    }
  }, [proposalId]);

  // Fetch markdown content from Irys
  async function loadMarkdownContent(proposalData: Proposal) {
    setIsLoadingContent(true);

    try {
      console.log("📥 Fetching markdown from Irys:", proposalData.irys_content_id);
      const content = await fetchFromIrys(proposalData.irys_content_id);
      setMarkdownContent(content);
      console.log("✅ Markdown content loaded");
    } catch (err) {
      console.error("❌ Failed to load markdown:", err);
      // Fallback to content from Supabase if available
      if (proposalData.content.markdown) {
        setMarkdownContent(proposalData.content.markdown);
      } else {
        setMarkdownContent("Fehler beim Laden des Vorschlags. Bitte Seite neu laden.");
      }
    }

    setIsLoadingContent(false);
  }

  // Get NFT balance for voting eligibility
  const { data: nftBalance } = useReadContract(balanceOf, {
    contract: nftContract,
    owner: account?.address || "",
    queryOptions: { enabled: !!account },
  });

  // Get proposal state from blockchain (real-time)
  // Use numeric blockchain_proposal_id from Supabase for blockchain calls
  const blockchainProposalId = proposal?.blockchain_proposal_id;
  const { data: proposalState, isLoading: isLoadingState, error: stateError } = useReadContract({
    contract: governorContract,
    method: "function state(uint256 proposalId) view returns (uint8)",
    params: blockchainProposalId ? [BigInt(blockchainProposalId)] : [BigInt(0)],
    queryOptions: { enabled: !!blockchainProposalId },
  });

  // Debug: Log proposal state
  useEffect(() => {
    console.log("🔍 Proposal State Debug:", {
      proposalId,
      blockchainState: proposalState,
      supabaseState: proposal?.state,
      effectiveState: proposalState ?? proposal?.state,
      isLoadingState,
      stateError: stateError?.message,
    });
  }, [proposalId, proposalState, proposal?.state, isLoadingState, stateError]);

  // Get proposal votes from blockchain (real-time)
  const { data: proposalVotes, isLoading: isLoadingVotes, error: votesError } = useReadContract({
    contract: governorContract,
    method: "function proposalVotes(uint256 proposalId) view returns (uint256 againstVotes, uint256 forVotes, uint256 abstainVotes)",
    params: blockchainProposalId ? [BigInt(blockchainProposalId)] : [BigInt(0)],
    queryOptions: { enabled: !!blockchainProposalId },
  });

  // Check if user has voted
  const { data: hasVoted } = useReadContract({
    contract: governorContract,
    method: "function hasVoted(uint256 proposalId, address account) view returns (bool)",
    params: blockchainProposalId ? [BigInt(blockchainProposalId), account?.address || "0x0"] : [BigInt(0), "0x0"],
    queryOptions: { enabled: !!account && !!blockchainProposalId },
  });

  // Get user's voting power (current)
  const { data: votingPower } = useReadContract({
    contract: nftContract,
    method: "function getVotes(address account) view returns (uint256)",
    params: [account?.address || "0x0"],
    queryOptions: { enabled: !!account },
  });

  // Get proposal snapshot block (when proposal was created)
  const { data: proposalSnapshot } = useReadContract({
    contract: governorContract,
    method: "function proposalSnapshot(uint256 proposalId) view returns (uint256)",
    params: blockchainProposalId ? [BigInt(blockchainProposalId)] : [BigInt(0)],
    queryOptions: { enabled: !!blockchainProposalId },
  });

  // Get voting power at snapshot block (when proposal was created)
  const { data: votingPowerAtSnapshot } = useReadContract({
    contract: nftContract,
    method: "function getPastVotes(address account, uint256 blockNumber) view returns (uint256)",
    params: proposalSnapshot && account?.address
      ? [account.address, proposalSnapshot]
      : ["0x0", BigInt(0)],
    queryOptions: { enabled: !!proposalSnapshot && !!account },
  });

  // Calculate voting eligibility
  const hasNFT = nftBalance !== undefined && nftBalance > 0n;

  // Debug: Log vote data (after all variables declared)
  useEffect(() => {
    console.log("🗳️ Vote Data Debug:", {
      proposalId,
      blockchainProposalId,
      proposalVotes: proposalVotes ? {
        against: proposalVotes[0]?.toString(),
        for: proposalVotes[1]?.toString(),
        abstain: proposalVotes[2]?.toString(),
      } : undefined,
      votingPower: votingPower?.toString(),
      hasVoted,
      isLoadingVotes,
      votesError: votesError?.message,
      governorAddress: governorContract.address,
    });
  }, [proposalId, blockchainProposalId, proposalVotes, votingPower, hasVoted, isLoadingVotes, votesError]);

  // Voting moved to the Expo app for MACI privacy. The web detail page is
  // read-only — no castVote handler, no transaction signer hook. Removing the
  // dead code closes the door on the VotingHappensOnMaciPoll revert path
  // even if a stale Vercel build is briefly served from cache.
  const effectiveState = proposalState ?? proposal?.state;

  // Loading state
  if (isLoading) {
    return (
      <div className="min-h-screen bg-background">
        <Header />
        <main className="container mx-auto px-4 py-12">
          <div className="max-w-7xl mx-auto">
            <div className="animate-pulse space-y-6">
              <div className="h-64 bg-muted rounded-2xl" />
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                <div className="lg:col-span-2 space-y-6">
                  <div className="h-96 bg-muted rounded-xl" />
                  <div className="h-64 bg-muted rounded-xl" />
                </div>
                <div className="space-y-4">
                  <div className="h-48 bg-muted rounded-xl" />
                  <div className="h-48 bg-muted rounded-xl" />
                </div>
              </div>
            </div>
          </div>
        </main>
      </div>
    );
  }

  // Error state
  if (error || !proposal) {
    return (
      <div className="min-h-screen bg-background">
        <Header />
        <main className="container mx-auto px-4 py-12">
          <div className="max-w-3xl mx-auto text-center">
            <div className="bg-card border border-border rounded-2xl p-12 shadow-sm">
              <div className="text-6xl mb-4">❌</div>
              <h1 className="text-3xl font-medium mb-4 text-foreground">Vorschlag nicht gefunden</h1>
              <p className="text-muted-foreground mb-8">{error || "Dieser Vorschlag existiert nicht oder wurde entfernt."}</p>
              <Link
                href="/proposals"
                className="inline-flex items-center gap-2 bg-black hover:bg-foreground/90 text-white px-6 py-3 rounded-lg transition-colors font-medium"
              >
                ← Zurück zu Vorschlägen
              </Link>
            </div>
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <Header />

      <main className="container mx-auto px-4 py-8 md:py-12">
        <div className="max-w-7xl mx-auto">
          {/* Breadcrumb */}
          <div className="mb-6">
            <Link
              href="/proposals"
              className="inline-flex items-center gap-2 text-muted-foreground hover:text-foreground transition-colors"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
              {de.navigation.backToDashboard}
            </Link>
          </div>

          {/* Hero Section */}
          <ProposalHero proposal={proposal} />

          {/* Main Content Grid */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Left Column - Main Content */}
            <div className="lg:col-span-2 space-y-6">
              {/* Full Proposal Content (Description) */}
              <ProposalContent markdown={markdownContent} isLoading={isLoadingContent} />

              {/* Vote Results - Always show, with safe defaults */}
              <VoteResults
                forVotes={proposalVotes?.[1]?.toString() || "0"}
                againstVotes={proposalVotes?.[0]?.toString() || "0"}
                abstainVotes={proposalVotes?.[2]?.toString() || "0"}
              />

              {/* Voting moved to the Expo app for MACI privacy.
                  Casting from web is intentionally disabled — the new MACI
                  Governor reverts on castVote() with VotingHappensOnMaciPoll. */}
              <div className="bg-card border border-border rounded-2xl p-6 space-y-4">
                <div className="flex items-start gap-3">
                  <div className="text-2xl leading-none">📱</div>
                  <div className="flex-1 space-y-2">
                    <h3 className="text-lg font-medium text-foreground">
                      Verschlüsselt abstimmen — in der Roebel-App
                    </h3>
                    <p className="text-sm text-muted-foreground">
                      Damit deine Stimme privat und kollusionsresistent gezählt
                      werden kann, läuft das Abstimmen ausschließlich über die
                      mobile App. Vorschläge werden weiterhin hier im Web
                      erstellt, aber gewählt wird verschlüsselt auf dem Handy.
                    </p>
                    <p className="text-sm text-muted-foreground">
                      Öffne die Roebel-App, melde dich einmalig bei MACI an und
                      gib deine Stimme ab — du kannst sie bis zum Ende der
                      Frist beliebig oft ändern.
                    </p>
                  </div>
                </div>
              </div>
            </div>

            {/* Right Column - Metadata & Timeline Sidebar */}
            <div className="lg:col-span-1">
              <div className="sticky top-24 space-y-6">
                <ProposalMetadata proposal={proposal} />
                <ProposalTimeline proposal={proposal} />
              </div>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
