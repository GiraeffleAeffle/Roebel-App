"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import Image from "next/image";
import { Calendar, ShieldCheck, Tag, ArrowRight, Landmark, Vote, TrendingUp, LayoutDashboard } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { useAppMode } from "@/lib/context/AppModeContext";
import { useAccount } from "@/lib/context/AccountContext";
import { useUserProfile } from "@/hooks/useUserProfile";
import { isOrgAccount } from "@/types/account";

interface FeaturedAd {
  id: string;
  title: string;
  dealValue: string | null;
  businessName: string;
  businessLogoUrl: string | null;
  isBoosted: boolean;
}

interface ActiveProposal {
  id: string;
  title: string;
  status: string;
  created_at: string;
}

export function AppRightPanel() {
  const { activeMode } = useAppMode();
  const { activeAccount } = useAccount();
  const { user } = useUserProfile();

  const tier = user?.tier || "tourist";
  const isCitizen = tier === "citizen" || user?.is_verified_citizen;
  const isTouristOrGuest = tier === "tourist" || tier === "guest" || !isCitizen;
  const isCitizenPersonal = isCitizen && activeAccount?.account_type === "personal";
  const isOrg = activeAccount ? isOrgAccount(activeAccount) : false;

  const [featuredAd, setFeaturedAd] = useState<FeaturedAd | null>(null);
  const [activeProposals, setActiveProposals] = useState<ActiveProposal[]>([]);

  useEffect(() => {
    async function fetchFeaturedAd() {
      const supabase = createClient();
      const today = new Date().toISOString().split("T")[0];
      const { data } = await supabase
        .from("business_deals")
        .select(
          `*, businesses!inner (name, slug, logo_url, status)`
        )
        .eq("is_active", true)
        .neq("businesses.status", "rejected")
        .or(`end_date.is.null,end_date.gte.${today}`)
        .order("is_boosted", { ascending: false })
        .order("created_at", { ascending: false })
        .limit(1);

      if (data && data.length > 0) {
        const row = data[0];
        const biz = row.businesses as Record<string, unknown>;
        setFeaturedAd({
          id: String(row.id),
          title: String(row.title || ""),
          dealValue: row.deal_value ? String(row.deal_value) : null,
          businessName: biz.name ? String(biz.name) : "Lokales Gewerbe",
          businessLogoUrl: biz.logo_url ? String(biz.logo_url) : null,
          isBoosted: (row.is_boosted as boolean) || false,
        });
      }
    }
    fetchFeaturedAd();
  }, []);

  // Fetch active proposals for citizen/org mode
  useEffect(() => {
    if (isTouristOrGuest) return;
    async function fetchProposals() {
      const supabase = createClient();
      const { data } = await supabase
        .from("proposals")
        .select("id, title, status, created_at")
        .in("status", ["active", "pending"])
        .order("created_at", { ascending: false })
        .limit(3);
      if (data) setActiveProposals(data);
    }
    fetchProposals();
  }, [isTouristOrGuest]);

  return (
    <div className="space-y-4 sticky top-24">
      {/* Tourist/guest: Event discovery CTA */}
      {isTouristOrGuest && (
        <div className="bg-card rounded-lg border border-border overflow-hidden">
          <div className="bg-gradient-to-br from-primary to-blue-800 p-6 text-white">
            <h3 className="font-semibold text-lg leading-tight">
              Röbel entdecken
            </h3>
            <p className="text-sm text-blue-100 mt-2">
              Veranstaltungen, Restaurants und Sehenswürdigkeiten
            </p>
          </div>
          <div className="p-4 space-y-2">
            <Link
              href="/app/events"
              className="flex items-center justify-center gap-2 w-full py-2 bg-primary hover:bg-primary/90 text-primary-foreground rounded-lg text-sm font-medium transition-colors"
            >
              <Calendar className="h-4 w-4" />
              Veranstaltungen
            </Link>
            <Link
              href="/app/karte"
              className="flex items-center justify-center gap-2 w-full py-2 bg-muted hover:bg-accent text-foreground rounded-lg text-sm font-medium transition-colors"
            >
              Karte öffnen
            </Link>
          </div>
        </div>
      )}

      {/* Citizen personal: Governance widget */}
      {isCitizenPersonal && (
        <div className="bg-card rounded-lg border border-border overflow-hidden">
          <div className="flex items-center gap-2 px-4 pt-4 pb-2">
            <Vote className="h-5 w-5 text-primary" />
            <h3 className="font-semibold text-sm text-foreground">Aktive Abstimmungen</h3>
          </div>
          <div className="px-4 pb-4">
            {activeProposals.length > 0 ? (
              <div className="space-y-2">
                {activeProposals.map((p) => (
                  <Link
                    key={p.id}
                    href={`/app/proposals/${p.id}`}
                    className="block p-2 rounded-md hover:bg-accent transition-colors"
                  >
                    <p className="text-sm font-medium text-foreground line-clamp-1">{p.title}</p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {new Date(p.created_at).toLocaleDateString("de-DE", { day: "numeric", month: "short" })}
                    </p>
                  </Link>
                ))}
                <Link
                  href="/app/proposals"
                  className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:text-primary/80"
                >
                  Alle Vorschläge <ArrowRight className="h-3 w-3" />
                </Link>
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">Keine aktiven Abstimmungen.</p>
            )}
          </div>
        </div>
      )}

      {/* Citizen personal: event creation CTA */}
      {isCitizenPersonal && (
        <div className="bg-card rounded-lg border border-border overflow-hidden">
          <div className="bg-gradient-to-br from-primary to-blue-800 p-6 text-white">
            <h3 className="font-semibold text-lg leading-tight">
              Veranstaltung planen oder entdecken
            </h3>
            <p className="text-sm text-blue-100 mt-2">
              Erstelle eine Veranstaltung oder entdecke was in Röbel passiert
            </p>
          </div>
          <div className="p-4">
            <Link
              href="/app/submit"
              className="flex items-center justify-center gap-2 w-full py-2 bg-primary hover:bg-primary/90 text-primary-foreground rounded-lg text-sm font-medium transition-colors"
            >
              <Calendar className="h-4 w-4" />
              Veranstaltung erstellen
            </Link>
          </div>
        </div>
      )}

      {/* Citizen personal: Bürger-Dashboard CTA */}
      {isCitizenPersonal && (
        <div className="bg-card rounded-lg border border-border p-4">
          <div className="flex items-center gap-2 mb-3">
            <LayoutDashboard className="h-5 w-5 text-primary" />
            <h3 className="font-semibold text-sm text-foreground">Bürger-Dashboard</h3>
          </div>
          <p className="text-xs text-muted-foreground mb-3">
            Deine Identität, Mitgliedschaften und Arbeitsbereich an einem Ort.
          </p>
          <Link
            href="/app/dashboard"
            className="flex items-center justify-center gap-2 w-full py-2 bg-primary hover:bg-primary/90 text-primary-foreground rounded-lg text-sm font-medium transition-colors"
          >
            Dashboard öffnen
          </Link>
        </div>
      )}

      {/* Org account: Business stats teaser */}
      {isOrg && (
        <div className="bg-card rounded-lg border border-border p-4">
          <div className="flex items-center gap-2 mb-3">
            <TrendingUp className="h-5 w-5 text-primary" />
            <h3 className="font-semibold text-sm text-foreground">Gewerbe-Dashboard</h3>
          </div>
          <p className="text-xs text-muted-foreground mb-3">
            Verwalte dein Gewerbe, Angebote und Reichweite.
          </p>
          <Link
            href="/dashboard"
            className="flex items-center justify-center gap-2 w-full py-2 bg-primary hover:bg-primary/90 text-primary-foreground rounded-lg text-sm font-medium transition-colors"
          >
            Dashboard öffnen
          </Link>
        </div>
      )}

      {/* Featured ad — all modes */}
      {featuredAd && (
        <div
          className={`bg-card rounded-lg border overflow-hidden ${
            featuredAd.isBoosted
              ? "border-yellow-300 dark:border-yellow-700"
              : "border-border"
          }`}
        >
          <div className="p-4">
            <div className="flex items-center gap-2 mb-3">
              <div className="h-8 w-8 rounded-full bg-muted overflow-hidden flex items-center justify-center flex-shrink-0">
                {featuredAd.businessLogoUrl ? (
                  <Image
                    src={featuredAd.businessLogoUrl}
                    alt={featuredAd.businessName}
                    width={32}
                    height={32}
                    className="object-cover w-full h-full"
                  />
                ) : (
                  <Tag className="h-4 w-4 text-muted-foreground" />
                )}
              </div>
              <div className="min-w-0">
                <p className="text-sm font-medium text-foreground truncate">
                  {featuredAd.businessName}
                </p>
                <p className="text-xs text-muted-foreground">Anzeige</p>
              </div>
            </div>
            <h3 className="font-semibold text-sm text-foreground mb-1">
              {featuredAd.title}
            </h3>
            {featuredAd.dealValue && (
              <p className="text-sm font-semibold text-green-600 dark:text-green-400 mb-2">
                {featuredAd.dealValue}
              </p>
            )}
            <Link
              href={`/app/angebote/${featuredAd.id}`}
              className="inline-flex items-center gap-1 text-sm font-medium text-primary hover:text-primary/80 transition-colors"
            >
              Angebot ansehen
              <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          </div>
        </div>
      )}

      {/* Verification CTA — tourist/guest only */}
      {isTouristOrGuest && (
        <div className="bg-card rounded-lg border border-border p-4">
          <div className="flex items-start gap-3">
            <ShieldCheck className="h-6 w-6 text-green-600 flex-shrink-0 mt-0.5" />
            <div>
              <h3 className="font-semibold text-sm text-foreground">Verifizierter Bürger werden</h3>
              <p className="text-xs text-muted-foreground mt-1">
                Verifiziere dich als Bürger von Röbel/Müritz und erhalte Stimmrecht in der DAO.
              </p>
              <Link
                href="/app/verifizierung"
                className="text-xs text-primary font-medium mt-2 inline-block hover:underline"
              >
                Mehr erfahren
              </Link>
            </div>
          </div>
        </div>
      )}

      {/* Quick links — all modes */}
      <div className="bg-card rounded-lg border border-border p-4">
        <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
          <Link href="/about" className="hover:text-foreground hover:underline">
            Über uns
          </Link>
          <Link href="/datenschutz" className="hover:text-foreground hover:underline">
            Datenschutz
          </Link>
          <Link href="/impressum" className="hover:text-foreground hover:underline">
            Impressum
          </Link>
        </div>
      </div>
    </div>
  );
}
