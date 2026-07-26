"use client";

import { governorContract } from "@/lib/verification-contracts";
import { useEffect, useState } from "react";
import Link from "next/link";
import { formatPoints, getStreakEmoji } from "@/lib/user-types";

interface VotingActivity {
  proposalId: string;
  support: number;
  weight: string;
  blockNumber: number;
  timestamp?: number;
}

interface VotingActivityCardProps {
  user: {
    total_votes_cast: bigint;
    voting_streak: bigint;
    last_vote_date: string | null;
    gamification_points: bigint;
  };
  /**
   * Connected wallet address, passed down from the page (sourced via
   * useUserProfile). We deliberately do NOT call useActiveAccount() here:
   * this card is bundled into the citizen-dashboard page chunk, which resolves
   * a duplicate thirdweb/react instance whose ThirdwebProvider context is null,
   * so calling the hook here throws "must be used within <ThirdwebProvider>".
   */
  walletAddress?: string;
}

export function VotingActivityCard({ user, walletAddress }: VotingActivityCardProps) {
  const [recentVotes, setRecentVotes] = useState<VotingActivity[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    if (!walletAddress) {
      setIsLoading(false);
      return;
    }

    const fetchRecentVotes = async () => {
      try {
        const { getContractEvents, prepareEvent } = await import("thirdweb");

        // Define VoteCast event
        const voteCastEvent = prepareEvent({
          signature:
            "event VoteCast(address indexed voter, uint256 proposalId, uint8 support, uint256 weight, string reason)",
        });

        // Fetch last 5 VoteCast events from this user
        const events = await getContractEvents({
          contract: governorContract,
          events: [voteCastEvent],
          fromBlock: -5000n, // Last ~5000 blocks
          toBlock: "latest",
        });

        // Filter for user's votes
        const userVotes = events
          .filter(
            (event: any) =>
              event.args.voter?.toLowerCase() === walletAddress.toLowerCase()
          )
          .map((event: any) => ({
            proposalId: event.args.proposalId?.toString() || "0",
            support: event.args.support || 0,
            weight: event.args.weight?.toString() || "0",
            blockNumber: Number(event.blockNumber),
          }))
          .slice(0, 5); // Only keep last 5

        setRecentVotes(userVotes);
      } catch (error) {
        console.error("Error fetching voting activity:", error);
      } finally {
        setIsLoading(false);
      }
    };

    fetchRecentVotes();
  }, [walletAddress]);

  const getSupportLabel = (support: number) => {
    switch (support) {
      case 0:
        return { label: "Dagegen", color: "text-red-600", emoji: "👎" };
      case 1:
        return { label: "Dafür", color: "text-green-600", emoji: "👍" };
      case 2:
        return { label: "Enthaltung", color: "text-muted-foreground", emoji: "🤷" };
      default:
        return { label: "Unbekannt", color: "text-muted-foreground", emoji: "❓" };
    }
  };

  return (
    <div className="bg-card border border-border rounded-xl shadow-sm p-6">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-xl font-medium text-foreground">🗳️ Abstimmungsaktivität</h3>
        <Link
          href="/proposals"
          className="text-sm text-primary hover:text-primary/80 transition-colors"
        >
          Zu Vorschlägen →
        </Link>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
        <div className="p-3 bg-blue-50 border border-blue-200 rounded-lg text-center">
          <p className="text-2xl font-medium text-blue-800">
            {Number(user.total_votes_cast)}
          </p>
          <p className="text-xs text-muted-foreground mt-1">Stimmen abgegeben</p>
        </div>

        <div className="p-3 bg-orange-50 border border-orange-200 rounded-lg text-center">
          <p className="text-2xl font-medium text-orange-800">
            {getStreakEmoji(Number(user.voting_streak))}{" "}
            {Number(user.voting_streak)}
          </p>
          <p className="text-xs text-muted-foreground mt-1">Tage Serie</p>
        </div>

        <div className="p-3 bg-purple-50 border border-purple-200 rounded-lg text-center">
          <p className="text-2xl font-medium text-purple-800">
            {formatPoints(user.gamification_points)}
          </p>
          <p className="text-xs text-muted-foreground mt-1">Punkte</p>
        </div>

        <div className="p-3 bg-green-50 border border-green-200 rounded-lg text-center">
          <p className="text-2xl font-medium text-green-800">
            {user.last_vote_date ? "✅" : "❌"}
          </p>
          <p className="text-xs text-muted-foreground mt-1">
            {user.last_vote_date ? "Aktiv" : "Inaktiv"}
          </p>
        </div>
      </div>

      {/* Recent Votes */}
      <div>
        <h4 className="text-sm font-medium text-muted-foreground mb-3">
          Letzte Abstimmungen
        </h4>

        {isLoading ? (
          <div className="space-y-2">
            {[...Array(3)].map((_, i) => (
              <div
                key={i}
                className="h-16 bg-muted rounded-lg animate-pulse"
              />
            ))}
          </div>
        ) : recentVotes.length === 0 ? (
          <div className="text-center py-6 bg-muted border border-border rounded-lg">
            <p className="text-muted-foreground text-sm mb-3">
              Du hast noch keine Stimmen abgegeben.
            </p>
            <Link
              href="/proposals"
              className="inline-block bg-black hover:bg-foreground/90 text-white px-4 py-2 rounded-lg text-sm transition-colors"
            >
              Zu den Vorschlägen
            </Link>
          </div>
        ) : (
          <div className="space-y-2">
            {recentVotes.map((vote, index) => {
              const supportInfo = getSupportLabel(vote.support);
              return (
                <Link
                  key={index}
                  href={`/proposals/${vote.proposalId}`}
                  className="block p-3 bg-muted hover:bg-accent border border-border hover:border-black rounded-lg transition-all"
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <span className="text-xl">{supportInfo.emoji}</span>
                      <div>
                        <p className="text-sm font-medium text-foreground">
                          Vorschlag #{vote.proposalId.slice(0, 8)}...
                        </p>
                        <p className={`text-xs ${supportInfo.color}`}>
                          {supportInfo.label}
                          {vote.weight !== "0" && (
                            <span className="text-muted-foreground ml-2">
                              • Gewicht: {vote.weight}
                            </span>
                          )}
                        </p>
                      </div>
                    </div>
                    <span className="text-xs text-muted-foreground">
                      Block #{vote.blockNumber}
                    </span>
                  </div>
                </Link>
              );
            })}
          </div>
        )}
      </div>

      {/* Last Vote Info */}
      {user.last_vote_date && (
        <div className="mt-4 p-3 bg-muted border border-border rounded-lg">
          <p className="text-xs text-muted-foreground">
            Letzte Abstimmung:{" "}
            <span className="text-foreground">
              {new Date(user.last_vote_date).toLocaleDateString("de-DE", {
                year: "numeric",
                month: "long",
                day: "numeric",
              })}
            </span>
          </p>
        </div>
      )}
    </div>
  );
}
