import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildWorkspaceTiles,
  filterAvailableTiles,
  nativeFilesEnabled,
  type WorkspaceTile,
} from "../src/lib/dashboard/workspace-tiles";

// Files became a native surface (/arbeitsbereich/dateien), so once that surface
// is live a link-out tile is a second, worse route to the same place. But this
// builder briefly dropped the tile UNCONDITIONALLY, which removed the working
// route on every deployment where the native surface's env vars are not set —
// merge day included. The tile is therefore conditional, and defaults to
// PRESENT.
test("keeps the files tile while the native surface is not live", () => {
  const ids = buildWorkspaceTiles({
    workspaceBaseUrl: "https://cloud.example",
    chatBaseUrl: "https://chat.example",
  }).map((t) => t.id);
  assert.equal(ids.includes("nextcloud"), true);
  assert.equal(ids.includes("chat"), true);
});

test("the files tile is the FIRST tile, where it has always been", () => {
  const tiles = buildWorkspaceTiles({ workspaceBaseUrl: "https://cloud.example" });
  assert.equal(tiles[0].id, "nextcloud");
  assert.equal(tiles[0].label, "Dokumente & Dateien");
  assert.equal(tiles[0].icon, "cloud");
  assert.equal(tiles[0].href, "https://cloud.example");
  assert.equal(tiles[0].configured, true);
});

test("drops the files tile once the native surface IS live", () => {
  const ids = buildWorkspaceTiles({
    nativeFilesEnabled: true,
    workspaceBaseUrl: "https://cloud.example",
    chatBaseUrl: "https://chat.example",
  }).map((t) => t.id);
  assert.equal(ids.includes("nextcloud"), false);
  assert.equal(ids.includes("chat"), true);
});

// The default has to fail toward keeping the link-out: a flag that wrongly
// says "not live" costs a duplicate tile; one that wrongly says "live" costs
// the citizen every route to their files.
test("an absent or unparseable flag means NOT live, so the tile survives", () => {
  for (const raw of [undefined, null, "", "  ", "0", "false", "yes", "no", "TRUE!"]) {
    assert.equal(nativeFilesEnabled(raw), false, `for ${JSON.stringify(raw)}`);
    assert.ok(
      buildWorkspaceTiles({
        nativeFilesEnabled: nativeFilesEnabled(raw),
        workspaceBaseUrl: "https://cloud.example",
      }).some((t) => t.id === "nextcloud"),
    );
  }
});

test("only an explicit 1 / true flips the flag, case and whitespace tolerant", () => {
  for (const raw of ["1", "true", "TRUE", " True ", "\ttrue\n"]) {
    assert.equal(nativeFilesEnabled(raw), true, `for ${JSON.stringify(raw)}`);
  }
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
  // Still true, and for the right reason: the files tile is PRESENT in the
  // list but has no base URL, so filterAvailableTiles hides it like any other
  // unconfigured member.
  assert.equal(filterAvailableTiles(buildWorkspaceTiles({})).length, 0);
  assert.ok(buildWorkspaceTiles({}).some((t) => t.id === "nextcloud"));
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
    ["nextcloud", "chat", "mail", "wiki", "video", "project", "agents"]
  );
  assert.deepEqual(
    buildWorkspaceTiles({ nativeFilesEnabled: true }).map((t) => t.id),
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
