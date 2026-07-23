"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { sdk } from "@netizen-labs/miniapp-sdk";
import type { MiniAppContext, MuenzenBalance } from "@netizen-labs/miniapp-sdk";
import { getAddress, isAddress, type Address } from "viem";
import { initAnalytics, setAnalyticsWallet, track, startHeartbeat } from "./lib/analytics";
import { getMuenzenBalance } from "./lib/rewards";
import { Coins, BallotBox, Home, ChevronLeft } from "./components/icons";
import InviteView from "./views/InviteView";
import TownView from "./views/TownView";
import GovernanceView from "./views/GovernanceView";
import EventInviteView from "./views/EventInviteView";
import DocumentaryView from "./views/DocumentaryView";
import PulseView from "./views/PulseView";
import { resolveGovernanceDeepLink } from "./lib/municipalTopicBinding";

// Brand mark ships in /public — Next serves it at an absolute URL path.
const logoData = "/assets/Logo-data.png";

type Tab = "town" | "economy" | "governance";
// Invite + Event + Documentary are not top-level tabs — they live inside the Town
// tab as openable pages (see TownView's "Citizen tools" cards + the Documentary card).
type SubPage = "invite" | "event" | "documentary";
const TABS: { id: Tab; label: string; icon: typeof Coins }[] = [
  { id: "town", label: "Gemeinde", icon: Home },
  { id: "economy", label: "Wirtschaft", icon: Coins },
  { id: "governance", label: "Mitbestimmung", icon: BallotBox },
];

type UrlDeepLinks = {
  inviter: Address | null;
  ref: Address | null;
  governanceTarget: ReturnType<typeof resolveGovernanceDeepLink>;
};

const EMPTY_GOVERNANCE_TARGET = resolveGovernanceDeepLink({
  proposalId: null,
  stadtstackTopic: null,
});

function readUrlDeepLinks(): UrlDeepLinks {
  try {
    const search = new URLSearchParams(window.location.search);
    const inviter = search.get("inviter");
    const ref = search.get("ref");
    return {
      inviter: inviter && isAddress(inviter) ? getAddress(inviter) : null,
      ref: ref && isAddress(ref) ? getAddress(ref) : null,
      governanceTarget: resolveGovernanceDeepLink({
        proposalId: search.get("proposal"),
        stadtstackTopic: search.get("stadtstackTopic"),
      }),
    };
  } catch {
    return {
      inviter: null,
      ref: null,
      governanceTarget: EMPTY_GOVERNANCE_TARGET,
    };
  }
}

