"use client";

import { LogOut, RefreshCw } from "lucide-react";
import { logoutWorkspace } from "@/lib/workspace/client-api";
import { useState } from "react";

/**
 * Ends only the Röbel workspace session. The app wallet and the upstream
 * identity-provider session are deliberately outside this action.
 *
 * Quarantine is signalled before the request so a failed destroy cannot leave
 * the current account's files or write controls usable while the sole cookie
 * handle is retained for a retry.
 */
export function WorkspaceLogoutButton({ compact = false }: { compact?: boolean }) {
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  async function logout() {
    if (busy) return;
    setBusy(true);
    setFailed(false);
    try {
      await logoutWorkspace();
      // A successful workspace logout returns to the existing, explicit
      // workspace login surface. It never signs out the app or the IdP.
      window.location.assign("/verwaltung");
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={compact ? "space-y-1" : "mt-6 border-t border-border pt-4 space-y-2"}>
      <button
        type="button"
        onClick={() => void logout()}
        disabled={busy}
        aria-busy={busy}
        className="w-full inline-flex items-center justify-center gap-2 rounded-lg border border-border px-3 py-2 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:cursor-wait disabled:opacity-60"
        title="Nur diese Arbeitsbereich-Sitzung abmelden"
      >
        {busy ? <RefreshCw className="h-4 w-4 animate-spin" /> : <LogOut className="h-4 w-4" />}
        <span>Arbeitsbereich abmelden</span>
      </button>
      {!compact && (
        <p className="px-1 text-[11px] leading-4 text-muted-foreground">
          Beendet nur diese Arbeitsbereich-Sitzung. Dein Röbel-Konto und der externe
          Anmeldeanbieter bleiben angemeldet.
        </p>
      )}
      {failed && (
        <div role="alert" className="space-y-1 rounded-lg border border-destructive/30 p-2 text-xs text-destructive">
          <p>Die Abmeldung wurde nicht bestätigt. Der Zugang bleibt gesperrt; bitte versuche es erneut.</p>
          <button
            type="button"
            onClick={() => void logout()}
            disabled={busy}
            className="inline-flex items-center gap-1 underline underline-offset-2"
          >
            <RefreshCw className="h-3 w-3" /> Erneut versuchen
          </button>
        </div>
      )}
    </div>
  );
}
