"use client";

export const dynamic = "force-dynamic";

import Link from "next/link";
import { Bot, ShieldCheck, ArrowRight } from "lucide-react";
import { useUserProfile } from "@/hooks/useUserProfile";
import { useVerificationStatus } from "@/hooks/useVerificationStatus";
import { useAccount } from "@/lib/context/AccountContext";
import { useAppMode } from "@/lib/context/AppModeContext";
import { dashboardFeatures } from "@/lib/dashboard/features";
import { IdentityCard } from "@/components/profile/IdentityCard";
import { VerificationStatusCard } from "@/components/profile/VerificationStatusCard";
import { VotingActivityCard } from "@/components/profile/VotingActivityCard";
import { DAOContributionsCard } from "@/components/profile/DAOContributionsCard";
import { MembershipsCard } from "@/components/dashboard/MembershipsCard";
import { WorkspaceTilesCard } from "@/components/dashboard/WorkspaceTilesCard";

export default function CitizenDashboardPage() {
  const { user, isLoading, isConnected } = useUserProfile();
  const {
    isAttester,
    isCitizen: isCitizenChain,
    votingPower,
    isLoading: verifyLoading,
  } = useVerificationStatus();
  const { activeAccount } = useAccount();
  const { activeMode } = useAppMode();

  // Advisory flag ∪ chain truth — same derivation as AppSidebar/AppRightPanel.
  const isCitizen =
    isCitizenChain ||
    user?.tier === "citizen" ||
    Boolean(user?.is_verified_citizen);

  // Loading — wallet reconnect / profile / chain read still in flight.
  if (isLoading || verifyLoading) {
    return (
      <div className="max-w-2xl mx-auto animate-pulse space-y-4">
        <div className="h-7 bg-muted rounded w-1/3" />
        <div className="h-44 bg-card border border-border rounded-xl" />
        <div className="h-32 bg-card border border-border rounded-xl" />
        <div className="h-32 bg-card border border-border rounded-xl" />
      </div>
    );
  }

  // Not logged in — soft state (AuthGuard renders the shell for guests too).
  if (!isConnected || !user) {
    return (
      <div className="max-w-2xl mx-auto text-center">
        <div className="bg-card border border-border rounded-lg p-8">
          <h1 className="text-xl font-semibold text-foreground mb-3">
            Anmeldung erforderlich
          </h1>
          <p className="text-sm text-muted-foreground mb-6">
            Melde dich an, um dein Bürger-Dashboard zu sehen.
          </p>
          <Link
            href="/app"
            className="inline-block bg-primary hover:bg-primary/90 text-primary-foreground px-5 py-2 rounded-md font-medium text-sm transition-colors"
          >
            Zur Startseite
          </Link>
        </div>
      </div>
    );
  }

  // Logged in but not a citizen — graceful gate, NO redirect.
  if (!isCitizen) {
    return (
      <div className="max-w-2xl mx-auto text-center">
        <div className="bg-card border border-border rounded-lg p-8">
          <ShieldCheck className="h-10 w-10 text-primary mx-auto mb-4" />
          <h1 className="text-xl font-semibold text-foreground mb-3">
            Nur für verifizierte Bürger
          </h1>
          <p className="text-sm text-muted-foreground mb-6">
            Das Bürger-Dashboard steht verifizierten Bürgern von Röbel/Müritz
            offen. Verifiziere dich, um deine Identität, Mitgliedschaften und
            Arbeitsbereich-Apps an einem Ort zu verwalten.
          </p>
          <Link
            href="/app/verifizierung"
            className="inline-flex items-center gap-1.5 bg-primary hover:bg-primary/90 text-primary-foreground px-5 py-2 rounded-md font-medium text-sm transition-colors"
          >
            Bürger werden <ArrowRight className="h-4 w-4" />
          </Link>
        </div>
      </div>
    );
  }

  // We are past the citizen gate here, so the user IS a citizen — derive
  // features from "citizen" directly. Using a possibly-stale `user.tier`
  // (which can lag on-chain verification — the known is_verified_citizen
  // drift) would wrongly hide every section for a freshly-verified citizen.
  const features = dashboardFeatures("citizen");

  return (
    <div className="max-w-2xl mx-auto space-y-8">
      <header>
        <h1 className="text-2xl font-semibold text-foreground">Dashboard</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Willkommen zurück{user.username ? `, ${user.username}` : ""}.
        </p>
      </header>

      {/* Identität & Pass */}
      {features.identity && (
        <section className="space-y-4">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            Identität & Pass
          </h2>
          <IdentityCard
            user={user}
            activeMode={activeMode}
            activeAccount={activeAccount}
            isAttester={isAttester}
            votingPower={votingPower}
          />
          <VerificationStatusCard />
          {features.memberships && <MembershipsCard isCitizen={isCitizen} />}
        </section>
      )}

      {/* KI-Copilot */}
      {features.copilot && (
        <section className="space-y-4">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            KI-Copilot
          </h2>
          <Link
            href="/app/mecky"
            className="flex items-center gap-4 bg-card border border-border rounded-xl p-5 hover:bg-accent transition-colors"
          >
            <div className="h-12 w-12 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0">
              <Bot className="h-6 w-6 text-primary" />
            </div>
            <div className="min-w-0 flex-1">
              <h3 className="font-semibold text-foreground">Mecky fragen</h3>
              <p className="text-sm text-muted-foreground">
                Dein Bürgerassistent für Abstimmungen, Community-Themen und mehr.
              </p>
            </div>
            <ArrowRight className="h-5 w-5 text-muted-foreground flex-shrink-0" />
          </Link>
        </section>
      )}

      {/* Bürgerbeteiligung */}
      {features.civic && (
        <section className="space-y-4">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            Bürgerbeteiligung
          </h2>
          <div className="grid grid-cols-2 gap-3">
            <Link
              href="/app/proposals"
              className="bg-card border border-border rounded-xl p-4 hover:bg-accent transition-colors"
            >
              <p className="font-medium text-foreground text-sm">Abstimmungen</p>
              <p className="text-xs text-muted-foreground mt-0.5">Vorschläge & Voting</p>
            </Link>
            <Link
              href="/app/roebel-card"
              className="bg-card border border-border rounded-xl p-4 hover:bg-accent transition-colors"
            >
              <p className="font-medium text-foreground text-sm">Röbel Card</p>
              <p className="text-xs text-muted-foreground mt-0.5">Punkte & Münzen</p>
            </Link>
          </div>
          <VotingActivityCard user={user} />
          <DAOContributionsCard user={user} />
        </section>
      )}

      {/* Arbeitsbereich */}
      {features.workspace && (
        <section className="space-y-4">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            Arbeitsbereich
          </h2>
          <WorkspaceTilesCard />
        </section>
      )}
    </div>
  );
}
