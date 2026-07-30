"use client";

import { useState, useEffect, createContext, useContext } from "react";
import { Info, Crown, X } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

const STORAGE_KEY = "roebel_guidelines_seen";

// TODO: Replace placeholder text with your final guidelines
const GUIDELINES_SHORT =
  "Willkommen in der Röbel Community! Bitte sei respektvoll, teile keine falschen Informationen und halte den Umgangston freundlich. Beiträge, die gegen unsere Richtlinien verstoßen, können gemeldet werden.";

const GUIDELINES_FULL = [
  "Sei respektvoll und freundlich zu deinen Nachbarn.",
  "Keine Beleidigungen, Hassrede oder Diskriminierung.",
  "Teile keine falschen oder irreführenden Informationen.",
  "Kein Spam oder wiederholte Werbung.",
  "Respektiere die Privatsphäre anderer – keine persönlichen Daten ohne Erlaubnis.",
  "Beiträge, die gegen die Richtlinien verstoßen, können von der Community gemeldet werden.",
  "Dein Beitrag wird Teil des öffentlichen Datenbestands.",
];

function GuidelinesDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Crown className="h-5 w-5 text-amber-500" />
            Community-Richtlinien
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">{GUIDELINES_SHORT}</p>
          <ul className="space-y-2">
            {GUIDELINES_FULL.map((rule, i) => (
              <li key={i} className="flex items-start gap-2 text-sm text-foreground">
                <span className="text-primary font-medium mt-0.5">{i + 1}.</span>
                <span>{rule}</span>
              </li>
            ))}
          </ul>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Banner shown above the textarea on first post.
 * Renders nothing after the user has dismissed it.
 */
export function GuidelinesBanner() {
  const [hasSeen, setHasSeen] = useState(true);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    setHasSeen(localStorage.getItem(STORAGE_KEY) === "true");
  }, []);

  const handleDismiss = () => {
    localStorage.setItem(STORAGE_KEY, "true");
    setHasSeen(true);
  };

  if (!mounted || hasSeen) return null;

  return (
    <div className="mx-4 mb-2 p-3 rounded-lg bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800">
      <div className="flex items-start gap-3">
        <div className="h-8 w-8 rounded-full bg-amber-100 dark:bg-amber-900/30 flex items-center justify-center flex-shrink-0">
          <Crown className="h-4 w-4 text-amber-600 dark:text-amber-400" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-xs font-medium text-foreground mb-1">Mecky sagt:</p>
          <p className="text-xs text-muted-foreground leading-relaxed">
            {GUIDELINES_SHORT}
          </p>
          <button
            onClick={handleDismiss}
            className="mt-2 px-3 py-1 text-xs font-medium bg-primary text-primary-foreground rounded-full hover:bg-primary/90 transition-colors"
          >
            Verstanden
          </button>
        </div>
        <button
          onClick={handleDismiss}
          className="p-1 text-muted-foreground hover:text-foreground rounded-md"
          aria-label="Schließen"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}

/**
 * Info icon button in the action bar.
 * Always visible — opens full guidelines dialog on click.
 */
export function GuidelinesInfoButton() {
  const [dialogOpen, setDialogOpen] = useState(false);

  return (
    <>
      <button
        onClick={() => setDialogOpen(true)}
        className="p-2 text-muted-foreground hover:text-foreground rounded-full hover:bg-accent transition-colors"
        aria-label="Community-Richtlinien"
        title="Community-Richtlinien"
      >
        <Info className="h-5 w-5" />
      </button>
      <GuidelinesDialog open={dialogOpen} onOpenChange={setDialogOpen} />
    </>
  );
}
