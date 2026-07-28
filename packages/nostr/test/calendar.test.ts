import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { KIND_TIME_BASED_EVENT, buildCalendarEvent, parseCalendarEvent } from "../src/calendar";
import { verifyEvent } from "../src/events";
import { deriveNostrSecretKey } from "../src/keys";

const SECRET = deriveNostrSecretKey("0x" + "4a".repeat(65));
const START = 1_785_300_000;

const screening = {
  id: "movie-42",
  title: "Der Vorleser",
  summary: "Kino am Markt, Saal 1",
  start: START,
  location: "Kino am Markt, Röbel",
  labels: ["kino", "fsk-12"],
};

describe("NIP-52 calendar events", () => {
  it("builds a signed, standard time-based event", () => {
    const e = buildCalendarEvent(SECRET, screening, { createdAt: 1 });
    assert.equal(e.kind, KIND_TIME_BASED_EVENT);
    assert.ok(verifyEvent(e));
  });

  it("is REPLACEABLE by source id, so a correction overwrites", () => {
    // The d tag is what makes an edit an edit instead of a duplicate.
    const e = buildCalendarEvent(SECRET, screening, { createdAt: 1 });
    assert.equal(e.tags.find((t) => t[0] === "d")?.[1], "movie-42");

    const corrected = buildCalendarEvent(SECRET, { ...screening, title: "Neuer Titel" }, { createdAt: 2 });
    assert.equal(corrected.tags.find((t) => t[0] === "d")?.[1], "movie-42");
    assert.notEqual(corrected.id, e.id);
  });

  it("round-trips through parse", () => {
    const parsed = parseCalendarEvent(buildCalendarEvent(SECRET, screening, { createdAt: 1 }));
    assert.equal(parsed?.title, "Der Vorleser");
    assert.equal(parsed?.start, START);
    assert.equal(parsed?.location, "Kino am Markt, Röbel");
    assert.deepEqual(parsed?.labels, ["kino", "fsk-12"]);
  });

  it("uses the all-day kind when there is no clock time", () => {
    const e = buildCalendarEvent(SECRET, { ...screening, allDay: true }, { createdAt: 1 });
    assert.equal(e.kind, 31922);
    assert.equal(parseCalendarEvent(e)?.allDay, true);
  });

  it("carries no field it was not given — the payload is the minimum", () => {
    const e = buildCalendarEvent(SECRET, { id: "m", title: "T", start: START }, { createdAt: 1 });
    for (const absent of ["location", "image", "end"]) {
      assert.ok(!e.tags.some((t) => t[0] === absent), `${absent} must not be invented`);
    }
  });

  it("is not confused with an ordinary note", () => {
    assert.equal(parseCalendarEvent({ ...buildCalendarEvent(SECRET, screening), kind: 1 }), null);
  });
});
