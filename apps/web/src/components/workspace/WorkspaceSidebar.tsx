"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { LayoutDashboard, FolderOpen } from "lucide-react";
import { workspaceNav } from "@/lib/workspace/nav";

const ICONS: Record<string, typeof LayoutDashboard> = {
  uebersicht: LayoutDashboard,
  dateien: FolderOpen,
};

export function WorkspaceSidebar() {
  const pathname = usePathname();
  return (
    <nav className="hidden md:block w-60 shrink-0 border-r border-border p-4 space-y-1">
      {workspaceNav().map((item) => {
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
