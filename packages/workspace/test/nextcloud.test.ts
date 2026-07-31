import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ScopeViolationError } from "../src/scope";
import {
  NextcloudError,
  basicAuth,
  bearerAuth,
  createNextcloudClient,
} from "../src/nextcloud";
import type { WorkspaceScope } from "../src/types";

const SUB = "0xabc";
const scope: WorkspaceScope = { kind: "personal", sub: SUB, canWrite: true };

const LISTING = `<?xml version="1.0"?>
<d:multistatus xmlns:d="DAV:">
  <d:response><d:href>/remote.php/dav/files/0xabc/</d:href>
    <d:propstat><d:prop><d:resourcetype><d:collection/></d:resourcetype></d:prop>
    <d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response>
  <d:response><d:href>/remote.php/dav/files/0xabc/Notiz.txt</d:href>
    <d:propstat><d:prop><d:resourcetype/><d:getcontentlength>7</d:getcontentlength></d:prop>
    <d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response>
</d:multistatus>`;

// The Fetch spec forbids a body on a "null body status" response (204, 205,
// 304) — Node's undici enforces this strictly, throwing even for an empty
// string body. A stub that always passed `body ?? ""` would crash on any
// 204/205/304 reply, so those statuses get a real `null` body instead.
const NULL_BODY_STATUSES = new Set([204, 205, 304]);

/** Records every request and replies from a queue. */
function stubFetch(replies: Array<{ status: number; body?: string }>) {
  const calls: Array<{ url: string; method: string; headers: Record<string, string> }> = [];
  const fetchImpl = async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    calls.push({
      url,
      method: init?.method ?? "GET",
      headers: (init?.headers ?? {}) as Record<string, string>,
    });
    const reply = replies.shift() ?? { status: 200 };
    const body = NULL_BODY_STATUSES.has(reply.status) ? null : (reply.body ?? "");
    return new Response(body, { status: reply.status });
  };
  return { calls, fetchImpl: fetchImpl as unknown as typeof globalThis.fetch };
}

describe("auth strategies", () => {
  it("bearer asks for a fresh token on every call, so refreshes are picked up", async () => {
    let issued = 0;
    const auth = bearerAuth(async () => `token-${++issued}`);
    assert.deepEqual(await auth.headers(), { Authorization: "Bearer token-1" });
    assert.deepEqual(await auth.headers(), { Authorization: "Bearer token-2" });
  });

  it("basic encodes the credential pair", async () => {
    const auth = basicAuth("admin", "pw");
    const expected = `Basic ${Buffer.from("admin:pw").toString("base64")}`;
    assert.deepEqual(await auth.headers(), { Authorization: expected });
  });
});

describe("listDirectory", () => {
  it("PROPFINDs the resolved path and returns typed children", async () => {
    const { calls, fetchImpl } = stubFetch([{ status: 207, body: LISTING }]);
    const client = createNextcloudClient({
      baseUrl: "https://cloud.example/",
      auth: bearerAuth(async () => "tok"),
      fetch: fetchImpl,
    });

    const entries = await client.listDirectory(scope, "");

    assert.equal(calls[0].method, "PROPFIND");
    assert.equal(calls[0].url, "https://cloud.example/remote.php/dav/files/0xabc/");
    assert.equal(calls[0].headers.Depth, "1");
    assert.equal(calls[0].headers.Authorization, "Bearer tok");
    assert.deepEqual(entries.map((e) => e.name), ["Notiz.txt"]);
  });

  it("refuses to issue a request at all when the path escapes the scope", async () => {
    const { calls, fetchImpl } = stubFetch([]);
    const client = createNextcloudClient({
      baseUrl: "https://cloud.example",
      auth: bearerAuth(async () => "tok"),
      fetch: fetchImpl,
    });

    await assert.rejects(
      () => client.listDirectory(scope, "../andere"),
      ScopeViolationError,
    );
    assert.equal(calls.length, 0, "no request may leave the process");
  });

  it("raises a typed error carrying the status", async () => {
    const { fetchImpl } = stubFetch([{ status: 401 }]);
    const client = createNextcloudClient({
      baseUrl: "https://cloud.example",
      auth: bearerAuth(async () => "tok"),
      fetch: fetchImpl,
    });

    await assert.rejects(
      () => client.listDirectory(scope, ""),
      (err: unknown) =>
        err instanceof NextcloudError && err.status === 401,
    );
  });
});

