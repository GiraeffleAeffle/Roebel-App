"use client";

import {
  Cloud,
  MessagesSquare,
  Mail,
  BookOpen,
  Video,
  KanbanSquare,
  Bot,
  LayoutGrid,
  type LucideIcon,
} from "lucide-react";
import { useAccount } from "@/lib/context/AccountContext";
import { buildOrgWorkspaceTiles } from "@/lib/dashboard/org-workspace-tiles";
import { filterAvailableTiles } from "@/lib/dashboard/workspace-tiles";

const ICONS: Record<string, LucideIcon> = {
  cloud: Cloud,
  messages: MessagesSquare,
  mail: Mail,
  wiki: BookOpen,
  video: Video,
  project: KanbanSquare,
  agents: Bot,
};

export function OrgWorkspaceTilesCard() {
  const { activeAccount } = useAccount();

  const tiles = filterAvailableTiles(
    buildOrgWorkspaceTiles({
      workspaceBaseUrl: process.env.NEXT_PUBLIC_WORKSPACE_BASE_URL,
      chatBaseUrl: process.env.NEXT_PUBLIC_CHAT_BASE_URL,
      mailBaseUrl: process.env.NEXT_PUBLIC_MAIL_BASE_URL,
      wikiBaseUrl: process.env.NEXT_PUBLIC_WIKI_BASE_URL,
      videoBaseUrl: process.env.NEXT_PUBLIC_VIDEO_BASE_URL,
      projectBaseUrl: process.env.NEXT_PUBLIC_PROJECT_BASE_URL,
      agentsBaseUrl: process.env.NEXT_PUBLIC_AGENTS_BASE_URL,
      org: activeAccount
        ? { id: activeAccount.id, slug: activeAccount.slug }
        : null,
    })
  );

  if (tiles.length === 0) {
    return (
      <div className="bg-card border border-border rounded-xl shadow-sm p-6 text-center">
        <LayoutGrid className="h-8 w-8 text-muted-foreground mx-auto mb-3" />
        <p className="text-sm text-muted-foreground">
          Der gemeinsame Arbeitsbereich wird bald verfügbar sein.
        </p>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
      {tiles.map((tile) => {
        const Icon = ICONS[tile.icon] ?? LayoutGrid;
        return (
          <a
            key={tile.id}
            href={tile.href}
            target="_blank"
            rel="noopener noreferrer"
            className="flex flex-col items-center gap-2 bg-card border border-border rounded-xl p-5 hover:bg-accent transition-colors text-center"
          >
            <div className="h-11 w-11 rounded-lg bg-primary/10 flex items-center justify-center">
              <Icon className="h-6 w-6 text-primary" />
            </div>
            <span className="text-sm font-medium text-foreground">
              {tile.label}
            </span>
          </a>
        );
      })}
    </div>
  );
}