export default function App() {
  // Keep the server render and first browser render identical. Deep links are
  // applied after hydration; reading window at module/render time causes the
  // server to render "Gemeinde" while the browser renders "Mitbestimmung".
  const [governanceTarget, setGovernanceTarget] = useState(
    EMPTY_GOVERNANCE_TARGET,
  );
  const [tab, setTab] = useState<Tab>("town");
  const [subPage, setSubPage] = useState<SubPage | null>(null);
  const [inviter, setInviter] = useState<Address | null>(null);
  const [connected, setConnected] = useState<Address | null>(null);
  const [muenzen, setMuenzen] = useState<MuenzenBalance | null>(null);
  const [ctx, setCtx] = useState<MiniAppContext | null>(null);
  const connectedOnce = useRef(false);
  const refLanded = useRef(false);
  const deepLinks = useRef<UrlDeepLinks>({
    inviter: null,
    ref: null,
    governanceTarget: EMPTY_GOVERNANCE_TARGET,
  });

  // ── Mount: dismiss host splash (MANDATORY) + context + analytics ────────────
  useEffect(() => {
    const links = readUrlDeepLinks();
    deepLinks.current = links;
    setGovernanceTarget(links.governanceTarget);
    if (
      links.governanceTarget.proposalId ||
      links.governanceTarget.civicTopicBinding
    ) {
      setTab("governance");
    } else if (links.inviter) {
      setSubPage("event");
    }
    setInviter(links.inviter);

    // #1 rule: without ready() the host shows an infinite splash.
    void sdk.actions.ready();

    // Untrusted context — display only (greet by name, read safe-area insets).
    void sdk.getContext().then(setCtx).catch(() => {});

    initAnalytics({ ref: links.ref });
    track("app_open", {
      tab:
        links.governanceTarget.proposalId ||
        links.governanceTarget.civicTopicBinding
          ? "governance"
          : "town",
      subPage: links.inviter ? "event" : null,
      hasInviter: !!links.inviter,
      hasRef: !!links.ref,
      hasProposal: !!links.governanceTarget.proposalId,
      hasStadtstackTopic: !!links.governanceTarget.civicTopicBinding,
    });
    return startHeartbeat(25);
  }, []);

  // ── Wallet: host injects the connected account (used by Invite/Event + analytics).
  useEffect(() => {
    const onAddress = (addr: string | null) => {
      const a = addr && isAddress(addr) ? getAddress(addr) : null;
      setConnected(a);
      setInviter(a ?? deepLinks.current.inviter);
      setAnalyticsWallet(a);
      if (a) {
        // Refresh the Röbel-Münzen balance for the newly connected user.
        void getMuenzenBalance().then(setMuenzen).catch(() => setMuenzen(null));
      } else {
        setMuenzen(null);
      }
      if (a && !connectedOnce.current) {
        connectedOnce.current = true;
        track("wallet_connect", {});
        // Referral attribution: a new wallet connected inside the app via someone's link.
        const referral = deepLinks.current.ref;
        if (
          referral &&
          !refLanded.current &&
          referral.toLowerCase() !== a.toLowerCase()
        ) {
          refLanded.current = true;
          track("referral_landed", { ref: referral.toLowerCase() });
        }
      }
    };

    // Seed with the current account, then subscribe to host wallet changes.
    void sdk.wallet
      .getAccount()
      .then((acct) => onAddress(acct?.address ?? null))
      .catch(() => {});
    const unsubscribe = sdk.on("walletChanged", (data) => {
      const address = (data as { address?: string } | null)?.address ?? null;
      onAddress(address);
    });
    return unsubscribe;
  }, []);

  const selectTab = (id: Tab) => {
    setTab(id);
    setSubPage(null);
    track("tab_view", { tab: id });
  };

  const openSub = (p: SubPage) => {
    setSubPage(p);
    track("tab_view", { tab: p });
  };
  const closeSub = () => setSubPage(null);
  const openReviewedMunicipalCase = useCallback((url: string) => {
    // The federation client already confined this URL to the configured
    // Stadtstack origin and exact public-case path. The shell owns navigation.
    void sdk.actions.openUrl(url).catch(() => {});
  }, []);

  return (
    <div className="mx-auto flex min-h-full w-full max-w-xl flex-col">
      {/* Sticky brand + tab bar */}
      <header className="sticky top-0 z-20 border-b border-border/70 bg-background/85 px-4 pb-2.5 pt-3 backdrop-blur-md">
        <div className="mb-2.5 flex items-center gap-2.5">
          <img src={logoData} alt="Röbel Data" className="h-7 w-auto" />
          {connected && (
            // Never a raw wallet address (DESIGN.md §5) — show the live
            // Röbel-Münzen balance instead, resolved from the connected account.
            <span className="ml-auto inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-2.5 py-1 text-[11px] font-medium text-foreground">
              <span className="h-1.5 w-1.5 rounded-full bg-[#00498B]" />
              <span className="tnum">{muenzen ? formatMuenzen(muenzen.balance) : "…"}</span>
              <span className="text-muted-foreground">RÖ</span>
            </span>
          )}
        </div>

        <nav className="no-scrollbar -mx-1 flex gap-1 overflow-x-auto rounded-[10px] bg-muted p-1">
          {TABS.map((t) => {
            const Icon = t.icon;
            const active = tab === t.id;
            return (
              <button
                key={t.id}
                onClick={() => selectTab(t.id)}
                className={`flex flex-1 min-w-[60px] flex-col items-center gap-1 rounded-[8px] py-1.5 text-[11px] font-medium transition ${
                  active ? "bg-card text-[#00498B] shadow-sm" : "text-muted-foreground hover:text-foreground"
                }`}
              >
                <Icon className="h-[18px] w-[18px]" />
                {t.label}
              </button>
            );
          })}
        </nav>
      </header>

      <main className="flex-1 px-4 pb-12 pt-4">
        <div key={`${tab}:${subPage ?? ""}`} className="rc-rise">
          {tab === "town" &&
            (subPage === "invite" ? (
              <SubPage onBack={closeSub}>
                <InviteView inviter={inviter} />
              </SubPage>
            ) : subPage === "event" ? (
              <SubPage onBack={closeSub}>
                <EventInviteView inviter={inviter} />
              </SubPage>
            ) : subPage === "documentary" ? (
              // Documentary owns its own header/back (nested list ↔ detail nav),
              // so it is rendered outside the generic SubPage chrome.
              <DocumentaryView onBack={closeSub} />
            ) : (
              <TownView
                connected={connected}
                onOpenInvite={() => openSub("invite")}
                onOpenEvent={() => openSub("event")}
                onOpenDocumentary={() => openSub("documentary")}
              />
            ))}
          {tab === "economy" && <PulseView connected={connected} />}
          {tab === "governance" && (
            <GovernanceView
              initialProposalId={governanceTarget.proposalId}
              initialCivicTopicBinding={
                governanceTarget.civicTopicBinding
              }
              onOpenMunicipalCase={openReviewedMunicipalCase}
            />
          )}
        </div>

        <footer className="mt-8 flex items-center justify-between border-t border-border/70 pt-4 text-[11px] text-muted-foreground">
          <span>Röbel / Müritz{ctx?.host?.name ? ` · ${ctx.host.name}` : ""}</span>
          <span className="font-medium text-[#00498B]">Gemeinschaftswährung</span>
        </footer>
      </main>
    </div>
  );
}

/** Balance arrives as a human-unit decimal string; show a compact figure. */
function formatMuenzen(raw: string): string {
  const n = Number(raw);
  if (!Number.isFinite(n)) return raw;
  return n.toLocaleString("de-DE", { maximumFractionDigits: 0 });
}

// Wraps a page opened from within the Town tab (Invite / Event) with a back affordance.
function SubPage({ onBack, children }: { onBack: () => void; children: ReactNode }) {
  return (
    <div className="space-y-4">
      <button
        onClick={onBack}
        className="-ml-1.5 inline-flex items-center gap-1 rounded-[10px] px-1.5 py-1 text-[13px] font-medium text-muted-foreground transition hover:text-foreground active:scale-[0.98]"
      >
        <ChevronLeft className="h-4 w-4" />
        Gemeinde
      </button>
      {children}
    </div>
  );
}
