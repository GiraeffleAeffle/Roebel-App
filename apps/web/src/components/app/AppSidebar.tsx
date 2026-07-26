"use client";

import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import { useState } from "react";
import {
  Home,
  Calendar,
  Newspaper,
  Store,
  Tag,
  ShoppingBag,
  User,
  Settings,
  HelpCircle,
  Info,
  Plus,
  MapPin,
  Landmark,
  Bot,
  ChevronDown,
  LayoutDashboard,
} from "lucide-react";
import { useAppMode, type AppMode } from "@/lib/context/AppModeContext";
import { useAccount } from "@/lib/context/AccountContext";
import { useUserProfile } from "@/hooks/useUserProfile";
import { isOrgAccount } from "@/types/account";
import { RoebelCardWidget } from "@/components/app/RoebelCardWidget";

// Org-specific routes (Dashboard, Angebote, Röbel-Card-Partner) live under
// /dashboard with their own layout. Entry point is the "Dashboard öffnen"
// CTA in AppRightPanel — no separate citizen-sidebar entries needed.

// --- Navigation item definition ---

interface NavItem {
  href: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  exact?: boolean;
  /** Which modes can see this item. undefined = all modes. */
  modes?: AppMode[];
  /** If set, item is visible but shows a restricted state (e.g. "browse only") */
  restrictedIn?: AppMode[];
  /** Nested child items, rendered indented under the parent when active. */
  children?: NavItem[];
}

const mainNavItems: NavItem[] = [
  { href: "/app", label: "Feed", icon: Home, exact: true },
  { href: "/app/dashboard", label: "Dashboard", icon: LayoutDashboard, modes: ["citizen"] },
  { href: "/app/proposals", label: "Stadt", icon: Landmark },
  { href: "/app/events", label: "Veranstaltungen", icon: Calendar },
  { href: "/app/karte", label: "Karte", icon: MapPin },
  { href: "/app/news", label: "Neuigkeiten", icon: Newspaper },
  { href: "/app/gewerbe", label: "Gewerbe", icon: Store },
  { href: "/app/angebote", label: "Angebote", icon: Tag },
  { href: "/app/marktplatz", label: "Marktplatz", icon: ShoppingBag },
  { href: "/app/mecky", label: "Mecky", icon: Bot },
  { href: "/app/profile", label: "Profil", icon: User },
];

const bottomNavItems: NavItem[] = [
  { href: "/app/einstellungen", label: "Einstellungen", icon: Settings },
  { href: "/app/support", label: "Hilfecenter", icon: HelpCircle },
  { href: "/about", label: "Über uns", icon: Info },
];

