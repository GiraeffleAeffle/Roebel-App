import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { SignJWT } from "jose";
import {
  buildEditorUrl,
  checkFileInfo,
  decodeFileId,
  encodeFileId,
  mintWopiToken,
  parseDiscovery,
  verifyWopiToken,
  WopiFileIdError,
  type WopiClaims,
} from "../src/wopi";
import type { DirEntry } from "../src/propfind";
import type { WorkspaceScope } from "../src/types";

const SECRET = new Uint8Array(32).fill(7);
const scope: WorkspaceScope = { kind: "personal", sub: "0xabc", canWrite: true };
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

  it("round-trips an org scope with spaces, #, parens and non-ASCII in the path", () => {
    // The "is url-safe" test above only checks the encoded charset — it never
    // decodes back, so it cannot prove the value survives the round trip. An
    // org scope is included because it carries the extra accountId/folderName
    // fields a personal scope doesn't.
    const orgScope: WorkspaceScope = {
      kind: "org",
      sub: "0xabc",
      accountId: "acct-1",
      folderName: "Org Feuerwehr",
      canWrite: true,
    };
    const trickyPath = "Elternbeirat (Grundschule)/Bericht #1 Prüfbericht Müritz.odt";
    const decoded = decodeFileId(encodeFileId(orgScope, trickyPath));
    assert.deepEqual(decoded.scope, orgScope);
    assert.equal(decoded.path, trickyPath);
  });

  it("rejects a fileId that isn't valid base64url-encoded JSON with a typed error, not a raw SyntaxError", () => {
    assert.throws(() => decodeFileId("!!!not-a-real-fileid!!!"), WopiFileIdError);
    assert.throws(
      () => decodeFileId(Buffer.from("hello world", "utf8").toString("base64url")),
      WopiFileIdError,
    );
  });

  it("rejects decoded JSON that isn't a { scope, path } shape, instead of silently returning undefined fields", () => {
    const wrongShape = Buffer.from(JSON.stringify({ foo: "bar" }), "utf8").toString(
      "base64url",
    );
    assert.throws(() => decodeFileId(wrongShape), WopiFileIdError);
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

  it("rejects a token whose payload was tampered with after signing, even though the secret is correct", async () => {
    const token = await mintWopiToken(claims, SECRET, 600);
    const [header, payload, signature] = token.split(".");
    const decodedPayload = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    decodedPayload.canWrite = false; // flip a claim without re-signing
    const tamperedPayload = Buffer.from(JSON.stringify(decodedPayload), "utf8").toString(
      "base64url",
    );
    const tampered = `${header}.${tamperedPayload}.${signature}`;
    await assert.rejects(() => verifyWopiToken(tampered, SECRET));
  });

  it("rejects a token whose header claims an algorithm other than HS256, even signed with the right secret", async () => {
    // Not exploitable on its own — forging this still needs SECRET — but
    // pinning the algorithm is one line and rules out any future alg-confusion
    // surface within the HMAC family (HS256/HS384/HS512 all accept the same
    // raw-bytes key, so jose's default `jwtVerify` would otherwise accept any
    // of them here).
    const other = await new SignJWT({ ...claims } as unknown as Record<string, unknown>)
      .setProtectedHeader({ alg: "HS384" })
      .setIssuedAt()
      .setExpirationTime(Math.floor(Date.now() / 1000) + 600)
      .sign(SECRET);
    await assert.rejects(() => verifyWopiToken(other, SECRET));
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

  it("never claims lock support the WOPI host does not implement", () => {
    // Slice 1 is single-editor-per-document; claiming SupportsLocks would make
    // Collabora issue lock calls this host never answers. A regression that
    // flips this to `true` must not pass silently.
    const info = checkFileInfo(entry, claims, "Max B.");
    assert.equal(info.SupportsLocks, false);
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

  it("strips an access_token the discovery urlsrc already carries, instead of trusting the input to be clean", () => {
    // Collabora's real discovery urlsrc ends in a bare "?", so this isn't
    // live-exploitable today — but the "no token in the URL" guarantee must be
    // enforced by this function, not by trusting what urlsrc happens to be.
    const url = buildEditorUrl({
      urlsrc: "https://office.example/browser/abc/cool.html?foo=bar&access_token=PRE_EXISTING",
      wopiSrc: "https://roebel.app/api/workspace/wopi/files/XYZ",
      lang: "de-DE",
    });
    assert.doesNotMatch(url, /access_token/);
    assert.equal(new URL(url).searchParams.get("foo"), "bar");
  });
});
