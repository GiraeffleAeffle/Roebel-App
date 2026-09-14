const departments: Record<string, string> = { planning: "Stadtplanung", traffic: "Verkehr", environment: "Umwelt", finance: "Finanzen",
  legal: "Recht", "public-order": "Öffentliche Ordnung", "social-affairs": "Soziales", "public-works": "Technische Dienste" };

export type BriefResponse = { departmentId: string; publicSummary: string; publicCitations: string[] };

export function BriefResponses({ responses }: { responses: BriefResponse[] }) {
  return <div className="grid gap-3 sm:grid-cols-2">{responses.map(item => <article key={item.departmentId} className="rounded-xl border bg-white p-4">
    <h3 className="font-semibold">{departments[item.departmentId] ?? item.departmentId}</h3>
    <p className="mt-2 whitespace-pre-wrap text-sm leading-6">{item.publicSummary}</p>
    <ul className="mt-2 space-y-1 text-xs">{item.publicCitations.map(source => <li key={source} className="break-words">
      {/^https:\/\//i.test(source) ? <a href={source} target="_blank" rel="noopener noreferrer" className="text-primary underline">{source}</a> : source}
    </li>)}</ul>
  </article>)}</div>;
}
