"use client";

import { useState, useEffect } from "react";
import { useActiveAccount } from "thirdweb/react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { useAccount } from "@/lib/context/AccountContext";
import { OpeningHoursEditor } from "@/components/business/OpeningHoursEditor";
import { updateAccount } from "@/lib/supabase-accounts";
import type { OpeningHours } from "@/types/business";

export default function OrgOpeningHoursPage() {
  const { activeAccount, refreshAccounts } = useAccount();
  const thirdwebAccount = useActiveAccount();
  const [hours, setHours] = useState<OpeningHours>({});
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setHours(activeAccount?.opening_hours ?? {});
  }, [activeAccount?.id, activeAccount?.opening_hours]);

  if (!activeAccount) return null;

  const handleSave = async () => {
    if (!thirdwebAccount) {
      toast.error("Wallet nicht verbunden");
      return;
    }
    setSaving(true);
    try {
      // Signed write through the org-membership edge function: the server
      // verifies the caller's signature, checks the owner/admin gate, and
      // applies the opening_hours field via its own whitelist — no direct
      // `accounts` table write from the client.
      await updateAccount(thirdwebAccount, activeAccount.id, { opening_hours: hours });
      await refreshAccounts();
      toast.success("Öffnungszeiten gespeichert.");
    } catch (e) {
      toast.error("Fehler beim Speichern.", {
        description: e instanceof Error ? e.message : undefined,
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6 max-w-3xl">
      <div>
        <h1 className="text-2xl font-medium">Öffnungszeiten</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Optional — leer lassen, falls deine Organisation keine festen Öffnungszeiten hat.
        </p>
      </div>

      <div className="bg-card border border-border rounded-[10px] p-6">
        <OpeningHoursEditor value={hours} onChange={setHours} />

        <div className="mt-6 flex justify-end">
          <button
            onClick={handleSave}
            disabled={saving}
            className="inline-flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-lg text-sm font-medium hover:bg-primary/90 disabled:opacity-60"
          >
            {saving && <Loader2 className="h-4 w-4 animate-spin" />}
            Speichern
          </button>
        </div>
      </div>
    </div>
  );
}
