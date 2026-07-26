"use client";

import { Briefcase } from "lucide-react";
import { OrgWorkspaceTilesCard } from "@/components/org-dashboard/OrgWorkspaceTilesCard";

export default function ArbeitsbereichPage() {
  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-medium flex items-center gap-2">
          <Briefcase className="h-5 w-5 text-primary" />
          Arbeitsbereich
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Der gemeinsame Arbeitsbereich eurer Organisation: geteilte Dateien &
          Dokumente sowie der Team-Chat — angemeldet über Röbel ID.
        </p>
      </div>
      <OrgWorkspaceTilesCard />
    </div>
  );
}