export function AppSidebar() {
  const pathname = usePathname();
  const { activeMode } = useAppMode();
  const { activeAccount } = useAccount();
  const { user } = useUserProfile();

  const isCitizen = user?.tier === "citizen" || user?.is_verified_citizen;
  const isOrg = activeAccount ? isOrgAccount(activeAccount) : false;

  const isActive = (href: string, exact?: boolean) => {
    if (exact) return pathname === href;
    return pathname === href || pathname?.startsWith(href + "/");
  };

  const isVisible = (item: NavItem) => {
    if (!item.modes) return true;
    if (item.modes.includes("citizen") && isCitizen) return true;
    if (item.modes.includes("org") && isOrg) return true;
    if (item.modes.includes("tourist") && activeMode === "tourist") return true;
    return false;
  };

  const visibleMainItems = mainNavItems.filter(isVisible);

  const hasActiveChild = (item: NavItem): boolean => {
    if (!item.children) return false;
    return item.children.some((c) => isActive(c.href, c.exact));
  };

  // Manual expansion overrides — keyed by parent href. Once a user clicks the
  // chevron we honour their choice; otherwise we expand automatically when a
  // child route is active.
  const [manualExpanded, setManualExpanded] = useState<Record<string, boolean>>({});

  const isExpanded = (item: NavItem) => {
    if (item.href in manualExpanded) return manualExpanded[item.href];
    return isActive(item.href, item.exact) || hasActiveChild(item);
  };

  const toggleExpanded = (href: string, currentlyExpanded: boolean) => {
    setManualExpanded((prev) => ({ ...prev, [href]: !currentlyExpanded }));
  };

  return (
    <div className="flex flex-col h-full bg-card">
      {/* Logo */}
      <div className="h-16 flex items-center px-5 flex-shrink-0 lg:justify-start justify-center">
        {/* Collapsed (icon-only) rail: square windmill */}
        <Image
          src="/logo.png"
          alt="Röbel App"
          width={28}
          height={28}
          className="object-contain lg:hidden"
        />
        {/* Expanded rail: full wordmark lockup */}
        <Image
          src="/Logo-new.png"
          alt="Röbel App"
          width={122}
          height={28}
          className="hidden h-7 w-auto object-contain lg:block"
        />
      </div>

      {/* Main navigation */}
      <nav className="flex-1 overflow-y-auto py-4 px-2 lg:px-3">
        <div className="space-y-1">
          {visibleMainItems.map((item) => {
            const Icon = item.icon;
            const selfActive = isActive(item.href, item.exact);
            const childActive = hasActiveChild(item);
            const active = selfActive || childActive;
            const expanded = isExpanded(item);
            const hasChildren = !!item.children?.length;

            return (
              <div key={item.href}>
                <div className="relative flex items-stretch">
                  <Link
                    href={item.href}
                    className={`relative flex flex-1 items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors justify-center lg:justify-start ${
                      active
                        ? "bg-muted text-foreground"
                        : "text-muted-foreground hover:bg-accent hover:text-accent-foreground"
                    }`}
                    title={item.label}
                  >
                    <Icon className={`h-5 w-5 flex-shrink-0 ${active ? "text-foreground" : "text-muted-foreground"}`} />
                    <span className="flex-1 hidden lg:block">{item.label}</span>
                  </Link>
                  {hasChildren && (
                    <button
                      type="button"
                      onClick={() => toggleExpanded(item.href, expanded)}
                      className="hidden lg:flex items-center justify-center w-8 ml-0.5 rounded-lg text-muted-foreground hover:bg-accent hover:text-accent-foreground transition-colors"
                      aria-label={expanded ? `${item.label} einklappen` : `${item.label} ausklappen`}
                      aria-expanded={expanded}
                    >
                      <ChevronDown
                        className={`h-4 w-4 transition-transform ${expanded ? "rotate-180" : ""}`}
                      />
                    </button>
                  )}
                </div>

                {hasChildren && expanded && (
                  <div className="mt-1 ml-3 pl-3 border-l border-border space-y-0.5 hidden lg:block">
                    {item.children!.filter(isVisible).map((child) => {
                      const ChildIcon = child.icon;
                      const childIsActive = isActive(child.href, child.exact);
                      return (
                        <Link
                          key={child.href}
                          href={child.href}
                          className={`flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm transition-colors ${
                            childIsActive
                              ? "bg-muted text-foreground font-medium"
                              : "text-muted-foreground hover:bg-accent hover:text-accent-foreground"
                          }`}
                          title={child.label}
                        >
                          <ChildIcon className="h-4 w-4 flex-shrink-0" />
                          <span className="flex-1">{child.label}</span>
                        </Link>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* Contribute button */}
        <div className="mt-6 px-0 lg:px-3">
          <Link
            href="/app/submit"
            className="flex items-center justify-center gap-2 w-full py-2.5 bg-primary hover:bg-primary/90 text-primary-foreground rounded-full text-sm font-semibold transition-colors"
            title="Beitragen"
          >
            <Plus className="h-4 w-4" />
            <span className="hidden lg:inline">Beitragen</span>
          </Link>
        </div>

        {/* Röbel Card widget — desktop expanded only */}
        <div className="mt-4 px-0 lg:px-3 hidden lg:block">
          <RoebelCardWidget />
        </div>
      </nav>

      {/* Bottom section */}
      <div className="py-3 px-2 lg:px-3">
        <div className="space-y-1">
          {bottomNavItems.map((item) => {
            const Icon = item.icon;
            return (
              <Link
                key={item.href}
                href={item.href}
                className="flex items-center gap-3 px-3 py-2 rounded-lg text-sm text-muted-foreground hover:text-accent-foreground hover:bg-accent transition-colors justify-center lg:justify-start"
                title={item.label}
              >
                <Icon className="h-4 w-4 flex-shrink-0" />
                <span className="hidden lg:inline">{item.label}</span>
              </Link>
            );
          })}
        </div>
      </div>
    </div>
  );
}
