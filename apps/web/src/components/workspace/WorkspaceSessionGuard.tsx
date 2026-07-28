"use client";

import { useEffect, useState } from "react";
import { useActiveAccount } from "thirdweb/react";
import { sessionMatchesWallet } from "@/lib/workspace/session";

/**
 * The workspace session is keyed to `sub`. If the connected wallet stops
 * matching it, the session is discarded and re-established — otherwise
 * switching wallets in the app would leave the previous citizen's files on
 * screen, which is an identity bug rather than a caching one.
 *
 * Rendered by `FileBrowser`, not by a layout. It used to live in
 * apps/web/src/app/arbeitsbereich/layout.tsx only, which meant the org surface
 * (/dashboard/arbeitsbereich, a different layout) mounted `FileBrowser` with no
 * guard at all: a wallet switch there kept WebDAV on the previous wallet's
 * session and stamped every provenance row with the previous `actor_sub`.
 * Living next to the component that consumes the session is what stops the
 * next surface from forgetting it.
 */
export function WorkspaceSessionGuard() {
  const account = useActiveAccount();
  const [logoutFailed, setLogoutFailed] = useState(false);

  useEffect(() => {
    const wallet = account?.address;
    if (!wallet) return;
    let cancelled = false;

    void (async () => {
      const res = await fetch("/api/workspace/auth/session");
      if (!res.ok || cancelled) return;
      const { sub } = (await res.json()) as { sub: string | null };
      if (!sub || cancelled) return;
      // Only the sub is compared here; the helper is shared with the server so
      // the two can never disagree about what "matches" means.
      if (sessionMatchesWallet({ sub, groups: [], accessToken: "", refreshToken: null, expiresAt: 0 }, wallet)) {
        return;
      }

      const loggedOut = await fetch("/api/workspace/auth/logout", { method: "POST" });
      if (cancelled) return;
      // The logout route fails LOUDLY by design: when it cannot delete the
      // session row it keeps the cookie and answers 500, precisely so a retry
      // can find the same session again. Navigating to login anyway would
      // undo that — login mints a new session id and overwrites the cookie,
      // which is the only handle this app has on a row holding a live
      // Nextcloud refresh token. So: stop here, say so, and let the citizen
      // retry rather than orphaning a credential to keep the UI moving.
      if (!loggedOut.ok) {
        console.error(
          "[workspace] logout refused; not starting a new session",
          loggedOut.status,
        );
        setLogoutFailed(true);
        return;
      }

      window.location.href = `/api/workspace/auth/login?returnTo=${encodeURIComponent(
        window.location.pathname,
      )}`;
    })();

    return () => {
      cancelled = true;
    };
  }, [account?.address]);

  if (!logoutFailed) return null;
  return (
    <p className="text-sm text-destructive border border-destructive/30 rounded-lg p-3">
      Der Wechsel des Kontos konnte nicht abgeschlossen werden. Bitte lade die
      Seite neu — bis dahin siehst du möglicherweise die Dateien des zuvor
      verbundenen Kontos.
    </p>
  );
}
