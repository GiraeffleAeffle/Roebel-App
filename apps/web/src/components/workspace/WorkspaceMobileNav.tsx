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
 * Mobile bottom nav for the citizen Arbeitsbereich — the `md:hidden`
 * companion to `WorkspaceSidebar`, which is `hidden md:block` and therefore
 * invisible on phones. Without this, the only link to the native Dateien
 * page lived in a sidebar no phone could see.
 *
 * Same client-mount gate and citizen derivation as `WorkspaceSidebar` (see
 * its doc comment): the derivation reads wallet + on-chain state through
 * thirdweb hooks, which can throw if called before the ThirdwebProvider's
 * connection manager is established for this route. Before mount the nav
 * shows Übersicht only — under-advertising for one frame is the correct
 * direction to be wrong in.
 */
export function WorkspaceMobileNav() {
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted) return <MobileNav items={workspaceNav({ isCitizen: false })} />;
  return <WorkspaceMobileNavContent />;
}

function WorkspaceMobileNavContent() {
  const { user } = useUserProfile();
  const { isCitizen: isCitizenChain } = useVerificationStatus();

  // Advisory flag ∪ chain truth — identical derivation to WorkspaceSidebar and
  // the Übersicht page, deliberately kept in sync so the nav cannot advertise
  // a page the page itself then refuses.
  const isCitizen =
    isCitizenChain ||
    user?.tier === "citizen" ||
    Boolean(user?.is_verified_citizen);

  return <MobileNav items={workspaceNav({ isCitizen })} />;
}

function MobileNav({ items }: { items: WorkspaceNavItem[] }) {
  const pathname = usePathname();

  const isActive = (href: string) =>
    href === "/arbeitsbereich" ? pathname === href : pathname?.startsWith(href);

  return (
    <nav className="fixed bottom-0 inset-x-0 z-40 md:hidden bg-card border-t border-border safe-area-bottom">
      <div className="flex items-center justify-around h-14">
        {items.map((item) => {
          const Icon = ICONS[item.id] ?? LayoutDashboard;
          const active = isActive(item.href);
          return (
            <Link
              key={item.id}
              href={item.href}
              className={`relative flex flex-col items-center justify-center gap-0.5 px-3 py-1 rounded-md transition-colors ${
                active ? "text-foreground" : "text-muted-foreground hover:text-foreground"
              }`}
            >
              <Icon className="h-5 w-5" />
              <span className="text-[10px] font-medium">{item.label}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
