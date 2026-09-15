"use client";

import { useEffect, useRef, useState } from "react";
import { useCitizenSession } from "@/lib/citizen-session/CitizenSessionContext";
import { createStagingWorkspaceLogin } from "@/lib/workspace/staging-login-bridge";

export default function WorkspaceAppLogin() {
  const session = useCitizenSession();
  const bridge = useRef<ReturnType<typeof createStagingWorkspaceLogin> | null>(null);
  const [status, setStatus] = useState("ready");
  useEffect(() => {
    setStatus("ready");
    if (!window.opener) { setStatus("missing_request"); return; }
    if (!session) return;
    try {
      const current = createStagingWorkspaceLogin({ session, opener: window.opener, appOrigin: window.location.origin, onStatus: setStatus });
      bridge.current = current;
      const receive = (event: MessageEvent) => { void current.receive(event); };
      window.addEventListener("message", receive);
      return () => { current.dispose(); bridge.current = null; window.removeEventListener("message", receive); };
    } catch { setStatus("unavailable"); }
  }, [session]);
  const working = ["waiting", "signing", "sent"].includes(status);
  return <main className="mx-auto max-w-xl space-y-5 px-4 py-8">
    <p className="text-sm font-semibold text-muted-foreground">Town Workspace · Testbetrieb</p>
    <h1 className="text-2xl font-bold">Mit deinem Röbel-Konto anmelden</h1>
    <p>Du bestätigst die Anmeldung im Town Workspace mit deinem eigenen Konto. Dafür brauchst du keine zusätzliche Browser-Wallet und kein Guthaben.</p>
    {status === "missing_request" ? <p role="status">Öffne zuerst die <a className="text-primary underline" href="/verwaltung">Verwaltung</a> und wähle dort die Anmeldung mit dem Röbel-Konto.</p>
      : status === "unavailable" ? <p role="status">Diese Verbindung ist nur im Röbel-Testbetrieb verfügbar.</p>
      : !session ? <p role="status">Wähle oben „Anmelden“ und melde dich mit deinem eigenen Konto an. Danach kannst du hier fortfahren.</p>
      : <section className="space-y-4 rounded-xl border bg-card p-5">
        <div><p className="text-sm font-semibold">Dein ausgewähltes Konto</p><p className="mt-1 break-all font-mono text-sm">{session.snapshot.credential.address}</p></div>
        <button className="rounded-full bg-primary px-5 py-2.5 font-semibold text-primary-foreground disabled:opacity-50" disabled={working}
          onClick={() => bridge.current?.start()}>{status === "failed" ? "Erneut versuchen" : "Anmeldung bestätigen"}</button>
        <p role="status" className="text-sm">{status === "waiting" ? "Anmeldeanfrage abrufen …"
          : status === "signing" ? "Anmeldung mit deinem Konto bestätigen …"
          : status === "sent" ? "Signatur übermittelt. Das Ergebnis wird im ursprünglichen Anmeldefenster angezeigt."
          : status === "failed" ? "Anmeldung nicht bestätigt. Du kannst es erneut versuchen."
          : "Die Bestätigung gilt nur für diese Anmeldung bei Röbel ID."}</p>
      </section>}
    <p className="text-sm text-muted-foreground">Der Testzugang und deine Aufgaben werden separat freigeschaltet. Die Anmeldung allein vergibt keine Verwaltungsrolle. Dein Konto und sein Wiederherstellungsweg bleiben erhalten.</p>
  </main>;
}