describe("mutations", () => {
  it("creates a folder with MKCOL", async () => {
    const { calls, fetchImpl } = stubFetch([{ status: 201 }]);
    const client = createNextcloudClient({
      baseUrl: "https://cloud.example",
      auth: bearerAuth(async () => "tok"),
      fetch: fetchImpl,
    });
    await client.createFolder(scope, "Neuer Ordner");
    assert.equal(calls[0].method, "MKCOL");
    assert.equal(
      calls[0].url,
      "https://cloud.example/remote.php/dav/files/0xabc/Neuer%20Ordner",
    );
  });

  it("moves with an absolute Destination header", async () => {
    const { calls, fetchImpl } = stubFetch([{ status: 201 }]);
    const client = createNextcloudClient({
      baseUrl: "https://cloud.example",
      auth: bearerAuth(async () => "tok"),
      fetch: fetchImpl,
    });
    await client.move(scope, "a.odt", "Archiv/a.odt");
    assert.equal(calls[0].method, "MOVE");
    // The request itself must target the SOURCE — a regression that swapped
    // the request target to the destination while still computing the
    // Destination header from `to` would pass every assertion below it if
    // this one weren't here too.
    assert.equal(
      calls[0].url,
      "https://cloud.example/remote.php/dav/files/0xabc/a.odt",
    );
    assert.equal(
      calls[0].headers.Destination,
      "https://cloud.example/remote.php/dav/files/0xabc/Archiv/a.odt",
    );
    // RFC 4918 defaults Overwrite to T when the header is absent, so a
    // dropped header silently enables clobbering whatever already sits at
    // the destination — this must be sent explicitly.
    assert.equal(calls[0].headers.Overwrite, "F");
  });

  it("validates BOTH ends of a move before issuing it", async () => {
    const { calls, fetchImpl } = stubFetch([]);
    const client = createNextcloudClient({
      baseUrl: "https://cloud.example",
      auth: bearerAuth(async () => "tok"),
      fetch: fetchImpl,
    });
    await assert.rejects(
      () => client.move(scope, "a.odt", "../escape.odt"),
      ScopeViolationError,
    );
    assert.equal(calls.length, 0);
  });

  it("also validates the SOURCE end of a move, not just the destination", async () => {
    // The brief's own test only attacks the destination; a client that resolved
    // `from` lazily (e.g. inside the Destination-header computation) could let
    // a bad source slip through if only the destination were ever checked. This
    // guards the other direction of the same requirement.
    const { calls, fetchImpl } = stubFetch([]);
    const client = createNextcloudClient({
      baseUrl: "https://cloud.example",
      auth: bearerAuth(async () => "tok"),
      fetch: fetchImpl,
    });
    await assert.rejects(
      () => client.move(scope, "../escape.odt", "b.odt"),
      ScopeViolationError,
    );
    assert.equal(calls.length, 0, "no request may leave the process");
  });

  it("deletes and uploads at the resolved path", async () => {
    const { calls, fetchImpl } = stubFetch([{ status: 204 }, { status: 201 }]);
    const client = createNextcloudClient({
      baseUrl: "https://cloud.example",
      auth: bearerAuth(async () => "tok"),
      fetch: fetchImpl,
    });
    await client.remove(scope, "alt.odt");
    await client.upload(scope, "neu.odt", new Uint8Array([1, 2, 3]));
    assert.equal(calls[0].method, "DELETE");
    assert.equal(calls[1].method, "PUT");
  });

  it("refuses to issue an upload, createFolder, remove, or download at all when the path escapes the scope", async () => {
    // Each of the other scoped methods gets the same "never reaches the
    // network" guarantee the brief only spells out for listDirectory/move.
    const { calls, fetchImpl } = stubFetch([]);
    const client = createNextcloudClient({
      baseUrl: "https://cloud.example",
      auth: bearerAuth(async () => "tok"),
      fetch: fetchImpl,
    });

    await assert.rejects(
      () => client.upload(scope, "../escape.odt", new Uint8Array()),
      ScopeViolationError,
    );
    await assert.rejects(
      () => client.createFolder(scope, "../escape"),
      ScopeViolationError,
    );
    await assert.rejects(
      () => client.remove(scope, "../escape.odt"),
      ScopeViolationError,
    );
    await assert.rejects(
      () => client.download(scope, "../escape.odt"),
      ScopeViolationError,
    );
    assert.equal(calls.length, 0, "no request may leave the process");
  });
});

