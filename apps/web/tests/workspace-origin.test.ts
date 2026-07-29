import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { allowedOrigins, resolveRequestOrigin } from "../src/lib/workspace/origin";

const APP = "https://www.roebel.app";
const APEX = "https://roebel.app";

describe("allowedOrigins", () => {
  it("always contains the configured origin", () => {
    assert.deepEqual(allowedOrigins(APP, undefined), [APP]);
  });

  it("adds explicit extras", () => {
    assert.deepEqual(allowedOrigins(APP, APEX), [APP, APEX]);
  });

  it("normalises to scheme+host, dropping paths and trailing slashes", () => {
    // The /app suffix that broke this in production is stripped here.
    assert.deepEqual(allowedOrigins("https://www.roebel.app/app", "https://roebel.app/"), [
      APP,
      APEX,
    ]);
  });

  it("ignores blanks and junk rather than admitting them", () => {
    assert.deepEqual(allowedOrigins(APP, " , not-a-url , "), [APP]);
  });

  it("does not duplicate the configured origin", () => {
    assert.deepEqual(allowedOrigins(APP, `${APP},${APP}/`), [APP]);
  });
});

describe("resolveRequestOrigin", () => {
  const allowed = [APP, APEX];

  it("uses the request's own origin when allow-listed, so cookies and callback share a host", () => {
    assert.equal(
      resolveRequestOrigin(`${APEX}/api/workspace/auth/login`, allowed, APP),
      APEX,
    );
    assert.equal(
      resolveRequestOrigin(`${APP}/api/workspace/auth/login`, allowed, APP),
      APP,
    );
  });

  // The Host header is attacker-influenced. An unrecognised origin must never
  // reach a redirect_uri, or an authorization code could be harvested.
  it("falls back to the configured origin for a host that is not allow-listed", () => {
    assert.equal(
      resolveRequestOrigin("https://evil.example/api/workspace/auth/login", allowed, APP),
      APP,
    );
  });

  it("falls back for a look-alike host", () => {
    assert.equal(
      resolveRequestOrigin("https://www.roebel.app.evil.example/x", allowed, APP),
      APP,
    );
  });

  it("falls back for an http origin when only https is allowed", () => {
    assert.equal(
      resolveRequestOrigin("http://www.roebel.app/x", allowed, APP),
      APP,
    );
  });

  it("falls back on a malformed url rather than throwing", () => {
    assert.equal(resolveRequestOrigin("not-a-url", allowed, APP), APP);
  });
});
