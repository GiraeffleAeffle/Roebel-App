import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { safeReturnTo } from "../src/lib/workspace/return-to";

describe("safeReturnTo", () => {
  it("keeps a relative path inside the app", () => {
    assert.equal(safeReturnTo("/arbeitsbereich/dateien"), "/arbeitsbereich/dateien");
  });

  it("falls back to the workspace root when absent", () => {
    assert.equal(safeReturnTo(null), "/arbeitsbereich");
  });

  it("falls back to the workspace root for an empty or blank string", () => {
    assert.equal(safeReturnTo(""), "/arbeitsbereich");
    assert.equal(safeReturnTo("   "), "/arbeitsbereich");
  });

  // Anything below is an open redirect: the callback appends returnTo to our
  // own origin, so a value that escapes the path sends the citizen elsewhere
  // immediately after they authenticated.
  for (const attack of [
    "https://evil.example/phish",
    "//evil.example/phish",
    "/\\evil.example",
    "\\\\evil.example",
    "javascript:alert(1)",
    "  //evil.example",
  ]) {
    it(`rejects ${JSON.stringify(attack)}`, () => {
      assert.equal(safeReturnTo(attack), "/arbeitsbereich");
    });
  }

  // The WHATWG URL parser strips every ASCII tab/CR/LF from a URL string
  // wherever it occurs, not just at the ends, and treats a leading backslash
  // the same as a forward slash. A check that runs on the raw string without
  // undoing both first can be fooled by a value that only *looks* scoped to
  // a path: the control character is invisible to a naive startsWith() test
  // yet vanishes before the browser parses the redirect target, so
  // "/\t/evil.example" becomes the protocol-relative "//evil.example" and
  // "/\t\\evil.example" becomes "/\\evil.example".
  for (const attack of [
    "/\t/evil.example",
    "/\n/evil.example",
    "/\r/evil.example",
    "/\t\\evil.example",
  ]) {
    it(`rejects the control-character bypass ${JSON.stringify(attack)}`, () => {
      assert.equal(safeReturnTo(attack), "/arbeitsbereich");
    });
  }
});
