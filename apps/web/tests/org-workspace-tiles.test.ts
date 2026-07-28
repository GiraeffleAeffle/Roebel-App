import assert from "node:assert/strict";
import { test } from "node:test";
import { buildOrgWorkspaceTiles } from "../src/lib/dashboard/org-workspace-tiles";
import { filterAvailableTiles } from "../src/lib/dashboard/workspace-tiles";

const ORG = { id: "org-1", slug: "roebel-ev" };

test("no org context yields no tiles", () => {
  assert.deepEqual(buildOrgWorkspaceTiles({ org: null }), []);
});

// Files are a native surface now (/arbeitsbereich/dateien), so a tile that
// linked out to Nextcloud would be a second, worse route to the same place.
test("no longer offers a files tile", () => {
  const ids = buildOrgWorkspaceTiles({
    workspaceBaseUrl: "https://cloud.example",
    chatBaseUrl: "https://chat.example",
    org: { id: "acc-7", slug: "feuerwehr" },
  }).map((t) => t.id);
  assert.equal(ids.includes("org-nextcloud"), false);
  assert.equal(ids.includes("org-chat"), true);
});

test("builds the openDesk-equivalent suite for an org, in order", () => {
  const tiles = buildOrgWorkspaceTiles({
    workspaceBaseUrl: "https://cloud.roebel.app",
    chatBaseUrl: "https://chat.roebel.app",
    org: ORG,
  });
  assert.deepEqual(
    tiles.map((t) => t.id),
    ["org-chat", "org-mail", "org-wiki", "org-video", "org-project", "org-agents"]
  );
  assert.equal(tiles[0].label, "Team-Chat");
  assert.equal(tiles[0].icon, "messages");
});

test("only configured suite members are visible (each tile is independently gated)", () => {
  const visible = filterAvailableTiles(
    buildOrgWorkspaceTiles({
      chatBaseUrl: "https://chat.roebel.app",
      mailBaseUrl: "https://mail.roebel.app",
      org: ORG,
    })
  );
  assert.deepEqual(visible.map((t) => t.id), ["org-chat", "org-mail"]);
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

test("chat tile is unconfigured without a chat base url", () => {
  const chat = buildOrgWorkspaceTiles({
    mailBaseUrl: "https://mail.roebel.app",
    org: ORG,
  }).find((t) => t.id === "org-chat");
  assert.ok(chat);
  assert.equal(chat.requiresConfig, true);
  assert.equal(chat.configured, false);
  assert.equal(chat.href, "");
});

test("configured tiles carry trimmed base-url hrefs", () => {
  const tiles = buildOrgWorkspaceTiles({
    chatBaseUrl: "https://chat.roebel.app/",
    mailBaseUrl: "https://mail.roebel.app/",
    org: ORG,
  });
  const chat = tiles.find((t) => t.id === "org-chat");
  const mail = tiles.find((t) => t.id === "org-mail");
  assert.equal(chat?.href, "https://chat.roebel.app");
  assert.equal(mail?.href, "https://mail.roebel.app");
  assert.equal(chat?.configured, true);
  assert.equal(mail?.configured, true);
});

test("filterAvailableTiles hides the tile whose base url is unset", () => {
  const visible = filterAvailableTiles(
    buildOrgWorkspaceTiles({
      chatBaseUrl: "https://chat.roebel.app",
      org: ORG,
    })
  );
  assert.deepEqual(
    visible.map((t) => t.id),
    ["org-chat"]
  );
});

test("nothing configured yields no visible tiles", () => {
  assert.equal(
    filterAvailableTiles(buildOrgWorkspaceTiles({ org: ORG })).length,
    0
  );
});
