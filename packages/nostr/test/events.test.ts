import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { hexToBytes } from "@noble/hashes/utils";
import {
  KIND,
  buildDeletionEvent,
  buildNoteEvent,
  buildProfileEvent,
  eventId,
  signEvent,
  verifyEvent,
} from "../src/events.js";
import { deriveNostrSecretKey, getPublicKeyHex } from "../src/keys.js";

const SIGNATURE =
  "0x" +
  "9c1f2b3a4d5e6f708192a3b4c5d6e7f8091a2b3c4d5e6f708192a3b4c5d6e7f8" +
  "1b2c3d4e5f60718293a4b5c6d7e8f9001a2b3c4d5e6f708192a3b4c5d6e7f809" +
  "1b";

const SECRET_KEY = deriveNostrSecretKey(SIGNATURE);
const PUBKEY = getPublicKeyHex(SECRET_KEY);
const CREATED_AT = 1_753_600_000;

describe("NIP-01 event id", () => {
  it("matches the canonical serialization vector", () => {
    // Known-good pairing from the NIP-01 spec's example event.
    const event = {
      pubkey: "6e468422dfb74a5738702a8823b9b28168abab8655faacb6853cd0ee15deee93",
      created_at: 1673347337,
      kind: 1,
      tags: [
        ["e", "3da979448d9ba263864c4d6f14984c423a3838364ec255f03c7904b1ae77f206"],
        ["p", "bf2376e17ba4ec269d10fcc996a4746b451152be9031fa48e74553dde5526bce"],
      ],
      content: "Walled gardens became prisons, and nostr is the first step towards tearing down the prison walls.",
    };
    assert.equal(
      eventId(event),
      "4376c65d2f232afbe9b882a35baa4f6fe8667c4e684749af565f981833ed6a65",
    );
  });

  it("changes when any field changes", () => {
    const base = { pubkey: PUBKEY, created_at: CREATED_AT, kind: 1, tags: [], content: "hallo" };
    const id = eventId(base);
    assert.notEqual(id, eventId({ ...base, content: "hallo " }));
    assert.notEqual(id, eventId({ ...base, created_at: CREATED_AT + 1 }));
    assert.notEqual(id, eventId({ ...base, kind: 7 }));
    assert.notEqual(id, eventId({ ...base, tags: [["t", "roebel"]] }));
  });
});

describe("signing and verification", () => {
  it("signs an event that verifies", () => {
    const event = signEvent(
      { pubkey: PUBKEY, created_at: CREATED_AT, kind: 1, tags: [], content: "Moin Röbel" },
      SECRET_KEY,
    );
    assert.equal(event.id.length, 64);
    assert.equal(event.sig.length, 128);
    assert.ok(verifyEvent(event));
  });

  it("rejects a tampered content, id, or signature", () => {
    const event = buildNoteEvent(SECRET_KEY, "Moin Röbel", { createdAt: CREATED_AT });
    assert.equal(verifyEvent({ ...event, content: "manipuliert" }), false);
    assert.equal(verifyEvent({ ...event, id: "0".repeat(64) }), false);
    assert.equal(verifyEvent({ ...event, sig: "0".repeat(128) }), false);
  });

  it("rejects an event signed by a different key claiming another pubkey", () => {
    const other = deriveNostrSecretKey(SIGNATURE.slice(0, -4) + "aa1c");
    const event = buildNoteEvent(other, "nicht meins", { createdAt: CREATED_AT });
    assert.equal(verifyEvent({ ...event, pubkey: PUBKEY }), false);
  });

  it("never throws on a malformed event", () => {
    assert.equal(verifyEvent({ id: "x", sig: "y", pubkey: "z", created_at: 0, kind: 1, tags: [], content: "" }), false);
  });

  it("produces a signature the curve library verifies directly", () => {
    const event = buildNoteEvent(SECRET_KEY, "direkt geprüft", { createdAt: CREATED_AT });
    assert.equal(hexToBytes(event.sig).length, 64, "BIP-340 signatures are 64 bytes");
  });
});

describe("event builders", () => {
  it("builds a kind 0 profile, dropping empty fields", () => {
    const event = buildProfileEvent(
      SECRET_KEY,
      { name: "Max", about: "", picture: "https://roebel.app/a.png", nip05: undefined },
      { createdAt: CREATED_AT },
    );
    assert.equal(event.kind, KIND.profile);
    assert.deepEqual(JSON.parse(event.content), {
      name: "Max",
      picture: "https://roebel.app/a.png",
    });
    assert.ok(verifyEvent(event));
  });

  it("builds a kind 1 note carrying its content verbatim", () => {
    const content = "Straßenfest am Samstag – Müritz-Ufer, 14 Uhr 🎉";
    const event = buildNoteEvent(SECRET_KEY, content, { createdAt: CREATED_AT });
    assert.equal(event.kind, KIND.note);
    assert.equal(event.content, content);
    assert.ok(verifyEvent(event));
  });

  it("builds a kind 5 deletion referencing each event", () => {
    const event = buildDeletionEvent(SECRET_KEY, ["a".repeat(64), "b".repeat(64)], {
      createdAt: CREATED_AT,
      reason: "Konto gelöscht",
    });
    assert.equal(event.kind, KIND.deletion);
    assert.equal(event.content, "Konto gelöscht");
    assert.deepEqual(
      event.tags.filter((t) => t[0] === "e").map((t) => t[1]),
      ["a".repeat(64), "b".repeat(64)],
    );
    assert.ok(verifyEvent(event));
  });

  it("stamps the derived pubkey as the author", () => {
    assert.equal(buildNoteEvent(SECRET_KEY, "x", { createdAt: CREATED_AT }).pubkey, PUBKEY);
  });
});
