import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ALLOWED_TRANSITIONS,
  isLegalTransition,
  STAGE_MOVERS,
  STAGES,
  DECISION_KINDS,
  headAddress,
  safeParseTransition,
  validateTransitionTrail,
} from "../src/decisions.js";

const PK = "a".repeat(64);
const HEAD = headAddress(PK, "42");

function transition(over: Partial<{ tags: string[][]; kind: number; content: string; created_at: number }>) {
  return {
    kind: DECISION_KINDS.transition,
    tags: [["a", HEAD, "", "proposal"], ["from", "idee"], ["to", "entwurf"]],
    content: "Vollständig: Problem, Vorschlag, Betroffene benannt.",
    created_at: 1753970000,
    ...over,
  };
}

test("the lifecycle has exactly the ten spec stages", () => {
  assert.deepEqual(
    [...STAGES],
    ["idee", "entwurf", "diskussion", "meinungsbild", "beschlussvorlage",
     "beschlossen", "abgelehnt", "umgesetzt", "ruhend", "zurueckgezogen"],
  );
});

test("the happy path is legal hop by hop", () => {
  const path = ["idee", "entwurf", "diskussion", "meinungsbild",
                "beschlussvorlage", "beschlossen", "umgesetzt"];
  for (let i = 0; i < path.length - 1; i++) {
    assert.equal(isLegalTransition(path[i], path[i + 1]), true, `${path[i]} → ${path[i + 1]}`);
  }
});

test("stage-skipping and resurrection are illegal", () => {
  assert.equal(isLegalTransition("entwurf", "beschlossen"), false);
  assert.equal(isLegalTransition("idee", "beschlussvorlage"), false);
  // terminal stages have no exits
  assert.deepEqual(ALLOWED_TRANSITIONS["abgelehnt"], []);
  assert.deepEqual(ALLOWED_TRANSITIONS["umgesetzt"], []);
  assert.deepEqual(ALLOWED_TRANSITIONS["zurueckgezogen"], []);
});

test("parking and revival: ruhend is exited only via entwurf or withdrawal", () => {
  assert.deepEqual(ALLOWED_TRANSITIONS["ruhend"], ["entwurf", "zurueckgezogen"]);
});

test("unknown stages are never legal", () => {
  assert.equal(isLegalTransition("idee", "banana"), false);
  assert.equal(isLegalTransition("banana", "entwurf"), false);
});

test("who may move a proposal into each stage matches spec §2", () => {
  assert.deepEqual(STAGE_MOVERS["entwurf"], ["editor-agent"]);
  assert.deepEqual(STAGE_MOVERS["diskussion"], ["author"]);
  assert.deepEqual(STAGE_MOVERS["meinungsbild"], ["facilitator"]);
  assert.deepEqual(STAGE_MOVERS["beschlussvorlage"], ["implementer"]);
  assert.deepEqual(STAGE_MOVERS["beschlossen"], ["body-mirror"]);
  assert.deepEqual(STAGE_MOVERS["abgelehnt"], ["body-mirror"]);
  assert.deepEqual(STAGE_MOVERS["umgesetzt"], ["implementer"]);
  assert.deepEqual(STAGE_MOVERS["ruhend"], ["editor-agent"]);
  assert.deepEqual(STAGE_MOVERS["zurueckgezogen"], ["author"]);
  assert.deepEqual(STAGE_MOVERS["idee"], []); // initial stage — nothing transitions into it
});

test("kind numbers are the spec's provisional set, now claimed", () => {
  assert.deepEqual(DECISION_KINDS, {
    head: 32100, transition: 2100, meeting: 32103,
    meinungsbild: 32104, impact: 32105, cycle: 32106,
  });
});

test("headAddress builds the canonical a-tag address", () => {
  assert.equal(HEAD, `32100:${PK}:proposal:42`);
});

test("a well-formed transition parses", () => {
  const r = safeParseTransition(transition({}));
  assert.equal(r.ok, true);
  if (r.ok) {
    assert.equal(r.value.head, HEAD);
    assert.equal(r.value.from, "idee");
    assert.equal(r.value.to, "entwurf");
    assert.equal(r.value.notice, null);
    assert.equal(r.value.reason, "Vollständig: Problem, Vorschlag, Betroffene benannt.");
  }
});

