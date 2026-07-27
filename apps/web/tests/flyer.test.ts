import assert from "node:assert/strict";
import { test } from "node:test";
import { resolveStyle, FLYER_STYLES, ROEBEL_NAVY } from "../src/lib/flyer/styles";
import { buildCopyPrompt, normalizeCopy, type FlyerCopy } from "../src/lib/flyer/copy";
import { buildFlyerImagePrompt, buildFlyerEditPrompt } from "../src/lib/flyer/image-prompt";

const sampleCopy: FlyerCopy = {
  headline: "Sommerfest am See",
  subheadline: "Der Verein lädt ein",
  date_line: "Samstag, 12. Juli 2026",
  time_line: "ab 14:00 Uhr",
  place_line: "Marktplatz Röbel",
  body: "Livemusik, Kuchenbasar und Spiele für Groß und Klein.",
  cta: "Komm vorbei!",
  footer: "Heimatverein Röbel e.V.",
};

test("resolveStyle returns the matching preset", () => {
  assert.equal(resolveStyle("festlich").id, "festlich");
  assert.equal(resolveStyle("amtlich").id, "amtlich");
});

test("resolveStyle falls back to modern for unknown/empty", () => {
  assert.equal(resolveStyle("does-not-exist").id, "modern");
  assert.equal(resolveStyle(null).id, "modern");
  assert.equal(resolveStyle(undefined).id, "modern");
});

test("every style carries the Röbel navy in its palette", () => {
  for (const s of FLYER_STYLES) {
    assert.ok(s.palette.includes(ROEBEL_NAVY), `${s.id} missing navy`);
  }
});

test("buildCopyPrompt includes brief, event facts, and the style", () => {
  const style = resolveStyle("festlich");
  const prompt = buildCopyPrompt(
    "Wir feiern unser Vereinsjubiläum.",
    { title: "50 Jahre Heimatverein", date: "12.07.2026", location: "Marktplatz" },
    style,
  );
  assert.ok(prompt.includes("Vereinsjubiläum"));
  assert.ok(prompt.includes("50 Jahre Heimatverein"));
  assert.ok(prompt.includes("Marktplatz"));
  assert.ok(prompt.includes(style.label));
});

test("buildCopyPrompt omits event block when no event", () => {
  const prompt = buildCopyPrompt("Nur ein Briefing.", null, resolveStyle("modern"));
  assert.ok(!prompt.includes("Event-Daten"));
});

test("normalizeCopy trims and clamps overly long fields", () => {
  const long = "x".repeat(500);
  const out = normalizeCopy({ headline: "  Hallo  ", body: long });
  assert.equal(out.headline, "Hallo");
  assert.ok(out.body.length <= 400);
  assert.equal(out.cta, ""); // missing field → empty string
});

test("buildFlyerImagePrompt typesets every non-empty field", () => {
  const prompt = buildFlyerImagePrompt(sampleCopy, resolveStyle("modern"));
  for (const v of Object.values(sampleCopy)) {
    assert.ok(prompt.includes(v), `prompt missing "${v}"`);
  }
});

test("buildFlyerImagePrompt carries style, palette and the legibility guard", () => {
  const style = resolveStyle("plakativ");
  const prompt = buildFlyerImagePrompt(sampleCopy, style);
  assert.ok(prompt.includes(style.direction.slice(0, 12)));
  assert.ok(prompt.includes(ROEBEL_NAVY));
  assert.ok(/legible/i.test(prompt));
  assert.ok(/no lorem ipsum|garbled|do not invent/i.test(prompt));
});

test("buildFlyerImagePrompt omits empty fields (no empty quotes)", () => {
  const copy: FlyerCopy = { ...sampleCopy, time_line: "", footer: "" };
  const prompt = buildFlyerImagePrompt(copy, resolveStyle("modern"));
  assert.ok(!prompt.includes('Time: ""'));
  assert.ok(!prompt.includes('Footer (small, at the bottom): ""'));
});

test("buildFlyerImagePrompt adds reference guidance only when hasReference", () => {
  const withRef = buildFlyerImagePrompt(sampleCopy, resolveStyle("modern"), { hasReference: true });
  const withoutRef = buildFlyerImagePrompt(sampleCopy, resolveStyle("modern"));
  assert.ok(/reference image/i.test(withRef));
  assert.ok(!/reference image/i.test(withoutRef));
});

test("buildFlyerEditPrompt carries the instruction and a preserve-everything-else rule", () => {
  const prompt = buildFlyerEditPrompt("Datum auf 19. Juli ändern");
  assert.ok(prompt.includes("Datum auf 19. Juli ändern"));
  assert.ok(/Keep everything else identical/i.test(prompt));
});

test("buildFlyerEditPrompt trims the instruction", () => {
  const prompt = buildFlyerEditPrompt("  mehr Kontrast  ");
  assert.ok(prompt.includes("Apply exactly this change: mehr Kontrast"));
});

test("buildFlyerEditPrompt never replays stored copy (a 2nd edit must not revert the 1st)", () => {
  const prompt = buildFlyerEditPrompt("Hintergrund dunkler");
  // The stored copy reflects the ORIGINAL text; restating it would undo prior edits.
  assert.ok(!prompt.includes(sampleCopy.date_line));
  assert.ok(!prompt.includes(sampleCopy.headline));
});

test("buildCopyPrompt includes enriched event facts (category, price, website, organizer)", () => {
  const prompt = buildCopyPrompt(
    "",
    {
      title: "Sommerfest",
      category: "Fest",
      ticket_price: 0,
      website_url: "https://verein.de",
      organizer_name: "Heimatverein",
    },
    resolveStyle("festlich"),
  );
  assert.ok(prompt.includes("Fest"));
  assert.ok(prompt.includes("Eintritt frei")); // ticket_price 0 → "Eintritt frei"
  assert.ok(prompt.includes("https://verein.de"));
  assert.ok(prompt.includes("Heimatverein"));
});
