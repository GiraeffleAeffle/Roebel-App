import type { DocumentKnowledgeResult } from "../../lib/mecky/document-knowledge";

export function DocumentKnowledgeView({ result }: { result: DocumentKnowledgeResult }) {
  if (result.status !== "current") {
    const text = {
      unavailable: "Die Quelle kann gerade nicht geladen werden. Bitte versuche es später erneut.",
      not_found: "Dieser Dokumentabschnitt ist im aktuellen Quellenverzeichnis nicht verfügbar.",
      withdrawn: "Dieser Abschnitt wurde aus dem aktuellen Quellenverzeichnis zurückgenommen.",
      outdated: "Dieser Abschnitt ist nicht mehr als aktueller Quellenstand freigegeben.",
      changed: "Die Quelle wurde überarbeitet. Diese Quellenangabe gehört zu einer früheren Fassung.",
    }[result.status];
    return <main className="mx-auto max-w-3xl space-y-4 p-6 font-sans">
      <a className="text-primary underline" href="/app/mecky">Zu Mecky</a>
      <h1 className="text-2xl font-semibold">Quellenstand</h1>
      <p role="status" className="text-muted-foreground">{text}</p>
      {result.status === "changed" && result.currentUrl &&
        <a className="text-primary underline" href={result.currentUrl}>Aktuelle Fassung lesen</a>}
    </main>;
  }
  const { record, sections } = result;
  const date = (value: string) => new Date(value).toLocaleDateString("de-DE", { timeZone: "UTC" });
  return <main className="mx-auto max-w-3xl space-y-6 p-6 font-sans">
    <a className="text-primary underline" href="/app/mecky">Zu Mecky</a>
    <header className="space-y-2">
      <p className="text-sm text-muted-foreground">{record.documentTitle}</p>
      <h1 className="text-2xl font-semibold">{record.title}</h1>
      <p className="text-sm text-muted-foreground">{record.attributedTo} · S. {record.printedPageLabel}</p>
    </header>
    <section aria-label="Dokumentierte Aussage" className="rounded-xl border border-border bg-card p-5">
      <p className="whitespace-pre-line leading-relaxed">{record.summary}</p>
    </section>
    {record.topicIds.length > 0 && <section aria-label="Verknüpfte Themen" className="space-y-2">
      <h2 className="font-semibold">Diskussion und Rücklauf</h2>
      {record.topicIds.map((topic) => <a key={topic} className="block text-primary underline"
        href={`/app/themen/${encodeURIComponent(topic)}`}>Verknüpftes Thema öffnen</a>)}
    </section>}
    <details className="rounded-xl border border-border p-5">
      <summary className="cursor-pointer font-semibold">Quelle und Fassung</summary>
      <dl className="mt-4 grid gap-2 text-sm">
        <dt className="text-muted-foreground">Herausgeber</dt><dd>{record.publisher}</dd>
        <dt className="text-muted-foreground">Veröffentlichungsdatum</dt><dd>{record.publishedAt ? date(record.publishedAt) : "Im Dokument nicht angegeben"}</dd>
        <dt className="text-muted-foreground">Quellenprüfung</dt><dd>{date(record.reviewedAt)}</dd>
        <dt className="text-muted-foreground">Fundstelle</dt><dd>Gedruckte S. {record.printedPageLabel}; PDF-Seite {record.pageStart}{record.pageEnd !== record.pageStart ? `–${record.pageEnd}` : ""} von {record.pageCount}</dd>
        <dt className="text-muted-foreground">Dokumentversion</dt><dd className="break-all font-mono text-xs">{record.documentSha256}</dd>
        <dt className="text-muted-foreground">Abschnittsversion</dt><dd className="break-all font-mono text-xs">{record.evidenceId}</dd>
      </dl>
      {record.documentUrl ? <a className="mt-4 block text-primary underline" href={record.documentUrl} target="_blank" rel="noreferrer">Originaldokument öffnen</a>
        : <p className="mt-4 text-sm text-muted-foreground">Das Originaldokument wurde bereitgestellt; ein öffentlicher Download ist hier nicht hinterlegt.</p>}
    </details>
    {sections.length > 1 && <nav aria-label="Weitere Dokumentabschnitte" className="space-y-3">
      <h2 className="font-semibold">Weitere Abschnitte</h2>
      <ul className="space-y-3">{sections.filter((entry) => entry.sectionId !== record.sectionId).map((entry) =>
        <li key={entry.sectionId}><a className="text-primary underline" href={entry.recordUrl}>{entry.title}</a>
          <span className="ml-2 text-sm text-muted-foreground">S. {entry.printedPageLabel}</span></li>)}</ul>
    </nav>}
  </main>;
}
