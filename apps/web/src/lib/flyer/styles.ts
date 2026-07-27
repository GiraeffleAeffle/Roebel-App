// Curated flyer style presets. Each is an image-model style direction + palette.
// Röbel navy is the default brand colour (#00498B, per the 2026-06-27 rebrand).
// Kept pure/data-only so the render prompt builder stays unit-testable.

export const ROEBEL_NAVY = "#00498B";

export interface FlyerStyle {
  id: string;
  label: string; // German UI label
  description: string; // short German helper for the picker
  direction: string; // style direction injected into the image prompt (English — model-facing)
  palette: string; // palette direction injected into the image prompt
}

export const FLYER_STYLES: FlyerStyle[] = [
  {
    id: "modern",
    label: "Modern & Klar",
    description: "Viel Weißraum, klare Typografie, seriös.",
    direction:
      "Modern minimalist event poster. Generous white space, a strong clear sans-serif type hierarchy, a single accent colour, clean grid layout, no clutter.",
    palette: `Primary deep navy ${ROEBEL_NAVY}, white background, one warm accent (amber/orange) used sparingly.`,
  },
  {
    id: "festlich",
    label: "Festlich",
    description: "Warm und einladend, für Feste & Feiern.",
    direction:
      "Warm, inviting community-festival poster. Friendly rounded shapes, subtle celebratory motifs (bunting, small confetti or florals) that never overlap the text, cheerful but tasteful.",
    palette: `Deep navy ${ROEBEL_NAVY} headings on a warm cream background, with warm red and golden-yellow festive accents.`,
  },
  {
    id: "amtlich",
    label: "Amtlich",
    description: "Seriös und behördlich, für offizielle Aushänge.",
    direction:
      "Official municipal notice. Restrained, formal, symmetrical, authoritative. A thin ruled frame, a clear title bar, structured blocks of information. No decorative illustration.",
    palette: `Navy ${ROEBEL_NAVY} and white only, crisp and official, high legibility.`,
  },
  {
    id: "plakativ",
    label: "Plakativ",
    description: "Kräftig und auffällig, für maximale Aufmerksamkeit.",
    direction:
      "Bold, high-impact poster. Oversized headline, strong colour blocks, high contrast, dynamic composition that grabs attention from across a room.",
    palette: `High-contrast navy ${ROEBEL_NAVY} and bright warm accent (orange/red) on white, bold and punchy.`,
  },
];

const DEFAULT_STYLE = FLYER_STYLES[0]; // modern

export function resolveStyle(id: string | null | undefined): FlyerStyle {
  return FLYER_STYLES.find((s) => s.id === id) ?? DEFAULT_STYLE;
}
