/**
 * Sealed public entrypoint for the Marienfelder Straße preview.
 *
 * It intentionally imports neither the normal Mini App shell nor a shared
 * view. Everything below is public, static, synthetic and read-only at build
 * time. It has no host SDK, account, network, analytics, identity, proposal
 * or civic-system dependency.
 */
import type { ReactNode } from "react";

const lifecycleSteps = [
  { label: "Thema eingeordnet", status: "abgeschlossen", tone: "done" },
  { label: "Arbeitsauftrag vorbereitet", status: "abgeschlossen", tone: "done" },
  { label: "Fachbereich simuliert", status: "Demo", tone: "demo" },
  { label: "Antwort geprüft", status: "Demo", tone: "demo" },
  { label: "Öffentliche Einordnung", status: "Demo", tone: "demo" },
] as const;

const departments = [
  {
    name: "Planung und Ingenieurwesen",
    status: "Synthetische Antwort sichtbar",
    detail:
      "Übergabe, fachliche Einordnung, menschliche Prüfung und öffentliche Kurzfassung werden als Demo gezeigt.",
    tone: "done",
  },
  {
    name: "Mobilität, Barrierefreiheit und Sicherheit",
    status: "Nicht versendet",
    detail: "Kein echter Auftrag und keine reale Fachantwort.",
    tone: "waiting",
  },
  {
    name: "Umwelt, Geodaten und Klima",
    status: "Nicht versendet",
    detail: "Kein echter Auftrag und keine reale Fachantwort.",
    tone: "waiting",
  },
  {
    name: "Finanzen und Vergabe",
    status: "Nicht versendet",
    detail: "Kein echter Auftrag und keine reale Fachantwort.",
    tone: "waiting",
  },
] as const;

const journal = [
  ["Thema wurde im Stadtstack erfasst", "Fallkoordination", "vorgeschlagen"],
  ["Arbeitsauftrag für den Fachbereich wurde vorbereitet", "Verwaltungskoordination", "vorgeschlagen"],
  ["Synthetische Übergabe an den Fachbereich wurde protokolliert", "Fachbereich", "protokolliert"],
  ["Mecky-Entwurf wurde zur menschlichen Prüfung bereitgestellt", "Mecky", "abgeschlossen"],
  ["Synthetische Fachantwort wurde eingereicht", "Fachbereich", "protokolliert"],
  ["Öffentliche Kurzantwort wurde unabhängig geprüft", "Evidenzprüfung", "geprüft"],
  ["Geprüfter Demo-Status wurde für die Röbel-App bereitgestellt", "Veröffentlichungsprüfung", "protokolliert"],
] as const;

function assetPath(pathname: string): string {
  const rawBasePath = process.env.NEXT_PUBLIC_MINIAPP_BASE_PATH?.trim() ?? "";
  const basePath = rawBasePath && rawBasePath !== "/" ? rawBasePath.replace(/\/+$/, "") : "";
  return `${basePath}${pathname.startsWith("/") ? pathname : `/${pathname}`}`;
}

