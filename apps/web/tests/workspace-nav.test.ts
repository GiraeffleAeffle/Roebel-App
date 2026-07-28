import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { workspaceNav } from "../src/lib/workspace/nav";

const citizen = { isCitizen: true };
const notCitizen = { isCitizen: false };

describe("workspaceNav", () => {
  it("opens with Übersicht, then the native Dateien surface", () => {
    const nav = workspaceNav(citizen);
    assert.deepEqual(
      nav.slice(0, 2).map((i) => i.id),
      ["uebersicht", "dateien"],
    );
  });

  it("routes every entry inside /arbeitsbereich", () => {
    for (const item of workspaceNav(citizen)) {
      assert.match(item.href, /^\/arbeitsbereich/);
    }
  });

  it("labels are German", () => {
    const labels = workspaceNav(citizen).map((i) => i.label);
    assert.deepEqual(labels, ["Übersicht", "Dateien & Dokumente"]);
  });

  // Slice 1 ships exactly two entries. Chat, wiki, projects and the KI
  // workspace stay link-out tiles on the Übersicht until their slice lands, so
  // the nav never advertises a surface that does not exist.
  it("ships only what is built", () => {
    assert.equal(workspaceNav(citizen).length, 2);
    assert.ok(workspaceNav(citizen).every((i) => i.native));
  });
});

// The Dateien surface consumes real storage and is refused server-side for a
// session with no `citizen` group claim. The sidebar showed the link to
// everyone anyway — including the person reading the "Nur für verifizierte
// Bürger" card on the Übersicht one click away.
describe("workspaceNav — the citizen gate", () => {
  it("hides the Dateien entry from a non-citizen", () => {
    assert.deepEqual(
      workspaceNav(notCitizen).map((i) => i.id),
      ["uebersicht"],
    );
  });

  it("still gives a non-citizen the Übersicht, which is where the gate is explained", () => {
    const nav = workspaceNav(notCitizen);
    assert.equal(nav.length, 1);
    assert.equal(nav[0].href, "/arbeitsbereich");
  });

  it("shows it again the moment the viewer is a citizen", () => {
    assert.ok(workspaceNav(citizen).some((i) => i.id === "dateien"));
  });
});
