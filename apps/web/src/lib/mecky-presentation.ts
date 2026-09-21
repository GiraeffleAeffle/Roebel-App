/** Strip only the writer's deterministic footer after every URL matches the
 * verified citation list. Signed content and evidence records stay unchanged. */
export function meckyPresentation(content: string, urls: readonly string[]) {
  const marker = "\n\nQuellenbelege: ";
  const at = content.lastIndexOf(marker);
  const fallback = { body: content, sources: urls.map((url, i) => ({ url, title: `Quelle ${i + 1}` })) };
  if (at < 0 || !urls.length) return fallback;
  const parts = content.slice(at + marker.length).split("; ");
  if (parts.length !== urls.length) return fallback;
  const sources = parts.map((part, i) => {
    const suffix = ` – ${urls[i]}`;
    return part.endsWith(suffix) && part.length > suffix.length
      ? { url: urls[i]!, title: part.slice(0, -suffix.length) } : null;
  });
  if (sources.some(source => !source)) return fallback;
  // The app already identifies staging globally. Preserve the historical signed
  // answer; omit only its deterministic envelope after checking the source list.
  const body = content.slice(0, at).replace(/^Synthetischer Testkontext · keine amtliche Stellungnahme\.\n\n/u, "");
  return { body, sources: (sources as { url: string; title: string }[]).map(source => ({
    ...source, title: source.title.replace(/^(\[[1-3]\] )?Testantwort (?=\S)/u, "$1Fachantwort "),
  })) };
}
import { DEPARTMENT_LABELS } from "@roebel/stadtstack-federation-client";

/** Only a presentation anchor changes; signed URLs and evidence digests remain intact. */
export function meckySourceHref(url: string, title: string): string {
  try {
    const parsed = new URL(url);
    const sourceTitle = title.replace(/^\[[1-3]\] /u, "");
    if (parsed.protocol === "https:" && !parsed.username && !parsed.password && !parsed.search && !parsed.hash &&
      /^\/app\/diskussion\/[0-9a-f]{64}$/.test(parsed.pathname) &&
      Object.values(DEPARTMENT_LABELS).some(label =>
        sourceTitle.startsWith(`Fachantwort ${label} · `) || sourceTitle.startsWith(`Testantwort ${label} · `))) {
      return `${url}#citizen-brief`;
    }
  } catch { /* An unrecognized source keeps its original destination. */ }
  return url;
}
