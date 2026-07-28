"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { LayoutDashboard, FolderOpen } from "lucide-react";
import { useUserProfile } from "@/hooks/useUserProfile";
import { useVerificationStatus } from "@/hooks/useVerificationStatus";
import { workspaceNav, type WorkspaceNavItem } from "@/lib/workspace/nav";

const ICONS: Record<string, typeof LayoutDashboard> = {
  uebersicht: LayoutDashboard,
  dateien: FolderOpen,
};

/**
 * Client-mount gate, the same one ArbeitsbereichPage documents: the citizen
 * derivation below reads wallet + on-chain state through thirdweb hooks, and
 * calling those during SSR or the first hydration pass can resolve a
 * thirdweb/react instance whose ThirdwebProvider context is null ("must be
 * used within <ThirdwebProvider>"). Deferring the hook-using subtree to after
 * mount closes that window.
 *
 * Before mount the nav shows Übersicht only. That is the correct direction to
 * be wrong in for one frame: it under-advertises rather than showing a link
 * the server would refuse.
 */
export function WorkspaceSidebar() {
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted) return <SidebarNav items={workspaceNav({ isCitizen: false })} />;
  return <WorkspaceSidebarContent />;
}

function WorkspaceSidebarContent() {
  const { user } = useUserProfile();
  const { isCitizen: isCitizenChain } = useVerificationStatus();

  // Advisory flag ∪ chain truth — the same derivation the Übersicht page and
  // the Dateien page use, deliberately identical so the nav cannot advertise a
  // page the page itself then refuses. The server has the last word either
  // way: the Dateien surface is gated on the `citizen` group claim inside
  // `resolveScope`, so hiding the link is courtesy, not enforcement.
  const isCitizen =
    isCitizenChain ||
    user?.tier === "citizen" ||
    Boolean(user?.is_verified_citizen);

  return <SidebarNav items={workspaceNav({ isCitizen })} />;
}

function SidebarNav({ items }: { items: WorkspaceNavItem[] }) {
  const pathname = usePathname();
  return (
    <nav className="hidden md:block w-60 shrink-0 border-r border-border p-4 space-y-1">
      {items.map((item) => {
        const Icon = ICONS[item.id] ?? LayoutDashboard;
        const active =
          item.href === "/arbeitsbereich"
            ? pathname === item.href
            : pathname?.startsWith(item.href);
        return (
          <Link
            key={item.id}
            href={item.href}
            className={`flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition-colors ${
              active
                ? "bg-primary/10 text-primary font-medium"
                : "text-muted-foreground hover:bg-accent hover:text-foreground"
            }`}
          >
            <Icon className="h-4 w-4 shrink-0" />
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
