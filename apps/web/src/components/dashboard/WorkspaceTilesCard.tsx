"use client";

import { Cloud, LayoutGrid, type LucideIcon } from "lucide-react";
import {
  buildWorkspaceTiles,
  filterAvailableTiles,
} from "@/lib/dashboard/workspace-tiles";

const ICONS: Record<string, LucideIcon> = {
  cloud: Cloud,
};

export function WorkspaceTilesCard() {
  const tiles = filterAvailableTiles(
    buildWorkspaceTiles({
      workspaceBaseUrl: process.env.NEXT_PUBLIC_WORKSPACE_BASE_URL,
    })
  );

  if (tiles.length === 0) {
    return (
      <div className="bg-card border border-border rounded-xl shadow-sm p-6 text-center">
        <LayoutGrid className="h-8 w-8 text-muted-foreground mx-auto mb-3" />
        <p className="text-sm text-muted-foreground">
          Arbeitsbereich-Apps werden bald verfügbar sein.
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
            <span className="text-sm font-medium text-foreground">{tile.label}</span>
          </a>
        );
      })}
    </div>
  );
}