export default function PublicDemoEntrypoint() {
  return (
    <main className="mx-auto min-h-dvh w-full max-w-xl bg-background text-foreground">
      <header className="border-b border-border bg-background px-4 pb-3 pt-4">
        <div className="flex items-center gap-2.5">
          <img
            src={assetPath("/assets/Logo-data.png")}
            alt="Röbel Data"
            className="h-7 w-auto"
          />
          <span className="ml-auto rounded-full border border-[#00498B]/25 bg-[#00498B]/[0.06] px-2.5 py-1 text-[11px] font-semibold text-[#00498B]">
            Öffentliche Demo
          </span>
        </div>
        <div className="mt-3 rounded-[10px] bg-muted px-3 py-2 text-center text-[12px] font-semibold text-[#00498B]">
          Mitbestimmung · Marienfelder Straße
        </div>
      </header>

      <div className="space-y-5 px-4 py-5">
        <section className="overflow-hidden rounded-[12px] border border-amber-300/70 bg-amber-50/45 shadow-sm">
          <div className="border-b border-amber-300/70 px-4 py-3">
            <div className="flex flex-wrap gap-1.5">
              <Badge>Demo · kein amtlicher Stand</Badge>
              <Badge>keiner Abstimmung zugeordnet</Badge>
            </div>
            <h1 className="mt-3 font-display text-xl font-bold tracking-tight text-foreground">
              Marienfelder Straße
            </h1>
            <p className="mt-2 text-[13px] leading-relaxed text-muted-foreground">
              Ein vollständig synthetischer Ablauf: Er zeigt, wie Hinweise,
              Fachbereiche, eine menschliche Prüfung und eine verständliche
              öffentliche Einordnung zusammenlaufen könnten.
            </p>
          </div>
          <dl className="grid grid-cols-2 gap-px bg-amber-300/60 text-[12px]">
            <Fact label="Entscheidungsstand" value="Demo-Ablauf" />
            <Fact label="Amtliche Verantwortung" value="nicht übertragen" />
            <Fact label="Fachbereiche" value="1 von 4 simuliert" />
            <Fact label="Bürgerbeteiligung" value="nicht geöffnet" />
          </dl>
        </section>

        <section aria-labelledby="lifecycle-heading" className="rounded-[12px] border border-border bg-card p-4 shadow-sm">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Fallstatus</p>
              <h2 id="lifecycle-heading" className="mt-1 text-[17px] font-bold text-foreground">So ist der Ablauf eingeordnet</h2>
            </div>
            <span className="rounded-full bg-[#00498B]/10 px-2 py-1 text-[10px] font-bold text-[#00498B]">5 Schritte</span>
          </div>
          <ol className="mt-4 space-y-3" aria-label="Synthetischer Ablauf">
            {lifecycleSteps.map((step, index) => (
              <li key={step.label} className="flex items-center gap-3">
                <span
                  className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[11px] font-bold ${
                    step.tone === "done" ? "bg-emerald-500 text-white" : "bg-[#00498B] text-white"
                  }`}
                >
                  {index + 1}
                </span>
                <span className="min-w-0 flex-1 text-[13px] font-semibold text-foreground">{step.label}</span>
                <span className="text-[11px] font-medium text-muted-foreground">{step.status}</span>
              </li>
            ))}
          </ol>
        </section>

        <section aria-labelledby="departments-heading" className="rounded-[12px] border border-border bg-card shadow-sm">
          <div className="border-b border-border px-4 py-4">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Fachbereiche</p>
            <h2 id="departments-heading" className="mt-1 text-[17px] font-bold text-foreground">Wer hat worauf geantwortet?</h2>
            <p className="mt-1 text-[12.5px] leading-relaxed text-muted-foreground">Die Ansicht unterscheidet sichtbar zwischen einer Demo-Antwort und nicht versendeten Paketen.</p>
          </div>
          <ul className="divide-y divide-border">
            {departments.map((department) => (
              <li key={department.name} className="px-4 py-3.5">
                <div className="flex items-start gap-3">
                  <span className={`mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full ${department.tone === "done" ? "bg-emerald-500" : "bg-slate-300"}`} aria-hidden="true" />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                      <h3 className="text-[13px] font-bold text-foreground">{department.name}</h3>
                      <span className="text-[11px] font-semibold text-[#00498B]">{department.status}</span>
                    </div>
                    <p className="mt-1 text-[12px] leading-relaxed text-muted-foreground">{department.detail}</p>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </section>

        <section aria-labelledby="journal-heading" className="rounded-[12px] border border-border bg-card p-4 shadow-sm">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Aktivitätsjournal</p>
            <h2 id="journal-heading" className="mt-1 text-[17px] font-bold text-foreground">Was im Demo-Fall protokolliert wurde</h2>
            <p className="mt-1 text-[12.5px] leading-relaxed text-muted-foreground">Nur synthetische Metadaten. Keine Gesprächsinhalte, Zugangsdaten, Abstimmungen oder internen Dokumente.</p>
          </div>
          <ol className="mt-4 space-y-4 border-l border-border pl-4">
            {journal.map(([title, actor, status], index) => (
              <li key={title} className="relative">
                <span className="absolute -left-[23px] top-0 flex h-4 w-4 items-center justify-center rounded-full border border-[#00498B] bg-card text-[9px] font-bold text-[#00498B]">
                  {index + 1}
                </span>
                <p className="text-[13px] font-bold leading-snug text-foreground">{title}</p>
                <p className="mt-1 text-[11px] text-muted-foreground">20.07.2026 · {actor} · <span className="font-semibold text-[#00498B]">{status}</span></p>
              </li>
            ))}
          </ol>
        </section>

        <section className="rounded-[12px] border border-dashed border-border bg-muted/40 p-4">
          <h2 className="text-[14px] font-bold text-foreground">Klare Grenze dieser Vorschau</h2>
          <p className="mt-1.5 text-[12.5px] leading-relaxed text-muted-foreground">
            Diese Seite hat keine Verbindung zu Konten, Abstimmungen,
            Gemeinschaftskasse, Verwaltungssoftware oder externen Diensten.
            Sie kann nichts absenden, bewerten oder entscheiden.
          </p>
        </section>
      </div>
    </main>
  );
}

function Badge({ children }: { children: ReactNode }) {
  return <span className="rounded-full bg-amber-200/80 px-2 py-1 text-[10px] font-bold text-amber-950">{children}</span>;
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-amber-50/40 px-4 py-3">
      <dt className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd className="mt-1 text-[12px] font-bold text-foreground">{value}</dd>
    </div>
  );
}
