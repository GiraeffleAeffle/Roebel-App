"use client";

import { FolderOpen } from "lucide-react";
import { FileBrowser } from "@/components/workspace/FileBrowser";

export default function DateienPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-foreground flex items-center gap-2">
          <FolderOpen className="h-5 w-5 text-primary" />
          Dateien & Dokumente
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Deine Dateien liegen auf dem Server der Gemeinschaft. Dokumente
          öffnest und bearbeitest du direkt hier.
        </p>
      </div>
      <FileBrowser scope={{ scope: "personal" }} />
    </div>
  );
}
