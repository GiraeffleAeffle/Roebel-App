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
  return { body: content.slice(0, at), sources: sources as { url: string; title: string }[] };
}
