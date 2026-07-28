import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { workspaceNav } from "../src/lib/workspace/nav";

describe("workspaceNav", () => {
  it("opens with Übersicht, then the native Dateien surface", () => {
    const nav = workspaceNav();
    assert.deepEqual(
      nav.slice(0, 2).map((i) => i.id),
      ["uebersicht", "dateien"],
    );
  });

  it("routes every entry inside /arbeitsbereich", () => {
    for (const item of workspaceNav()) {
      assert.match(item.href, /^\/arbeitsbereich/);
    }
  });

  it("labels are German", () => {
    const labels = workspaceNav().map((i) => i.label);
    assert.deepEqual(labels, ["Übersicht", "Dateien & Dokumente"]);
  });

  // Slice 1 ships exactly two entries. Chat, wiki, projects and the KI
  // workspace stay link-out tiles on the Übersicht until their slice lands, so
  // the nav never advertises a surface that does not exist.
  it("ships only what is built", () => {
    assert.equal(workspaceNav().length, 2);
    assert.ok(workspaceNav().every((i) => i.native));
  });
});
