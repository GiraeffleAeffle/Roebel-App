"use client";

import { Briefcase } from "lucide-react";
import { useAccount } from "@/lib/context/AccountContext";
import { FileBrowser } from "@/components/workspace/FileBrowser";
import { OrgWorkspaceTilesCard } from "@/components/org-dashboard/OrgWorkspaceTilesCard";

export default function ArbeitsbereichPage() {
  const { activeAccount } = useAccount();

  return (
    <div className="max-w-4xl mx-auto space-y-8">
      <div>
        <h1 className="text-2xl font-medium flex items-center gap-2">
          <Briefcase className="h-5 w-5 text-primary" />
          Arbeitsbereich
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Der gemeinsame Arbeitsbereich eurer Organisation. Dateien und
          Dokumente liegen hier; wer Zugriff hat, entscheidet die
          Mitgliedschaft in der Organisation.
        </p>
      </div>

      {activeAccount ? (
        // The org's group folder. The server refuses the scope unless the
        // session carries a claim for this org, so an id in the URL is not
        // enough — this only supplies the name the folder is mounted under.
        <FileBrowser
          scope={{
            scope: "org",
            accountId: activeAccount.id,
            orgName: activeAccount.name,
          }}
        />
      ) : (
        <p className="text-sm text-muted-foreground">
          Wähle eine Organisation, um den gemeinsamen Arbeitsbereich zu öffnen.
        </p>
      )}

      <section className="space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          Weitere Apps
        </h2>
        <OrgWorkspaceTilesCard />
      </section>
    </div>
  );
}
