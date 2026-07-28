import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { authorizedBy, buildOrgProfileEvent, deriveOrgIdentity, withAuthorizedBy } from "../src/org";
import { buildCalendarEvent } from "../src/calendar";
import { deriveAgentIdentity } from "../src/agent";
import { verifyEvent } from "../src/events";

const SECRET = "a-node-secret-with-plenty-of-entropy-0123456789";
const KINO = deriveOrgIdentity(SECRET, "roebel", "kino-am-markt");

describe("organisation identity", () => {
  it("is stable, so an org keeps one identity and its history", () => {
    assert.equal(deriveOrgIdentity(SECRET, "roebel", "kino-am-markt").npub, KINO.npub);
  });

  it("is scoped by node, so the same org name elsewhere is a different actor", () => {
    assert.notEqual(deriveOrgIdentity(SECRET, "testnode", "kino-am-markt").npub, KINO.npub);
  });

  it("does not collide with an agent on the same node", () => {
    assert.notEqual(deriveAgentIdentity(SECRET, "roebel", "mecky").npub, KINO.npub);
  });

  it("refuses ids that could smuggle a separator into the derivation", () => {
    assert.throws(() => deriveOrgIdentity(SECRET, "roebel", "kino\nsecret=x"), /lowercase/);
  });

  it("publishes a signed org profile", () => {
    const e = buildOrgProfileEvent(KINO, { name: "Kino am Markt" }, { createdAt: 1 });
    assert.ok(verifyEvent(e));
    assert.equal(JSON.parse(e.content).name, "Kino am Markt");
  });
});

describe("who authorised an org post", () => {
  it("records the member, so the org never speaks with nobody behind it", () => {
    const screening = buildCalendarEvent(KINO.secretKey, {
      id: "movie-1", title: "Film", start: 1_785_300_000,
    }, { createdAt: 1 });
    const stamped = { ...screening, tags: withAuthorizedBy(screening.tags, "npub1anna") };
    assert.equal(authorizedBy(stamped), "npub1anna");
  });

  it("replaces rather than accumulates attribution on re-publish", () => {
    // Screenings are replaceable events, so an edit by a different manager must
    // not leave two conflicting claims about who authorised it.
    const tags = withAuthorizedBy(withAuthorizedBy([["d", "m1"]], "npub1anna"), "npub1bernd");
    assert.equal(tags.filter((t) => t[0] === "authorized_by").length, 1);
    assert.equal(authorizedBy({ tags } as never), "npub1bernd");
  });

  it("returns null for an event with no attribution", () => {
    assert.equal(authorizedBy({ tags: [["d", "x"]] } as never), null);
  });
});
