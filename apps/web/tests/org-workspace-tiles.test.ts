import assert from "node:assert/strict";
import { test } from "node:test";
import { buildOrgWorkspaceTiles } from "../src/lib/dashboard/org-workspace-tiles";
import { filterAvailableTiles } from "../src/lib/dashboard/workspace-tiles";

const ORG = { id: "org-1", slug: "roebel-ev" };

test("no org context yields no tiles", () => {
  assert.deepEqual(buildOrgWorkspaceTiles({ org: null }), []);
});

test("builds the full openDesk-equivalent suite for an org, in order", () => {
  const tiles = buildOrgWorkspaceTiles({
    workspaceBaseUrl: "https://cloud.roebel.app",
    chatBaseUrl: "https://chat.roebel.app",
    org: ORG,
  });
  assert.deepEqual(
    tiles.map((t) => t.id),
    ["org-nextcloud", "org-chat", "org-mail", "org-wiki", "org-video", "org-project", "org-agents"]
  );
  assert.equal(tiles[0].label, "Dateien & Dokumente");
  assert.equal(tiles[1].label, "Team-Chat");
  assert.equal(tiles[1].icon, "messages");
});

test("only configured suite members are visible (each tile is independently gated)", () => {
  const visible = filterAvailableTiles(
    buildOrgWorkspaceTiles({
      workspaceBaseUrl: "https://cloud.roebel.app",
      mailBaseUrl: "https://mail.roebel.app",
      org: ORG,
    })
  );
  assert.deepEqual(visible.map((t) => t.id), ["org-nextcloud", "org-mail"]);
  assert.equal(visible[1].href, "https://mail.roebel.app");
});

test("agent workspace tile lights up when configured (humans + AI agents, one space)", () => {
  const agents = buildOrgWorkspaceTiles({
    agentsBaseUrl: "https://agents.roebel.app/",
    org: ORG,
  }).find((t) => t.id === "org-agents");
  assert.ok(agents);
  assert.equal(agents.configured, true);
  assert.equal(agents.href, "https://agents.roebel.app");
  assert.equal(agents.icon, "agents");
});

test("files tile is unconfigured without a workspace base url", () => {
  const files = buildOrgWorkspaceTiles({
    chatBaseUrl: "https://chat.roebel.app",
    org: ORG,
  }).find((t) => t.id === "org-nextcloud");
  assert.ok(files);
  assert.equal(files.requiresConfig, true);
  assert.equal(files.configured, false);
  assert.equal(files.href, "");
});

test("chat tile is unconfigured without a chat base url", () => {
  const chat = buildOrgWorkspaceTiles({
    workspaceBaseUrl: "https://cloud.roebel.app",
    org: ORG,
  }).find((t) => t.id === "org-chat");
  assert.ok(chat);
  assert.equal(chat.requiresConfig, true);
  assert.equal(chat.configured, false);
  assert.equal(chat.href, "");
});

test("configured tiles carry trimmed base-url hrefs", () => {
  const tiles = buildOrgWorkspaceTiles({
    workspaceBaseUrl: "https://cloud.roebel.app/",
    chatBaseUrl: "https://chat.roebel.app/",
    org: ORG,
  });
  const files = tiles.find((t) => t.id === "org-nextcloud");
  const chat = tiles.find((t) => t.id === "org-chat");
  assert.equal(files?.href, "https://cloud.roebel.app");
  assert.equal(chat?.href, "https://chat.roebel.app");
  assert.equal(files?.configured, true);
  assert.equal(chat?.configured, true);
});

test("filterAvailableTiles hides the tile whose base url is unset", () => {
  const visible = filterAvailableTiles(
    buildOrgWorkspaceTiles({
      workspaceBaseUrl: "https://cloud.roebel.app",
      org: ORG,
    })
  );
  assert.deepEqual(
    visible.map((t) => t.id),
    ["org-nextcloud"]
  );
});

test("nothing configured yields no visible tiles", () => {
  assert.equal(
    filterAvailableTiles(buildOrgWorkspaceTiles({ org: ORG })).length,
    0
  );
});