describe("stat", () => {
  it("PROPFINDs at Depth 0 and returns the single described entry", async () => {
    const STAT_XML = `<?xml version="1.0"?>
<d:multistatus xmlns:d="DAV:">
  <d:response><d:href>/remote.php/dav/files/0xabc/Notiz.txt</d:href>
    <d:propstat><d:prop><d:resourcetype/><d:getcontentlength>7</d:getcontentlength></d:prop>
    <d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response>
</d:multistatus>`;
    const { calls, fetchImpl } = stubFetch([{ status: 207, body: STAT_XML }]);
    const client = createNextcloudClient({
      baseUrl: "https://cloud.example",
      auth: bearerAuth(async () => "tok"),
      fetch: fetchImpl,
    });

    const entry = await client.stat(scope, "Notiz.txt");

    assert.equal(calls[0].method, "PROPFIND");
    assert.equal(calls[0].headers.Depth, "0");
    assert.equal(
      calls[0].url,
      "https://cloud.example/remote.php/dav/files/0xabc/Notiz.txt",
    );
    assert.equal(entry.name, "Notiz.txt");
    assert.equal(entry.size, 7);
  });

  it("raises a typed 404 when the server describes nothing", async () => {
    const EMPTY = `<?xml version="1.0"?><d:multistatus xmlns:d="DAV:"></d:multistatus>`;
    const { fetchImpl } = stubFetch([{ status: 207, body: EMPTY }]);
    const client = createNextcloudClient({
      baseUrl: "https://cloud.example",
      auth: bearerAuth(async () => "tok"),
      fetch: fetchImpl,
    });

    await assert.rejects(
      () => client.stat(scope, "Fehlt.txt"),
      (err: unknown) => err instanceof NextcloudError && err.status === 404,
    );
  });

  it("refuses to issue a request at all when the path escapes the scope", async () => {
    const { calls, fetchImpl } = stubFetch([]);
    const client = createNextcloudClient({
      baseUrl: "https://cloud.example",
      auth: bearerAuth(async () => "tok"),
      fetch: fetchImpl,
    });
    await assert.rejects(
      () => client.stat(scope, "../escape.odt"),
      ScopeViolationError,
    );
    assert.equal(calls.length, 0);
  });

  it("stats the scope root itself as an existing directory, not a false 404", async () => {
    // Regression test: a Depth-0 PROPFIND of the root's own href was being
    // re-parsed with that same href as rootHref, which parsePropfind treats
    // as the "self entry" and drops — so stat(scope, "") threw a 404 even
    // when the stub correctly described the root as an existing collection.
    // A caller checking "has this org folder been provisioned yet" (as a
    // later task does) would misread that false 404 as "does not exist".
    const ROOT_XML = `<?xml version="1.0"?>
<d:multistatus xmlns:d="DAV:">
  <d:response><d:href>/remote.php/dav/files/0xabc/</d:href>
    <d:propstat><d:prop><d:resourcetype><d:collection/></d:resourcetype></d:prop>
    <d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response>
</d:multistatus>`;
    const { calls, fetchImpl } = stubFetch([{ status: 207, body: ROOT_XML }]);
    const client = createNextcloudClient({
      baseUrl: "https://cloud.example",
      auth: bearerAuth(async () => "tok"),
      fetch: fetchImpl,
    });

    const entry = await client.stat(scope, "");

    assert.equal(calls[0].headers.Depth, "0");
    assert.equal(
      calls[0].url,
      "https://cloud.example/remote.php/dav/files/0xabc/",
    );
    assert.equal(entry.isDirectory, true);
    assert.equal(entry.path, "");
  });

  it("still raises a typed 404 for the scope root when the server describes nothing", async () => {
    // Guards against over-correcting the fix above into "stat('') always
    // succeeds" — a root that genuinely doesn't exist yet must still 404.
    const EMPTY = `<?xml version="1.0"?><d:multistatus xmlns:d="DAV:"></d:multistatus>`;
    const { fetchImpl } = stubFetch([{ status: 207, body: EMPTY }]);
    const client = createNextcloudClient({
      baseUrl: "https://cloud.example",
      auth: bearerAuth(async () => "tok"),
      fetch: fetchImpl,
    });

    await assert.rejects(
      () => client.stat(scope, ""),
      (err: unknown) => err instanceof NextcloudError && err.status === 404,
    );
  });
});

describe("download", () => {
  it("GETs the resolved path and returns the raw bytes", async () => {
    const { calls, fetchImpl } = stubFetch([{ status: 200, body: "hello" }]);
    const client = createNextcloudClient({
      baseUrl: "https://cloud.example",
      auth: bearerAuth(async () => "tok"),
      fetch: fetchImpl,
    });

    const bytes = await client.download(scope, "Notiz.txt");

    assert.equal(calls[0].method, "GET");
    assert.equal(
      calls[0].url,
      "https://cloud.example/remote.php/dav/files/0xabc/Notiz.txt",
    );
    assert.equal(Buffer.from(bytes).toString("utf8"), "hello");
  });
});

