"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowRight, FolderOpen, ShieldCheck } from "lucide-react";
import { useUserProfile } from "@/hooks/useUserProfile";
import { useVerificationStatus } from "@/hooks/useVerificationStatus";
import { FileBrowser } from "@/components/workspace/FileBrowser";

function Header() {
  return (
    <div>
      <h1 className="text-2xl font-semibold text-foreground flex items-center gap-2">
        <FolderOpen className="h-5 w-5 text-primary" />
        Dateien & Dokumente
      </h1>
      <p className="text-sm text-muted-foreground mt-1">
        Deine Dateien liegen auf dem Server der Gemeinschaft. Dokumente öffnest
        und bearbeitest du direkt hier.
      </p>
    </div>
  );
}

function ListSkeleton() {
  return (
    <div className="border border-border rounded-xl divide-y divide-border overflow-hidden">
      {Array.from({ length: 4 }).map((_, i) => (
        <div key={i} className="h-12 animate-pulse bg-muted/40" />
      ))}
    </div>
  );
}

/**
 * Client-mount gate, matching the sibling Übersicht page: the citizen
 * derivation below reads wallet + on-chain state through thirdweb hooks, and
 * calling those during SSR or the first hydration pass can resolve a
 * thirdweb/react instance whose ThirdwebProvider context is null. SSR and the
 * first paint render a plain skeleton instead.
 */
export default function DateienPage() {
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    setMounted(true);
  }, []);

  return (
    <div className="space-y-6">
      <Header />
      {mounted ? <DateienContent /> : <ListSkeleton />}
    </div>
  );
}

function DateienContent() {
  const { user, isLoading } = useUserProfile();
  const { isCitizen: isCitizenChain, isLoading: verifyLoading } =
    useVerificationStatus();

  // Advisory flag ∪ chain truth — identical to the Übersicht page's derivation
  // and to WorkspaceSidebar's, so the three cannot disagree about who is a
  // citizen. This is the SAME gate the dashboard this surface replaced had; it
  // was lost when the page was rebuilt around FileBrowser, which meant the
  // person reading "Nur für verifizierte Bürger" on the Übersicht could still
  // open real storage one click away. Enforcement lives server-side (the
  // `citizen` group claim, checked in `resolveScope`); this card is what turns
  // that 403 into an explanation instead of a shrug.
  const isCitizen =
    isCitizenChain ||
    user?.tier === "citizen" ||
    Boolean(user?.is_verified_citizen);

  if (isLoading || verifyLoading) return <ListSkeleton />;
  if (isCitizen) return <FileBrowser scope={{ scope: "personal" }} />;

  return (
    <div className="bg-card border border-border rounded-xl p-8 text-center">
      <ShieldCheck className="h-10 w-10 text-primary mx-auto mb-4" />
      <h2 className="text-lg font-semibold text-foreground mb-3">
        Nur für verifizierte Bürger
      </h2>
      <p className="text-sm text-muted-foreground mb-6">
        Der persönliche Dateibereich steht verifizierten Bürgern von
        Röbel/Müritz offen. Verifiziere dich, um deine Dokumente hier abzulegen
        und zu bearbeiten.
      </p>
      <Link
        href="/app/verifizierung"
        className="inline-flex items-center gap-1.5 bg-primary hover:bg-primary/90 text-primary-foreground px-5 py-2 rounded-md font-medium text-sm transition-colors"
      >
        Bürger werden <ArrowRight className="h-4 w-4" />
      </Link>
    </div>
  );
}
