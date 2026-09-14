import { departmentLabel } from "@roebel/stadtstack-federation-client";

export type BriefResponse = { departmentId: string; publicSummary: string; publicCitations: string[] };

function sourceLabel(source: string, index: number) {
  try {
    const url = new URL(source);
    return url.pathname.includes("/app/diskussion/") ? "Ausgangsdiskussion" : `Quelle ${index + 1} · ${url.hostname}`;
  } catch { return source; }
}
export function BriefResponses({ responses, collapsible = false }: { responses: BriefResponse[]; collapsible?: boolean }) {
  return <div className="grid gap-3 sm:grid-cols-2">{responses.map(item => {
    const contents = <><p className="mt-3 whitespace-pre-wrap text-sm leading-6">{item.publicSummary}</p>
      <ul className="mt-3 flex flex-wrap gap-2 text-xs">{item.publicCitations.map((source, index) => <li key={source} className="min-w-0 break-words">
        {/^https:\/\//i.test(source) ? <a href={source} title={source} target="_blank" rel="noopener noreferrer" className="inline-block rounded-full border px-3 py-1.5 text-primary hover:underline">{sourceLabel(source, index)} ↗</a> : source}
      </li>)}</ul></>;
    return collapsible ? <details key={item.departmentId} className="self-start rounded-xl border bg-card p-4">
      <summary className="cursor-pointer font-semibold">{departmentLabel(item.departmentId)} <span className="ml-1 text-xs font-normal text-emerald-700">Geprüfte Testantwort</span></summary>{contents}
    </details> : <article key={item.departmentId} className="rounded-xl border bg-card p-4"><h3 className="font-semibold">{departmentLabel(item.departmentId)}</h3>{contents}</article>;
  })}</div>;
}