// A filename containing "%" used to be unusable through this client: the
// double decode inside resolvePath either threw ScopeViolationError before any
// request left the process ("Bericht 100%.odt") or, when the sequence happened
// to be valid percent-encoding, addressed a DIFFERENT file ("a%417b.txt" ->
// ".../aA7b.txt"). For DELETE that is the wrong file removed. Each verb the
// Dateien surface uses is pinned here against the real request URL.
describe("filenames containing a percent sign reach the right resource", () => {
  const PERCENT_LISTING = `<?xml version="1.0"?>
<d:multistatus xmlns:d="DAV:">
  <d:response><d:href>/remote.php/dav/files/0xabc/</d:href>
    <d:propstat><d:prop><d:resourcetype><d:collection/></d:resourcetype></d:prop>
    <d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response>
  <d:response><d:href>/remote.php/dav/files/0xabc/Bericht%20100%25.odt</d:href>
    <d:propstat><d:prop><d:resourcetype/><d:getcontentlength>9</d:getcontentlength></d:prop>
    <d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response>
  <d:response><d:href>/remote.php/dav/files/0xabc/a%25417b.txt</d:href>
    <d:propstat><d:prop><d:resourcetype/><d:getcontentlength>3</d:getcontentlength></d:prop>
    <d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response>
</d:multistatus>`;

  function clientWith(replies: Array<{ status: number; body?: string }>) {
    const { calls, fetchImpl } = stubFetch(replies);
    return {
      calls,
      client: createNextcloudClient({
        baseUrl: "https://cloud.example",
        auth: bearerAuth(async () => "tok"),
        fetch: fetchImpl,
      }),
    };
  }

  it("lists them, decoded, rather than failing the whole listing", async () => {
    const { client } = clientWith([{ status: 207, body: PERCENT_LISTING }]);
    const entries = await client.listDirectory(scope, "");
    assert.deepEqual(
      entries.map((e) => e.name),
      ["Bericht 100%.odt", "a%417b.txt"],
    );
  });

  it("stats one (what opening a document does first) at its own href", async () => {
    const STAT = `<?xml version="1.0"?>
<d:multistatus xmlns:d="DAV:">
  <d:response><d:href>/remote.php/dav/files/0xabc/Bericht%20100%25.odt</d:href>
    <d:propstat><d:prop><d:resourcetype/><d:getcontentlength>9</d:getcontentlength></d:prop>
    <d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response>
</d:multistatus>`;
    const { calls, client } = clientWith([{ status: 207, body: STAT }]);
    const entry = await client.stat(scope, "Bericht 100%.odt");
    assert.equal(
      calls[0].url,
      "https://cloud.example/remote.php/dav/files/0xabc/Bericht%20100%25.odt",
    );
    assert.equal(entry.name, "Bericht 100%.odt");
  });

  it("downloads one at its own href", async () => {
    const { calls, client } = clientWith([{ status: 200, body: "inhalt" }]);
    const bytes = await client.download(scope, "Bericht 100%.odt");
    assert.equal(calls[0].method, "GET");
    assert.equal(
      calls[0].url,
      "https://cloud.example/remote.php/dav/files/0xabc/Bericht%20100%25.odt",
    );
    assert.equal(Buffer.from(bytes).toString("utf8"), "inhalt");
  });

  it("deletes the file the citizen named, not a different one", async () => {
    const { calls, client } = clientWith([{ status: 204 }, { status: 204 }]);
    await client.remove(scope, "Bericht 100%.odt");
    await client.remove(scope, "a%417b.txt");
    assert.deepEqual(
      calls.map((c) => c.url),
      [
        "https://cloud.example/remote.php/dav/files/0xabc/Bericht%20100%25.odt",
        "https://cloud.example/remote.php/dav/files/0xabc/a%25417b.txt",
      ],
    );
    // The pre-fix bug: "%41" decoded to "A", so DELETE hit ".../aA7b.txt".
    assert.ok(!calls[1].url.includes("aA7b"));
  });

  it("uploads and creates a folder under a percent name", async () => {
    const { calls, client } = clientWith([{ status: 201 }, { status: 201 }]);
    await client.upload(scope, "Rabatt %%.odt", new Uint8Array([1]));
    await client.createFolder(scope, "Aktion 50%");
    assert.deepEqual(
      calls.map((c) => `${c.method} ${c.url}`),
      [
        "PUT https://cloud.example/remote.php/dav/files/0xabc/Rabatt%20%25%25.odt",
        "MKCOL https://cloud.example/remote.php/dav/files/0xabc/Aktion%2050%25",
      ],
    );
  });

  it("still refuses a pre-encoded traversal hiding beside a percent name", async () => {
    const { calls, client } = clientWith([]);
    await assert.rejects(
      () => client.remove(scope, "%2e%2e/100%.odt"),
      ScopeViolationError,
    );
    assert.equal(calls.length, 0, "no request may leave the process");
  });
});
