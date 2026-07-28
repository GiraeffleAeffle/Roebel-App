"use client";

import { useEffect } from "react";
import { useActiveAccount } from "thirdweb/react";
import { sessionMatchesWallet } from "@/lib/workspace/session";

/**
 * The workspace session is keyed to `sub`. If the connected wallet stops
 * matching it, the session is discarded and re-established — otherwise
 * switching wallets in the app would leave the previous citizen's files on
 * screen, which is an identity bug rather than a caching one.
 */
export function WorkspaceSessionGuard() {
  const account = useActiveAccount();

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
      await fetch("/api/workspace/auth/logout", { method: "POST" });
      window.location.href = `/api/workspace/auth/login?returnTo=${encodeURIComponent(
        window.location.pathname,
      )}`;
    })();

    return () => {
      cancelled = true;
    };
  }, [account?.address]);

  return null;
}
