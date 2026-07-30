/**
 * Minimal HTML → Markdown for NIP-23 long-form content.
 *
 * Articles are written in a rich-text editor and stored as HTML; kind 30023
 * specifies Markdown. This converts the tag set that editor actually emits
 * (headings, paragraphs, emphasis, links, lists, images, blockquotes) and
 * strips everything else — a lossy-but-honest floor, chosen over shipping a
 * full parser: unknown markup degrades to its text content rather than leaking
 * raw HTML into every Nostr reader.
 */

function decodeEntities(text: string): string {
  return text
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'");
}

export function htmlToMarkdown(html: string): string {
  let s = html;

  // Line-shaping first, while tags are still visible.
  s = s.replace(/<br\s*\/?>/gi, "\n");
  s = s.replace(/<\/(p|div|h[1-6]|li|blockquote|ul|ol)>/gi, "\n");

  s = s.replace(/<h1[^>]*>/gi, "\n# ");
  s = s.replace(/<h2[^>]*>/gi, "\n## ");
  s = s.replace(/<h3[^>]*>/gi, "\n### ");
  s = s.replace(/<h[4-6][^>]*>/gi, "\n#### ");
  s = s.replace(/<li[^>]*>/gi, "- ");
  s = s.replace(/<blockquote[^>]*>/gi, "\n> ");

  s = s.replace(/<(strong|b)[^>]*>(.*?)<\/\1>/gis, "**$2**");
  s = s.replace(/<(em|i)[^>]*>(.*?)<\/\1>/gis, "*$2*");
  s = s.replace(/<a[^>]*href="([^"]*)"[^>]*>(.*?)<\/a>/gis, "[$2]($1)");
  s = s.replace(/<img[^>]*src="([^"]*)"[^>]*alt="([^"]*)"[^>]*\/?>/gi, "![$2]($1)");
  s = s.replace(/<img[^>]*src="([^"]*)"[^>]*\/?>/gi, "![]($1)");

  // Everything unhandled degrades to its text content.
  s = s.replace(/<[^>]+>/g, "");

  return decodeEntities(s)
    .split("\n")
    .map((line) => line.replace(/\s+$/, ""))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
