// Flyer copy: the structured German text an org edits before rendering. Pure
// prompt builder + normalizer (unit-testable); the LLM call lives in the action.
//
// Schema note: @ai-sdk/anthropic rejects numeric min/max constraints in JSON
// schema (400) — this schema is all strings, and we clamp lengths in code via
// `normalizeCopy` rather than in the schema.

import { z } from "zod";
import type { FlyerStyle } from "./styles";

/** Optional event context that prefills the brief (all reliable event facts). */
export interface FlyerEventContext {
  title: string;
  date?: string | null;
  time?: string | null;
  end_time?: string | null;
  location?: string | null;
  description?: string | null;
  category?: string | null;
  ticket_price?: number | null;
  website_url?: string | null;
  organizer_name?: string | null;
}

/** The editable, structured flyer text. Empty string = "not on the flyer". */
export interface FlyerCopy {
  headline: string;
  subheadline: string;
  date_line: string;
  time_line: string;
  place_line: string;
  body: string;
  cta: string;
  footer: string;
}

export const flyerCopySchema = z.object({
  headline: z.string().describe("Kurze, kraftvolle Überschrift (max. ~6 Wörter)."),
  subheadline: z.string().describe("Ergänzende Unterzeile, kann leer sein."),
  date_line: z.string().describe("Datum, z. B. „Samstag, 12. Juli 2026“. Leer wenn unbekannt."),
  time_line: z.string().describe("Uhrzeit, z. B. „ab 14:00 Uhr“. Leer wenn unbekannt."),
  place_line: z.string().describe("Ort, z. B. „Marktplatz Röbel“. Leer wenn unbekannt."),
  body: z.string().describe("2–4 kurze Sätze Fließtext, die zum Kommen einladen."),
  cta: z.string().describe("Handlungsaufruf, z. B. „Komm vorbei!“ oder „Jetzt anmelden“."),
  footer: z.string().describe("Veranstalter + Kontakt/Website, kann leer sein."),
});

export const FLYER_COPY_SYSTEM = `Du bist Meckys Grafik-Texter für die Stadt Röbel/Müritz.
Du schreibst den Text für einen A4-Flyer einer lokalen Organisation (Verein, Betrieb, Stadt).
Regeln:
- Sprache: Deutsch, herzlich, klar, einladend — nie werblich-übertrieben, nie floskelhaft.
- Fasse dich kurz: ein Flyer lebt von wenig, gut gesetztem Text.
- Erfinde KEINE Fakten (Datum, Ort, Preis). Wenn etwas nicht im Briefing steht, lass das Feld leer.
- Keine Emojis im gedruckten Flyer-Text.
- Gib die Felder exakt gemäß Schema zurück.`;

function line(label: string, value?: string | null): string {
  const v = (value ?? "").trim();
  return v ? `${label}: ${v}` : "";
}

/** Pure: assemble the copy-drafting prompt from the brief, optional event, and style. */
export function buildCopyPrompt(
  brief: string,
  event: FlyerEventContext | null,
  style: FlyerStyle,
): string {
  const parts: string[] = [];
  parts.push(`Briefing der Organisation:\n${brief.trim() || "(kein Freitext — nutze die Event-Daten)"}`);

  if (event) {
    const price =
      event.ticket_price != null
        ? event.ticket_price === 0
          ? "Eintritt frei"
          : `${event.ticket_price} €`
        : null;
    const evLines = [
      line("Titel", event.title),
      line("Datum", event.date),
      line("Uhrzeit", event.time),
      line("Ende", event.end_time),
      line("Ort", event.location),
      line("Kategorie", event.category),
      line("Eintritt", price),
      line("Veranstalter", event.organizer_name),
      line("Website", event.website_url),
      line("Beschreibung", event.description),
    ].filter(Boolean);
    if (evLines.length) {
      parts.push(`Event-Daten (verlässliche Fakten — hier keine Erfindungen):\n${evLines.join("\n")}`);
    }
  }

  parts.push(`Gewünschter Stil: ${style.label} — ${style.description}`);
  parts.push(
    "Schreibe den Flyer-Text. Halte Überschrift und Unterzeile knapp, setze Datum/Uhrzeit/Ort nur wenn bekannt, und formuliere einen klaren Handlungsaufruf.",
  );
  return parts.join("\n\n");
}

function clamp(s: unknown, max: number): string {
  const v = typeof s === "string" ? s.trim() : "";
  return v.length > max ? v.slice(0, max).trim() : v;
}

/** Clamp field lengths (schema has no min/max — the anthropic constraint). */
export function normalizeCopy(raw: Partial<FlyerCopy>): FlyerCopy {
  return {
    headline: clamp(raw.headline, 80),
    subheadline: clamp(raw.subheadline, 120),
    date_line: clamp(raw.date_line, 80),
    time_line: clamp(raw.time_line, 80),
    place_line: clamp(raw.place_line, 120),
    body: clamp(raw.body, 400),
    cta: clamp(raw.cta, 80),
    footer: clamp(raw.footer, 160),
  };
}
