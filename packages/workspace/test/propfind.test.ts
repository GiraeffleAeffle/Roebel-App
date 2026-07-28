import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parsePropfind } from "../src/propfind";

const ROOT = "/remote.php/dav/files/0xabc/";

const XML = `<?xml version="1.0"?>
<d:multistatus xmlns:d="DAV:" xmlns:oc="http://owncloud.org/ns">
  <d:response>
    <d:href>/remote.php/dav/files/0xabc/</d:href>
    <d:propstat><d:prop>
      <d:resourcetype><d:collection/></d:resourcetype>
      <d:getlastmodified>Mon, 27 Jul 2026 10:00:00 GMT</d:getlastmodified>
      <oc:fileid>100</oc:fileid>
    </d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat>
  </d:response>
  <d:response>
    <d:href>/remote.php/dav/files/0xabc/Dokumente/</d:href>
    <d:propstat><d:prop>
      <d:resourcetype><d:collection/></d:resourcetype>
      <d:getlastmodified>Mon, 27 Jul 2026 11:00:00 GMT</d:getlastmodified>
      <oc:fileid>101</oc:fileid>
    </d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat>
  </d:response>
  <d:response>
    <d:href>/remote.php/dav/files/0xabc/Bericht%20%231.odt</d:href>
    <d:propstat><d:prop>
      <d:resourcetype/>
      <d:getcontentlength>4096</d:getcontentlength>
      <d:getcontenttype>application/vnd.oasis.opendocument.text</d:getcontenttype>
      <d:getlastmodified>Mon, 27 Jul 2026 12:00:00 GMT</d:getlastmodified>
      <oc:fileid>102</oc:fileid>
    </d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat>
  </d:response>
</d:multistatus>`;

describe("parsePropfind", () => {
  it("drops the self entry so a listing contains only children", () => {
    const entries = parsePropfind(XML, ROOT);
    assert.equal(entries.length, 2);
    assert.deepEqual(
      entries.map((e) => e.name),
      ["Dokumente", "Bericht #1.odt"],
    );
  });

  it("marks collections as directories with zero size", () => {
    const dir = parsePropfind(XML, ROOT)[0];
    assert.equal(dir.isDirectory, true);
    assert.equal(dir.size, 0);
    assert.equal(dir.contentType, null);
  });

  it("decodes percent-encoded names and keeps the path relative to the root", () => {
    const file = parsePropfind(XML, ROOT)[1];
    assert.equal(file.name, "Bericht #1.odt");
    assert.equal(file.path, "Bericht #1.odt");
    assert.equal(file.isDirectory, false);
    assert.equal(file.size, 4096);
    assert.equal(file.contentType, "application/vnd.oasis.opendocument.text");
    assert.equal(file.fileId, "102");
  });

  it("normalises the modification time to ISO 8601", () => {
    const file = parsePropfind(XML, ROOT)[1];
    assert.equal(file.lastModified, "2026-07-27T12:00:00.000Z");
  });

  it("returns an empty list for a directory with no children", () => {
    const empty = `<?xml version="1.0"?>
<d:multistatus xmlns:d="DAV:">
  <d:response>
    <d:href>${ROOT}</d:href>
    <d:propstat><d:prop><d:resourcetype><d:collection/></d:resourcetype></d:prop>
    <d:status>HTTP/1.1 200 OK</d:status></d:propstat>
  </d:response>
</d:multistatus>`;
    assert.deepEqual(parsePropfind(empty, ROOT), []);
  });

  it("survives a single-response document, which the parser must not read as a scalar", () => {
    const one = `<?xml version="1.0"?>
<d:multistatus xmlns:d="DAV:">
  <d:response>
    <d:href>${ROOT}Notiz.txt</d:href>
    <d:propstat><d:prop>
      <d:resourcetype/><d:getcontentlength>7</d:getcontentlength>
    </d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat>
  </d:response>
</d:multistatus>`;
    const entries = parsePropfind(one, ROOT);
    assert.equal(entries.length, 1);
    assert.equal(entries[0].name, "Notiz.txt");
  });

  it("picks the 200 propstat over a 404 one for a property Nextcloud doesn't have, instead of defaulting to whichever block comes first", () => {
    // Real Nextcloud PROPFIND responses commonly split into multiple
    // <d:propstat> blocks: one 200 block for properties the server has, and
    // one 404 block for requested properties it doesn't (here, an
    // oc:favorite the server never populated). The 404 block happens to come
    // first in this fixture — if the parser naively used propstats[0] instead
    // of finding the 200 block, every field below would be missing or wrong.
    const multiPropstat = `<?xml version="1.0"?>
<d:multistatus xmlns:d="DAV:" xmlns:oc="http://owncloud.org/ns">
  <d:response>
    <d:href>${ROOT}</d:href>
    <d:propstat><d:prop><d:resourcetype><d:collection/></d:resourcetype></d:prop>
    <d:status>HTTP/1.1 200 OK</d:status></d:propstat>
  </d:response>
  <d:response>
    <d:href>${ROOT}Vermerk.txt</d:href>
    <d:propstat><d:prop><oc:favorite/></d:prop><d:status>HTTP/1.1 404 Not Found</d:status></d:propstat>
    <d:propstat><d:prop>
      <d:resourcetype/>
      <d:getcontentlength>55</d:getcontentlength>
      <d:getcontenttype>text/plain</d:getcontenttype>
      <d:getlastmodified>Mon, 27 Jul 2026 12:00:00 GMT</d:getlastmodified>
      <oc:fileid>200</oc:fileid>
    </d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat>
  </d:response>
</d:multistatus>`;
    const file = parsePropfind(multiPropstat, ROOT)[0];
    assert.equal(file.name, "Vermerk.txt");
    assert.equal(file.size, 55);
    assert.equal(file.contentType, "text/plain");
    assert.equal(file.fileId, "200");
    assert.equal(file.lastModified, "2026-07-27T12:00:00.000Z");
  });

  it("handles non-ASCII names, which is the normal case in German", () => {
    const umlaut = `<?xml version="1.0"?>
<d:multistatus xmlns:d="DAV:">
  <d:response><d:href>${ROOT}</d:href>
    <d:propstat><d:prop><d:resourcetype><d:collection/></d:resourcetype></d:prop>
    <d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response>
  <d:response><d:href>${ROOT}Pr%C3%BCfbericht%20M%C3%BCritz.odt</d:href>
    <d:propstat><d:prop><d:resourcetype/><d:getcontentlength>1</d:getcontentlength></d:prop>
    <d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response>
</d:multistatus>`;
    assert.equal(parsePropfind(umlaut, ROOT)[0].name, "Prüfbericht Müritz.odt");
  });
});
