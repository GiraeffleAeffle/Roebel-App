import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  decodeWork,
  encodeWork,
  normalizeRelayUrl,
  ownedDeletionIds,
  parseVanishRequest,
  referencedIds,
  type NostrEvent,
  type VanishWork,
} from "../src/vanish.js";

const PK_A = "a".repeat(64);
const PK_B = "b".repeat(64);
const ID_1 = "1".repeat(64);
const ID_2 = "2".repeat(64);

function evt(overrides: Partial<NostrEvent>): NostrEvent {
  return {
    id: "f".repeat(64),
    pubkey: PK_A,
    created_at: 1_753_000_000,
    kind: 62,
    tags: [],
    content: "",
    sig: "0".repeat(128),
    ...overrides,
  };
}

describe("parseVanishRequest", () => {
  it("accepts ALL_RELAYS, any casing", () => {
    const r = parseVanishRequest(evt({ tags: [["relay", "all_relays"]] }), []);
    assert.deepEqual(r, { pubkey: PK_A, until: 1_753_000_000 });
  });

  it("accepts our own relay url, normalised (case + trailing slash)", () => {
    const r = parseVanishRequest(
      evt({ tags: [["relay", "WSS://relay.roebel.app/"]] }),
      ["wss://relay.roebel.app"],
    );
    assert.ok(r);
  });

  it("ignores requests addressed to somebody else's relay", () => {
    const r = parseVanishRequest(
      evt({ tags: [["relay", "wss://other.example"]] }),
      ["wss://relay.roebel.app"],
    );
    assert.equal(r, null);
  });

  it("ignores non-62 kinds, malformed pubkeys and timestamps", () => {
    const tags: string[][] = [["relay", "ALL_RELAYS"]];
    assert.equal(parseVanishRequest(evt({ kind: 5, tags }), []), null);
    assert.equal(parseVanishRequest(evt({ pubkey: "xyz", tags }), []), null);
    assert.equal(parseVanishRequest(evt({ created_at: -1, tags }), []), null);
    // A pubkey smuggled into content must never matter — only the verified field.
    const r = parseVanishRequest(evt({ tags, content: `"pubkey":"${PK_B}"` }), []);
    assert.equal(r?.pubkey, PK_A);
  });
});

describe("kind-5 ownership", () => {
  it("keeps only referenced events actually authored by the requester", () => {
    const kind5 = evt({
      kind: 5,
      tags: [
        ["e", ID_1],
        ["e", ID_2],
        ["e", "not-hex"],
      ],
    });
    const authors = new Map([
      [ID_1, PK_A], // owned
      [ID_2, PK_B], // someone else's — must survive
    ]);
    assert.deepEqual(ownedDeletionIds(kind5, authors), [ID_1]);
  });

  it("drops ids that could not be fetched — unverifiable is undeletable", () => {
    const kind5 = evt({ kind: 5, tags: [["e", ID_1]] });
    assert.deepEqual(ownedDeletionIds(kind5, new Map()), []);
  });

  it("dedupes repeated e-tags", () => {
    const kind5 = evt({ kind: 5, tags: [["e", ID_1], ["e", ID_1]] });
    assert.deepEqual(referencedIds(kind5), [ID_1]);
  });
});

describe("work-queue codec", () => {
  it("round-trips author and ids work", () => {
    const author: VanishWork = { op: "author", store: "auth", pubkey: PK_A, until: 123 };
    const ids: VanishWork = { op: "ids", store: "mirror", ids: [ID_1, ID_2] };
    assert.deepEqual(decodeWork(encodeWork(author)), author);
    assert.deepEqual(decodeWork(encodeWork(ids)), ids);
  });

  it("rejects anything that is not exactly the expected shape", () => {
    assert.equal(decodeWork("author auth nothex 5"), null);
    assert.equal(decodeWork(`author elsewhere ${PK_A} 5`), null);
    assert.equal(decodeWork(`author auth ${PK_A} nan`), null);
    assert.equal(decodeWork(`ids auth ${ID_1},zzz`), null);
    assert.equal(decodeWork(`rm -rf auth ${PK_A} 5`), null);
    assert.throws(() => encodeWork({ op: "author", store: "auth", pubkey: "short", until: 1 }));
  });

  it("normalizeRelayUrl strips what comparison must not see", () => {
    assert.equal(normalizeRelayUrl(" WSS://X.Y/// "), "wss://x.y");
  });
});
