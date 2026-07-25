import { z } from "zod";

export type StoryKind = "business_launch" | "verein_milestone" | "citizen_story" | "craft" | "event_recap" | "other";

export interface StorySubject {
  kind: StoryKind;
  name: string;
  sub_type?: string;
  bio?: string;
  region?: string;
}

export interface ArticleDraft {
  title: string;
  excerpt: string;
  content_html: string;
  category: string;
  tags: string[];
}

export const ARTICLE_DRAFT_SCHEMA = z.object({
  title: z.string().describe("prägnante Überschrift"),
  excerpt: z.string().describe("1-2 Sätze Anrisstext"),
  content_html: z.string().describe("Artikel als HTML (Absätze <p>, Zwischenüberschriften <h2>)"),
  category: z.string().describe("z.B. wirtschaft, vereine, kultur, menschen, sport"),
  tags: z.array(z.string()).describe("2-5 kurze Schlagworte"),
});

export const STORY_INTERVIEW_SYSTEM = [
  "Du bist Mecky, die freundliche Lokalreporterin für Röbel/Müritz.",
  "Du hilfst einer Person oder Organisation, ihre Geschichte zu erzählen, damit die Gemeinschaft sie kennenlernt.",
  "Führe ein warmes Interview: frage nach dem Wer, Was und Warum, nach den Menschen/Gründer:innen dahinter, was neu ist und was sie anbieten.",
  "Stelle immer NUR EINE Frage auf einmal, kurz und neugierig. Antworte auf Deutsch.",
  "Sei ehrlich: erfinde niemals Fakten. Du schreibst später nur das, was dir die Person wirklich erzählt.",
  "Wenn du genug für einen Artikel hast, sag das und schlage vor, den Artikel zu schreiben.",
].join(" ");

export function buildDraftPrompt(subject: StorySubject, transcript: { role: "user" | "assistant"; content: string }[]): string {
  const lines = transcript.map((m) => `${m.role === "user" ? "Erzähler:in" : "Mecky"}: ${m.content}`).join("\n");
  return [
    "## Aufgabe",
    "Schreibe aus dem folgenden Interview einen warmen, faktentreuen Lokal-Artikel für die Röbel-Community.",
    "Nutze NUR Informationen aus dem Interview — erfinde KEINE Fakten, Zitate oder Zahlen.",
    "Schreibe auf Deutsch, in HTML (Absätze <p>, ggf. Zwischenüberschriften <h2>), gut lesbar und persönlich.",
    "Beende den Artikel mit einem kurzen Hinweis in <p><em>…</em></p>: \"Mit Mecky geschrieben.\"",
    "",
    "## Über die Erzähler:in / Organisation",
    `Name: ${subject.name}`,
    `Art: ${subject.kind}${subject.sub_type ? ` (${subject.sub_type})` : ""}`,
    `Region: ${subject.region ?? "Röbel/Müritz"}`,
    subject.bio ? `Kurzbeschreibung: ${subject.bio}` : "",
    "",
    "## Interview",
    lines,
  ].filter(Boolean).join("\n");
}