test("wrong kind, missing head ref, or unknown stage all fail", () => {
  assert.equal(safeParseTransition(transition({ kind: 1 })).ok, false);
  assert.equal(safeParseTransition(transition({ tags: [["from", "idee"], ["to", "entwurf"]] })).ok, false);
  assert.equal(safeParseTransition(transition({ tags: [["a", HEAD, "", "proposal"], ["from", "idee"], ["to", "banana"]] })).ok, false);
});

test("an illegal hop fails even when both stages exist", () => {
  const r = safeParseTransition(transition({ tags: [["a", HEAD, "", "proposal"], ["from", "entwurf"], ["to", "beschlossen"]] }));
  assert.equal(r.ok, false);
});

test("two head refs are ambiguous and fail", () => {
  const other = headAddress("b".repeat(64), "7");
  const r = safeParseTransition(transition({
    tags: [["a", HEAD, "", "proposal"], ["a", other, "", "proposal"], ["from", "idee"], ["to", "entwurf"]],
  }));
  assert.equal(r.ok, false);
});

test("beschlossen without a civic-notice citation fails; with one it passes", () => {
  const base = [["a", HEAD, "", "proposal"], ["from", "beschlussvorlage"], ["to", "beschlossen"]];
  assert.equal(safeParseTransition(transition({ tags: base })).ok, false);
  const notice = ["a", `32102:${PK}:alert:9`, "", "notice"];
  const r = safeParseTransition(transition({ tags: [...base, notice] }));
  assert.equal(r.ok, true);
  if (r.ok) assert.equal(r.value.notice, `32102:${PK}:alert:9`);
});

test("abgelehnt requires the citation too", () => {
  const base = [["a", HEAD, "", "proposal"], ["from", "beschlussvorlage"], ["to", "abgelehnt"]];
  assert.equal(safeParseTransition(transition({ tags: base })).ok, false);
});

function hop(from: string, to: string, at: number, extra: string[][] = []) {
  return {
    kind: DECISION_KINDS.transition,
    tags: [["a", HEAD, "", "proposal"], ["from", from], ["to", to], ...extra],
    content: "",
    created_at: at,
  };
}
const NOTICE = ["a", `32102:${PK}:beschluss:1`, "", "notice"];

test("an empty trail is a proposal at idee", () => {
  assert.deepEqual(validateTransitionTrail([]), { ok: true, stage: "idee", head: null });
});

test("a full happy-path trail lands on umgesetzt, order-independent input", () => {
  const trail = [
    hop("beschlussvorlage", "beschlossen", 500, [NOTICE]),
    hop("idee", "entwurf", 100),
    hop("beschlossen", "umgesetzt", 600),
    hop("diskussion", "meinungsbild", 300),
    hop("entwurf", "diskussion", 200),
    hop("meinungsbild", "beschlussvorlage", 400),
  ];
  assert.deepEqual(validateTransitionTrail(trail), { ok: true, stage: "umgesetzt", head: HEAD });
});

test("a trail must depart from idee", () => {
  const r = validateTransitionTrail([hop("entwurf", "diskussion", 100)]);
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.index, 0);
});

test("a broken chain reports the offending index after sorting", () => {
  const r = validateTransitionTrail([
    hop("idee", "entwurf", 100),
    hop("diskussion", "meinungsbild", 200), // from ≠ current stage (entwurf)
  ]);
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.index, 1);
});

test("a malformed event fails at its index", () => {
  const bad = { ...hop("idee", "entwurf", 100), kind: 1 };
  const r = validateTransitionTrail([bad]);
  assert.equal(r.ok, false);
  if (!r.ok) assert.match(r.error, /expected kind/);
});

test("mixed heads are one trail too many", () => {
  const other = {
    kind: DECISION_KINDS.transition,
    tags: [["a", headAddress("b".repeat(64), "7"), "", "proposal"], ["from", "idee"], ["to", "entwurf"]],
    content: "",
    created_at: 200,
  };
  const r = validateTransitionTrail([hop("idee", "entwurf", 100), other]);
  assert.equal(r.ok, false);
});
