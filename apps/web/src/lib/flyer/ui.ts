// Client-safe flyer UI helpers shared by the standalone tool and the
// event-specific generator (download, print-to-A4-PDF, editable copy fields).
// No server-only / AI imports — safe in client components.

import type { FlyerCopy } from "./copy";

export async function downloadImage(url: string, filename: string): Promise<void> {
  try {
    const res = await fetch(url);
    const blob = await res.blob();
    const objectUrl = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = objectUrl;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(objectUrl);
  } catch {
    window.open(url, "_blank");
  }
}

export function slugForFile(s: string): string {
  const cleaned = (s || "flyer")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  return cleaned || "flyer";
}

/** Open a print-ready A4 view — the browser's "Save as PDF" gives a true A4 file. */
export function printFlyer(url: string): void {
  const w = window.open("", "_blank");
  if (!w) {
    window.open(url, "_blank");
    return;
  }
  w.document.write(
    `<!doctype html><html><head><title>Flyer drucken</title><style>` +
      `@page{size:A4;margin:0}html,body{margin:0;height:100%;background:#fff}` +
      `img{width:100%;height:100vh;object-fit:contain;display:block}</style></head>` +
      `<body><img src="${url}" onload="window.focus();window.print()" /></body></html>`,
  );
  w.document.close();
}

export const COPY_FIELDS: { key: keyof FlyerCopy; label: string; multiline?: boolean }[] = [
  { key: "headline", label: "Überschrift" },
  { key: "subheadline", label: "Unterzeile" },
  { key: "date_line", label: "Datum" },
  { key: "time_line", label: "Uhrzeit" },
  { key: "place_line", label: "Ort" },
  { key: "body", label: "Text", multiline: true },
  { key: "cta", label: "Handlungsaufruf" },
  { key: "footer", label: "Fußzeile (Veranstalter / Kontakt)" },
];
