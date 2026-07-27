// Pure builders for the flyer image prompts (no I/O, no server-only) so they
// stay unit-testable. The kie.ai / Nano Banana 2 Lite call lives in render.ts.

import type { FlyerCopy } from "./copy";
import type { FlyerStyle } from "./styles";

function textLine(label: string, value: string): string {
  const v = value.trim();
  return v ? `- ${label}: "${v}"` : "";
}

/**
 * Build the image prompt: names every non-empty copy field as text to
 * typeset, the style direction + palette, A4 portrait layout, and an explicit
 * "render all text crisply and correctly, no garbled/placeholder text" guard.
 *
 * When `hasReference` is set (a logo / photo is passed to the edit endpoint),
 * append guidance to incorporate it tastefully without distorting it or the text.
 */
export function buildFlyerImagePrompt(
  copy: FlyerCopy,
  style: FlyerStyle,
  options?: { hasReference?: boolean },
): string {
  const textBlock = [
    textLine("Headline (largest, dominant)", copy.headline),
    textLine("Subheadline", copy.subheadline),
    textLine("Date", copy.date_line),
    textLine("Time", copy.time_line),
    textLine("Place", copy.place_line),
    textLine("Body", copy.body),
    textLine("Call to action (make it stand out, button-like)", copy.cta),
    textLine("Footer (small, at the bottom)", copy.footer),
  ]
    .filter(Boolean)
    .join("\n");

  return [
    "Design a print-ready A4 portrait event/announcement poster (flyer).",
    `Visual style: ${style.direction}`,
    `Colour palette: ${style.palette}`,
    "",
    "Typeset EXACTLY this German text — do not translate, do not invent extra text, do not add lorem ipsum, keep every character spelled correctly and fully legible:",
    textBlock,
    "",
    "Layout rules: clear top-to-bottom hierarchy with the headline dominant; group date, time and place into one easily scannable info block; the call to action must stand out; leave comfortable print margins; text must never be cropped, warped, or overlapped by decoration.",
    "This is a real flyer a small-town organisation will print — it must look clean, trustworthy and legible, not like abstract AI art.",
    options?.hasReference
      ? "Incorporate the provided reference image (the organisation's logo or an event photo) tastefully — keep its proportions, do not distort it, and never let it cover or reduce the legibility of the text."
      : "",
  ]
    .filter(Boolean)
    .join("\n");
}

/**
 * Build the prompt for editing an EXISTING flyer: the current flyer is passed
 * as the reference image and the model applies one requested change while
 * preserving everything else.
 */
export function buildFlyerEditPrompt(instruction: string, copy?: FlyerCopy): string {
  const keepText = copy
    ? [
        textLine("Headline", copy.headline),
        textLine("Date", copy.date_line),
        textLine("Time", copy.time_line),
        textLine("Place", copy.place_line),
        textLine("Call to action", copy.cta),
      ]
        .filter(Boolean)
        .join("\n")
    : "";

  return [
    "Edit the provided A4 portrait flyer image.",
    `Apply exactly this change: ${instruction.trim()}`,
    "",
    "Keep everything else identical — the overall layout, style, colours, imagery and all remaining text must stay as they are. Do not re-invent the design, do not translate anything, and do not add extra text.",
    keepText
      ? `These German strings must remain present and correctly spelled unless the requested change explicitly alters them:\n${keepText}`
      : "",
    "All text must stay crisp, correctly spelled and fully legible; keep comfortable print margins for A4.",
  ]
    .filter(Boolean)
    .join("\n");
}
