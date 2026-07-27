"use client";

/**
 * "Ändern" — edit an existing flyer with one instruction. The saved flyer is
 * passed back to the image model as the reference (Nano Banana 2 Lite edits in
 * place), and the result is saved as a NEW flyer so the original stays.
 * Shared by the standalone Flyer tool and the event-specific generator.
 */

import { useState } from "react";
import { editFlyerAction } from "@/app/actions/flyer";
import type { Flyer } from "@/types/flyer";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Loader2, Wand2 } from "lucide-react";
import { toast } from "sonner";

interface Props {
  accountId: string;
  walletAddress: string;
  flyer: Flyer;
  onEdited: (flyer: Flyer) => void;
  /** Compact = icon-only trigger (library cards). */
  compact?: boolean;
}

export function FlyerEditControl({
  accountId,
  walletAddress,
  flyer,
  onEdited,
  compact = false,
}: Props) {
  const [open, setOpen] = useState(false);
  const [instruction, setInstruction] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (!instruction.trim() || busy) return;
    setBusy(true);
    try {
      const res = await editFlyerAction(accountId, walletAddress, flyer.id, instruction);
      if (!res.success || !res.flyer) {
        toast.error(res.error ?? "Änderung fehlgeschlagen");
        return;
      }
      toast.success("Geänderte Version erstellt");
      setInstruction("");
      setOpen(false);
      onEdited(res.flyer);
    } catch (error) {
      // A network drop / function timeout rejects the action — never leave the
      // spinner hanging with no feedback.
      console.error("editFlyerAction threw", error);
      toast.error("Änderung fehlgeschlagen. Bitte erneut versuchen.");
    } finally {
      setBusy(false);
    }
  };

  if (!open) {
    return (
      <Button
        variant="outline"
        size="sm"
        onClick={() => setOpen(true)}
        title="Flyer ändern"
      >
        <Wand2 className={compact ? "h-4 w-4" : "h-4 w-4 mr-2"} />
        {compact ? null : "Ändern"}
      </Button>
    );
  }

  return (
    <div className="w-full space-y-2">
      <Input
        autoFocus
        placeholder="Was soll geändert werden? z. B. „Datum auf 19. Juli ändern“"
        value={instruction}
        onChange={(e) => setInstruction(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") submit();
          if (e.key === "Escape") setOpen(false);
        }}
        disabled={busy}
      />
      <div className="flex items-center gap-2">
        <Button size="sm" onClick={submit} disabled={busy || !instruction.trim()}>
          {busy ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Wand2 className="h-4 w-4 mr-2" />}
          Änderung anwenden
        </Button>
        <Button variant="ghost" size="sm" onClick={() => setOpen(false)} disabled={busy}>
          Abbrechen
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">
        Das Original bleibt erhalten — die Änderung wird als neue Version gespeichert.
      </p>
    </div>
  );
}
