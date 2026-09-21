"use client";

import { Fragment, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { useActiveAccount, useIsAutoConnecting } from "thirdweb/react";
import { sessionMatchesWallet } from "@/lib/workspace/session";
import {
  hasPendingWorkspaceLogout,
  hasTriedLoginHop,
  hopMarkerStore,
  loginRedirect,
  logoutWorkspace,
  markLoginHop,
  releaseLoginHop,
  WORKSPACE_QUARANTINE_EVENT,
} from "@/lib/workspace/client-api";
import { WorkspaceLogoutButton } from "./WorkspaceLogoutButton";

type GateState = {
  identity: string | null;
  status: "checking" | "verified" | "probe-failed" | "logout-required" |
    "unconfigured" | "signed-out" | "redirecting" | "login-failed";
};

/**
 * The protected subtree does not exist until /session matches this wallet.
 * Changing identity immediately removes it, before a new asynchronous probe.
 * FileBrowser mounts this boundary after hydration for both personal/org routes.
 */
export function WorkspaceSessionGuard({ children, unconfigured }: {
  children: ReactNode;
  unconfigured: ReactNode;
}) {
  const account = useActiveAccount();
  const isAutoConnecting = useIsAutoConnecting();
  const identity = account?.address.toLowerCase() ?? null;
  const [gate, setGate] = useState<GateState>({ identity: null, status: "checking" });
  const [probeAttempt, setProbeAttempt] = useState(0);
  const identityRef = useRef(identity);
  const restoringRef = useRef(isAutoConnecting);
  const generationRef = useRef(0);
  const probeRef = useRef<AbortController | null>(null);

  useLayoutEffect(() => {
    identityRef.current = identity;
    restoringRef.current = isAutoConnecting;
    return () => {
      generationRef.current++;
      probeRef.current?.abort();
    };
  }, [identity, isAutoConnecting]);

  useLayoutEffect(() => {
    const quarantine = () => {
      generationRef.current++;
      probeRef.current?.abort();
      setGate({ identity: identityRef.current, status: "logout-required" });
    };
    window.addEventListener(WORKSPACE_QUARANTINE_EVENT, quarantine);
    return () => window.removeEventListener(WORKSPACE_QUARANTINE_EVENT, quarantine);
  }, []);

  useEffect(() => {
    if (isAutoConnecting) return;
    const store = hopMarkerStore();
    if (hasPendingWorkspaceLogout(store)) {
      setGate({ identity, status: "logout-required" });
      return;
    }
    const controller = new AbortController();
    probeRef.current = controller;
    const generation = ++generationRef.current;
    const current = () => !controller.signal.aborted && generation === generationRef.current;
    setGate({ identity, status: "checking" });

    void (async () => {
      try {
        const response = await fetch("/api/workspace/auth/session", {
          signal: controller.signal,
          cache: "no-store",
        });
        if (!current()) return;
        if (response.status === 503) {
          setGate({ identity, status: "unconfigured" });
          return;
        }
        if (!response.ok && response.status !== 401) throw new Error("workspace_probe_failed");
        const result = response.status === 401 ? { sub: null } : await response.json();
        if (!current()) return;
        if (!result || typeof result !== "object" || Array.isArray(result) ||
          !(result.sub === null || (typeof result.sub === "string" && result.sub.length > 0))) {
          throw new Error("workspace_probe_invalid");
        }
        if (result.sub === null) {
          if (!identity) {
            setGate({ identity, status: "signed-out" });
          } else if (hasTriedLoginHop(store)) {
            setGate({ identity, status: "login-failed" });
          } else {
            markLoginHop(store);
            setGate({ identity, status: "redirecting" });
            window.location.assign(loginRedirect(window.location.pathname));
          }
          return;
        }
        if (identity && sessionMatchesWallet({ sub: result.sub, groups: [], accessToken: "",
          refreshToken: null, expiresAt: 0 }, identity)) {
          setGate({ identity, status: "verified" });
          return;
        }

        // The event blocks every mounted consumer before destruction starts.
        // Capture its new generation, not the now-cancelled probe's generation.
        const logout = logoutWorkspace();
        const logoutGeneration = generationRef.current;
        await logout;
        if (logoutGeneration !== generationRef.current || identity !== identityRef.current || restoringRef.current) return;
        if (identity) {
          markLoginHop(store);
          setGate({ identity, status: "redirecting" });
          window.location.assign(loginRedirect(window.location.pathname));
        } else {
          setGate({ identity, status: "signed-out" });
        }
      } catch {
        // Logout keeps its marker/cookie on failure; only a confirmed retry may
        // release that barrier, even after this component remounts or reloads.
        if (hasPendingWorkspaceLogout(store)) return;
        if (current()) setGate({ identity, status: "probe-failed" });
      }
    })();

    return () => {
      controller.abort();
      generationRef.current++;
      if (probeRef.current === controller) probeRef.current = null;
    };
  }, [identity, isAutoConnecting, probeAttempt]);

  if (isAutoConnecting || gate.identity !== identity || gate.status === "checking") {
    return <p className="rounded-xl border border-border p-6 text-sm text-muted-foreground">Identität wird geprüft …</p>;
  }
  if (hasPendingWorkspaceLogout(hopMarkerStore()) || gate.status === "logout-required") {
    return (
      <div role="alert" className="rounded-xl border border-destructive/30 bg-card p-6 text-sm space-y-3">
        <p>Die bisherige Arbeitsbereich-Sitzung ist noch nicht bestätigt beendet. Dateien und Schreibaktionen bleiben gesperrt.</p>
        <WorkspaceLogoutButton />
      </div>
    );
  }
  if (gate.status === "unconfigured") return <>{unconfigured}</>;
  if (gate.status === "verified") return <Fragment key={identity}>{children}</Fragment>;
  if (gate.status === "probe-failed") {
    return (
      <div role="alert" className="rounded-xl border border-destructive/30 bg-card p-6 text-sm space-y-3">
        <p>Die Arbeitsbereich-Sitzung konnte nicht sicher geprüft werden. Dateien und Schreibaktionen bleiben gesperrt.</p>
        <button type="button" onClick={() => setProbeAttempt(attempt => attempt + 1)} className="rounded-md border px-3 py-2">Sitzung erneut prüfen</button>
      </div>
    );
  }
  if (gate.status === "login-failed") {
    return (
      <div role="alert" className="rounded-xl border border-destructive/30 bg-card p-6 text-sm space-y-3">
        <p>Die Anmeldung am Arbeitsbereich ist wiederholt fehlgeschlagen. Bitte wende dich an die Verwaltung.</p>
        <button type="button" onClick={() => {
          releaseLoginHop(hopMarkerStore());
          setProbeAttempt(attempt => attempt + 1);
        }} className="rounded-md border px-3 py-2">Erneut anmelden</button>
      </div>
    );
  }
  if (gate.status === "redirecting") {
    return <p className="text-sm text-muted-foreground">Anmeldung am Arbeitsbereich wird gestartet …</p>;
  }
  return (
    <p className="rounded-xl border border-border p-6 text-sm text-muted-foreground">
      Arbeitsbereich abgemeldet. Eine neue Anmeldung muss ausdrücklich über{" "}
      <a className="underline underline-offset-2" href="/verwaltung">die Verwaltungsseite</a> gestartet werden.
    </p>
  );
}
