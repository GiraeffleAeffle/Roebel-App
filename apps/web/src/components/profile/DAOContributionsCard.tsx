"use client";

import {
  governorContract,
  attesterNFTContract,
  citizenNFTContract,
} from "@/lib/verification-contracts";
import { useEffect, useState } from "react";
import { getDaysSinceJoined } from "@/lib/user-types";

interface Contributions {
  proposalsCreated: number;
  attesterSignatures: number;
  citizenSignatures: number;
  totalSignatures: number;
  memberSince: string;
}

interface DAOContributionsCardProps {
  user: {
    created_at: string;
  };
  /**
   * Connected wallet address from the page (via useUserProfile). This card is
   * bundled into the citizen-dashboard page chunk, which resolves a duplicate
   * thirdweb/react instance with a null ThirdwebProvider context — so calling
   * useActiveAccount() here would throw. Take the address as a prop instead.
   */
  walletAddress?: string;
}

export function DAOContributionsCard({ user, walletAddress }: DAOContributionsCardProps) {
  const [contributions, setContributions] = useState<Contributions>({
    proposalsCreated: 0,
    attesterSignatures: 0,
    citizenSignatures: 0,
    totalSignatures: 0,
    memberSince: user.created_at,
  });
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    if (!walletAddress) {
      setIsLoading(false);
      return;
    }

    const fetchContributions = async () => {
      try {
        const { getContractEvents, prepareEvent } = await import("thirdweb");

        // Define ProposalCreated event
        const proposalCreatedEvent = prepareEvent({
          signature:
            "event ProposalCreated(uint256 proposalId, address proposer, address[] targets, uint256[] values, string[] signatures, bytes[] calldatas, uint256 voteStart, uint256 voteEnd, string description)",
        });

        // Fetch ProposalCreated events
        const proposalEvents = await getContractEvents({
          contract: governorContract,
          events: [proposalCreatedEvent],
          fromBlock: -10000n, // Last ~10000 blocks
          toBlock: "latest",
        });

        const proposalsCreated = proposalEvents.filter(
          (event: any) =>
            event.args.proposer?.toLowerCase() === walletAddress.toLowerCase()
        ).length;

        // Define Attester RequestApproved event
        const attesterRequestApprovedEvent = prepareEvent({
          signature:
            "event RequestApproved(uint256 indexed requestId, address indexed approver)",
        });

        // Fetch Attester RequestApproved events
        const attesterApprovalEvents = await getContractEvents({
          contract: attesterNFTContract,
          events: [attesterRequestApprovedEvent],
          fromBlock: -10000n,
          toBlock: "latest",
        });

        const attesterSignatures = attesterApprovalEvents.filter(
          (event: any) =>
            event.args.approver?.toLowerCase() === walletAddress.toLowerCase()
        ).length;

        // Define Citizen RequestApproved event
        const citizenRequestApprovedEvent = prepareEvent({
          // v2 (Gnosis): dropped isAttester/isCitizen booleans, kept signedAsAttester
          signature:
            "event RequestApproved(uint256 indexed requestId, address indexed approver, bool signedAsAttester)",
        });

        // Fetch Citizen RequestApproved events
        const citizenApprovalEvents = await getContractEvents({
          contract: citizenNFTContract,
          events: [citizenRequestApprovedEvent],
          fromBlock: -10000n,
          toBlock: "latest",
        });

        const citizenSignatures = citizenApprovalEvents.filter(
          (event: any) =>
            event.args.approver?.toLowerCase() === walletAddress.toLowerCase()
        ).length;

        setContributions({
          proposalsCreated,
          attesterSignatures,
          citizenSignatures,
          totalSignatures: attesterSignatures + citizenSignatures,
          memberSince: user.created_at,
        });
      } catch (error) {
        console.error("Error fetching DAO contributions:", error);
      } finally {
        setIsLoading(false);
      }
    };

    fetchContributions();
  }, [walletAddress, user.created_at]);

  const daysSince = getDaysSinceJoined(contributions.memberSince);
  const avgContributionsPerWeek =
    daysSince > 0
      ? ((contributions.totalSignatures + contributions.proposalsCreated) /
          daysSince) *
        7
      : 0;

  // Calculate engagement level
  const getEngagementLevel = () => {
    const totalActivity =
      contributions.proposalsCreated + contributions.totalSignatures;
    if (totalActivity === 0) return { label: "Neu", color: "text-muted-foreground", emoji: "🆕" };
    if (totalActivity < 5) return { label: "Aktiv", color: "text-primary", emoji: "👤" };
    if (totalActivity < 15) return { label: "Engagiert", color: "text-green-600", emoji: "⭐" };
    if (totalActivity < 30) return { label: "Sehr Aktiv", color: "text-purple-600", emoji: "🔥" };
    return { label: "Champion", color: "text-yellow-700", emoji: "🏆" };
  };

  const engagementLevel = getEngagementLevel();

  if (isLoading) {
    return (
      <div className="bg-card border border-border rounded-xl shadow-sm p-6 animate-pulse">
        <div className="h-6 bg-muted rounded w-1/3 mb-4" />
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="h-24 bg-muted rounded" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="bg-gradient-to-br from-purple-50 to-blue-50 border border-purple-200 rounded-xl shadow-sm p-6">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-xl font-medium text-foreground">
          🎯 DAO Beiträge
        </h3>
        <div className="flex items-center gap-2">
          <span className="text-2xl">{engagementLevel.emoji}</span>
          <span className={`text-sm font-medium ${engagementLevel.color}`}>
            {engagementLevel.label}
          </span>
        </div>
      </div>

      {/* Contributions Grid */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
        <div className="p-3 bg-card border border-border rounded-lg text-center">
          <p className="text-2xl font-medium text-blue-800">
            {contributions.proposalsCreated}
          </p>
          <p className="text-xs text-muted-foreground mt-1">Vorschläge erstellt</p>
        </div>

        <div className="p-3 bg-card border border-border rounded-lg text-center">
          <p className="text-2xl font-medium text-green-800">
            {contributions.attesterSignatures}
          </p>
          <p className="text-xs text-muted-foreground mt-1">Als Bescheiniger</p>
        </div>

        <div className="p-3 bg-card border border-border rounded-lg text-center">
          <p className="text-2xl font-medium text-purple-800">
            {contributions.citizenSignatures}
          </p>
          <p className="text-xs text-muted-foreground mt-1">Als Bürger</p>
        </div>

        <div className="p-3 bg-card border border-border rounded-lg text-center">
          <p className="text-2xl font-medium text-orange-800">
            {contributions.totalSignatures}
          </p>
          <p className="text-xs text-muted-foreground mt-1">Gesamt Unterschriften</p>
        </div>
      </div>

      {/* Stats Bar */}
      <div className="grid md:grid-cols-2 gap-3">
        <div className="p-3 bg-card border border-border rounded-lg">
          <p className="text-xs text-muted-foreground mb-1">Mitglied seit</p>
          <p className="text-sm font-medium text-foreground">
            {new Date(contributions.memberSince).toLocaleDateString("de-DE")}
            <span className="text-muted-foreground ml-2">({daysSince} Tage)</span>
          </p>
        </div>

        <div className="p-3 bg-card border border-border rounded-lg">
          <p className="text-xs text-muted-foreground mb-1">Durchschnitt pro Woche</p>
          <p className="text-sm font-medium text-foreground">
            {avgContributionsPerWeek.toFixed(1)} Beiträge
          </p>
        </div>
      </div>

      {/* Encouragement Message */}
      {contributions.totalSignatures + contributions.proposalsCreated === 0 && (
        <div className="mt-4 p-3 bg-blue-50 rounded-lg border border-blue-200">
          <p className="text-sm text-blue-800">
            💡 <strong>Tipp:</strong> Beginne mit dem Unterzeichnen von
            Verifizierungsanträgen oder erstelle deinen ersten Vorschlag, um
            zur DAO beizutragen!
          </p>
        </div>
      )}
    </div>
  );
}
