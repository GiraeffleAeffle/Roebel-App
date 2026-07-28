import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildEditorUrl,
  checkFileInfo,
  decodeFileId,
  encodeFileId,
  mintWopiToken,
  parseDiscovery,
  verifyWopiToken,
  type WopiClaims,
} from "../src/wopi";
import type { DirEntry } from "../src/propfind";
import type { WorkspaceScope } from "../src/types";

const SECRET = new Uint8Array(32).fill(7);
const scope: WorkspaceScope = { kind: "personal", sub: "0xabc" };
const claims: WopiClaims = {
  sub: "0xabc",
  sessionId: "sess-1",
  scope,
  path: "Dokumente/Antrag.odt",
  canWrite: true,
};

describe("file ids", () => {
  it("round-trips scope and path", () => {
    const decoded = decodeFileId(encodeFileId(scope, "Dokumente/Antrag.odt"));
    assert.deepEqual(decoded.scope, scope);
    assert.equal(decoded.path, "Dokumente/Antrag.odt");
  });

  it("is url-safe, because it travels in a WOPISrc query parameter", () => {
    assert.match(encodeFileId(scope, "Meine Akten/Bericht #1.odt"), /^[A-Za-z0-9_-]+$/);
  });
});

describe("tokens", () => {
  it("round-trips the claims", async () => {
    const token = await mintWopiToken(claims, SECRET, 600);
    assert.deepEqual(await verifyWopiToken(token, SECRET), claims);
  });

  it("rejects an expired token", async () => {
    const token = await mintWopiToken(claims, SECRET, -1);
    await assert.rejects(() => verifyWopiToken(token, SECRET));
  });

  it("rejects a token signed with a different secret", async () => {
    const token = await mintWopiToken(claims, SECRET, 600);
    await assert.rejects(
      () => verifyWopiToken(token, new Uint8Array(32).fill(9)),
    );
  });
});

describe("checkFileInfo", () => {
  const entry: DirEntry = {
    name: "Antrag.odt",
    path: "Dokumente/Antrag.odt",
    isDirectory: false,
    size: 4096,
    lastModified: "2026-07-28T09:00:00.000Z",
    contentType: "application/vnd.oasis.opendocument.text",
    fileId: "102",
  };

  it("reports the file to Collabora with write permission", () => {
    const info = checkFileInfo(entry, claims, "Max B.");
    assert.equal(info.BaseFileName, "Antrag.odt");
    assert.equal(info.Size, 4096);
    assert.equal(info.UserCanWrite, true);
    assert.equal(info.SupportsUpdate, true);
    assert.equal(info.UserFriendlyName, "Max B.");
  });

  it("never puts a wallet address in the name Collabora renders", () => {
    const info = checkFileInfo(entry, claims, "Max B.");
    assert.doesNotMatch(info.UserFriendlyName, /^0x/);
  });

  it("marks a read-only session as such", () => {
    const info = checkFileInfo(entry, { ...claims, canWrite: false }, "Max B.");
    assert.equal(info.UserCanWrite, false);
    assert.equal(info.SupportsUpdate, false);
  });
});

describe("parseDiscovery", () => {
  const XML = `<?xml version="1.0"?>
<wopi-discovery>
  <net-zone name="external-http">
    <app name="writer">
      <action name="edit" ext="odt" urlsrc="https://office.example/browser/abc/cool.html?"/>
    </app>
    <app name="calc">
      <action name="edit" ext="ods" urlsrc="https://office.example/browser/abc/cool.html?"/>
    </app>
  </net-zone>
</wopi-discovery>`;

  it("maps each extension to its editor url", () => {
    const map = parseDiscovery(XML);
    assert.equal(map.get("odt"), "https://office.example/browser/abc/cool.html?");
    assert.equal(map.get("ods"), "https://office.example/browser/abc/cool.html?");
  });

  it("returns an empty map for a discovery document with no actions", () => {
    assert.equal(parseDiscovery("<wopi-discovery/>").size, 0);
  });

  it("returns an empty map for input that isn't a wopi-discovery document at all", () => {
    assert.equal(parseDiscovery("<not-discovery/>").size, 0);
  });

  it("returns an empty map for malformed XML rather than throwing", () => {
    assert.equal(parseDiscovery("<wopi-discovery><net-zone>").size, 0);
  });

  it("keeps the first urlsrc for a repeated extension instead of letting a later zone silently override it", () => {
    const twoZones = `<?xml version="1.0"?>
<wopi-discovery>
  <net-zone name="external-http">
    <app name="writer">
      <action name="edit" ext="odt" urlsrc="https://first.example/cool.html?"/>
    </app>
  </net-zone>
  <net-zone name="internal-https">
    <app name="writer">
      <action name="edit" ext="odt" urlsrc="https://second.example/cool.html?"/>
    </app>
  </net-zone>
</wopi-discovery>`;
    assert.equal(parseDiscovery(twoZones).get("odt"), "https://first.example/cool.html?");
  });
});

describe("buildEditorUrl", () => {
  it("appends WOPISrc and language to the discovery urlsrc", () => {
    const url = new URL(
      buildEditorUrl({
        urlsrc: "https://office.example/browser/abc/cool.html?",
        wopiSrc: "https://roebel.app/api/workspace/wopi/files/XYZ",
        lang: "de-DE",
      }),
    );
    assert.equal(
      url.searchParams.get("WOPISrc"),
      "https://roebel.app/api/workspace/wopi/files/XYZ",
    );
    assert.equal(url.searchParams.get("lang"), "de-DE");
  });

  // The token is POSTed into the iframe, never placed in a URL that would
  // land in browser history, referrers and server logs.
  it("does not carry the access token", () => {
    const url = buildEditorUrl({
      urlsrc: "https://office.example/browser/abc/cool.html?",
      wopiSrc: "https://roebel.app/api/workspace/wopi/files/XYZ",
      lang: "de-DE",
    });
    assert.doesNotMatch(url, /access_token/);
  });
});
