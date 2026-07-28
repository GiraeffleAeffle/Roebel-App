import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { extensionOf, isEditable, loadDiscovery } from "../src/lib/workspace/editor";

const DISCOVERY = `<?xml version="1.0"?>
<wopi-discovery><net-zone name="external-http">
  <app name="writer"><action name="edit" ext="odt" urlsrc="https://office.example/browser/a/cool.html?"/></app>
</net-zone></wopi-discovery>`;

describe("extensionOf", () => {
  it("lowercases the extension, so ODT and odt are one entry", () => {
    assert.equal(extensionOf("Dokumente/Antrag.ODT"), "odt");
  });

  it("returns an empty string for a file with no extension", () => {
    assert.equal(extensionOf("Dokumente/LIESMICH"), "");
  });

  it("is not fooled by a dot in a folder name", () => {
    assert.equal(extensionOf("v1.2/Bericht"), "");
  });
});

describe("isEditable", () => {
  it("is true for an extension the discovery document offers", () => {
    assert.equal(isEditable("a.odt", new Map([["odt", "url"]])), true);
  });

  it("is false for anything else, so we never open an editor that cannot render", () => {
    assert.equal(isEditable("a.zip", new Map([["odt", "url"]])), false);
  });
});

describe("loadDiscovery", () => {
  it("fetches and parses the hosting discovery document", async () => {
    const calls: string[] = [];
    const fetchImpl = (async (input: unknown) => {
      calls.push(String(input));
      return new Response(DISCOVERY);
    }) as unknown as typeof globalThis.fetch;

    const map = await loadDiscovery("https://office.example/", fetchImpl);
    assert.equal(calls[0], "https://office.example/hosting/discovery");
    assert.equal(map.get("odt"), "https://office.example/browser/a/cool.html?");
  });

  it("returns an empty map when Collabora is unreachable, so the file list still renders", async () => {
    const fetchImpl = (async () => {
      throw new Error("ECONNREFUSED");
    }) as unknown as typeof globalThis.fetch;
    assert.equal((await loadDiscovery("https://office.example", fetchImpl)).size, 0);
  });

  it("returns an empty map on a non-200, rather than parsing an error page", async () => {
    // The body is valid discovery XML that WOULD parse into a non-empty map
    // if the status check were skipped — a Collabora deployment behind a
    // proxy can return a 502 with a body that still happens to look like
    // XML, and the status must gate parsing regardless of what the body
    // contains. "nope" as a body would pass this assertion even with the
    // `!res.ok` branch deleted, because parseDiscovery's own internal
    // try/catch already turns unparseable garbage into an empty map — that
    // would test the wrong thing.
    const fetchImpl = (async () =>
      new Response(DISCOVERY, { status: 502 })) as unknown as typeof globalThis.fetch;
    assert.equal((await loadDiscovery("https://office.example", fetchImpl)).size, 0);
  });
});
