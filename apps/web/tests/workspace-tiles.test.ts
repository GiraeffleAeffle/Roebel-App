import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildWorkspaceTiles,
  filterAvailableTiles,
  type WorkspaceTile,
} from "../src/lib/dashboard/workspace-tiles";

test("nextcloud tile is unconfigured when no base url", () => {
  const nc = buildWorkspaceTiles({}).find((t) => t.id === "nextcloud");
  assert.ok(nc);
  assert.equal(nc.requiresConfig, true);
  assert.equal(nc.configured, false);
  assert.equal(nc.href, "");
});

test("nextcloud tile lights up with a base url (trailing slash trimmed)", () => {
  const nc = buildWorkspaceTiles({
    workspaceBaseUrl: "https://cloud.roebel.app/",
  }).find((t) => t.id === "nextcloud");
  assert.ok(nc);
  assert.equal(nc.configured, true);
  assert.equal(nc.href, "https://cloud.roebel.app");
});

test("filter hides requiresConfig tiles that are unconfigured", () => {
  const tiles: WorkspaceTile[] = [
    { id: "a", label: "A", icon: "cloud", href: "", requiresConfig: true, configured: false },
    { id: "b", label: "B", icon: "cloud", href: "https://b", requiresConfig: true, configured: true },
    { id: "c", label: "C", icon: "cloud", href: "/c", requiresConfig: false, configured: true },
  ];
  assert.deepEqual(filterAvailableTiles(tiles).map((t) => t.id), ["b", "c"]);
});

test("unconfigured workspace yields no visible tiles", () => {
  assert.equal(filterAvailableTiles(buildWorkspaceTiles({})).length, 0);
});

test("configured workspace yields the nextcloud tile", () => {
  const visible = filterAvailableTiles(
    buildWorkspaceTiles({ workspaceBaseUrl: "https://cloud.roebel.app" })
  );
  assert.equal(visible.length, 1);
  assert.equal(visible[0].id, "nextcloud");
});
