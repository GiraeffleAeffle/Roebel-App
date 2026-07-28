import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildWorkspaceTiles,
  filterAvailableTiles,
  type WorkspaceTile,
} from "../src/lib/dashboard/workspace-tiles";

// Files are a native surface now (/arbeitsbereich/dateien), so a tile that
// linked out to Nextcloud would be a second, worse route to the same place.
test("no longer offers a files tile", () => {
  const ids = buildWorkspaceTiles({
    workspaceBaseUrl: "https://cloud.example",
    chatBaseUrl: "https://chat.example",
  }).map((t) => t.id);
  assert.equal(ids.includes("nextcloud"), false);
  assert.equal(ids.includes("chat"), true);
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

test("configured workspace yields the chat tile", () => {
  const visible = filterAvailableTiles(
    buildWorkspaceTiles({ chatBaseUrl: "https://chat.roebel.app" })
  );
  assert.equal(visible.length, 1);
  assert.equal(visible[0].id, "chat");
});

test("the citizen suite covers the openDesk equivalents + the agent workspace", () => {
  assert.deepEqual(
    buildWorkspaceTiles({}).map((t) => t.id),
    ["chat", "mail", "wiki", "video", "project", "agents"]
  );
});

test("each suite member is independently config-gated", () => {
  const visible = filterAvailableTiles(
    buildWorkspaceTiles({
      videoBaseUrl: "https://meet.roebel.app",
      agentsBaseUrl: "https://agents.roebel.app/",
    })
  );
  assert.deepEqual(visible.map((t) => t.id), ["video", "agents"]);
  // trailing slash trimmed on every member
  assert.equal(visible[1].href, "https://agents.roebel.app");
});
