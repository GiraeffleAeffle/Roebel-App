import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ALLOWED_TRANSITIONS,
  isLegalTransition,
  STAGE_MOVERS,
  STAGES,
} from "../src/decisions.js";

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
