import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildAgentNoteEvent,
  buildEvent,
  buildNoteEvent,
  deriveAgentIdentity,
  deriveNostrSecretKey,
  getPublicKeyHex,
  type NostrEvent,
} from "@netizen-labs/nostr";
import { backfeedOnce, classify } from "../src/backfeed.js";

const CITIZEN_SK = deriveNostrSecretKey("0x" + "3a".repeat(65));
const CITIZEN_PK = getPublicKeyHex(CITIZEN_SK);
const STRANGER_SK = deriveNostrSecretKey("0x" + "4b".repeat(65));
const WALLET = "0xabc0000000000000000000000000000000000abc";
const BINDINGS = new Map([[CITIZEN_PK, WALLET]]);
const MECKY = deriveAgentIdentity("a-node-secret-with-plenty-of-entropy-0123456789", "roebel", "mecky");

describe("backfeed classification — the trust rules", () => {
  it("a bound citizen's plain note is a post", () => {
    const v = classify(buildNoteEvent(CITIZEN_SK, "Moin"), BINDINGS, new Set());
    assert.deepEqual(v, { type: "post", content: "Moin" });
  });

  it("REFUSES an unbound author — no binding, no wallet, no attribution", () => {
    const v = classify(buildNoteEvent(STRANGER_SK, "Moin"), BINDINGS, new Set());
    assert.deepEqual(v, { type: "skip", reason: "not-a-bound-citizen" });
  });

  it("REFUSES agent-labelled events — an agent must not enter the feed as a person", () => {
    const v = classify(buildAgentNoteEvent(MECKY, "Moin"), new Map([[MECKY.publicKey, WALLET]]), new Set());
    assert.deepEqual(v, { type: "skip", reason: "agent" });
  });

  it("skips what the ledger already knows — the app published it itself", () => {
    const note = buildNoteEvent(CITIZEN_SK, "Moin");
    const v = classify(note, BINDINGS, new Set([note.id]));
    assert.deepEqual(v, { type: "skip", reason: "already-known" });
  });

  it("a reply threads as a comment; a reaction maps as a like", () => {
    const reply = buildNoteEvent(CITIZEN_SK, "Stimmt!", { tags: [["e", "a".repeat(64), "", "root"]] });
    assert.deepEqual(classify(reply, BINDINGS, new Set()), {
      type: "comment",
      parentEventId: "a".repeat(64),
      content: "Stimmt!",
    });
    const like = buildEvent(CITIZEN_SK, 7, "+", { tags: [["e", "b".repeat(64)]] });
    assert.deepEqual(classify(like, BINDINGS, new Set()), { type: "like", parentEventId: "b".repeat(64) });
  });
});

describe("a backfeed pass", () => {
  function harness(events: NostrEvent[], tables: Record<string, Record<string, unknown>[]>) {
    const inserted: { table: string; body: Record<string, unknown> }[] = [];
    return {
      inserted,
      deps: {
        relayUrl: "ws://relay",
        cutover: 1_000,
        fetchRows: async (table: string, query: string) => {
          if (table === "nostr_identities") {
            return [{ wallet_address: WALLET, pubkey_hex: CITIZEN_PK, revoked_at: null }];
          }
          if (table === "nostr_publications" && query.includes("source_type=eq.post")) {
            return tables.parentLookup ?? [];
          }
          if (table === "nostr_publications") return tables.ledger ?? [];
          return tables[table] ?? [];
        },
        insertRow: async (table: string, body: Record<string, unknown>) => {
          inserted.push({ table, body });
          return { id: `${table}-row-1`, ...body };
        },
        makeClient: () => ({ query: async () => events, close: () => {} }),
      },
    };
  }

  it("ingests a third-party post attributed to the owner wallet, and writes the ledger", async () => {
    const note = buildNoteEvent(CITIZEN_SK, "Aus einem anderen Client");
    const h = harness([note], {});
    const summary = await backfeedOnce(h.deps);

    assert.equal(summary.posts, 1);
    const post = h.inserted.find((i) => i.table === "posts")!;
    assert.equal(post.body.wallet_address, WALLET);
    assert.equal(post.body.content, "Aus einem anderen Client");
    const ledger = h.inserted.find((i) => i.table === "nostr_publications")!;
    assert.equal(ledger.body.event_id, note.id);
  });

  it("never double-ingests what the ledger knows", async () => {
    const note = buildNoteEvent(CITIZEN_SK, "Schon da");
    const h = harness([note], { ledger: [{ event_id: note.id }] });
    const summary = await backfeedOnce(h.deps);
    assert.equal(summary.posts, 0);
    assert.equal(summary.skipped, 1);
    assert.equal(h.inserted.length, 0);
  });

  it("a comment lands on the app post its parent event maps to", async () => {
    const reply = buildNoteEvent(CITIZEN_SK, "Gute Idee", { tags: [["e", "c".repeat(64)]] });
    const h = harness([reply], { parentLookup: [{ source_id: "post-uuid-9" }] });
    const summary = await backfeedOnce(h.deps);
    assert.equal(summary.comments, 1);
    const comment = h.inserted.find((i) => i.table === "post_comments")!;
    assert.equal(comment.body.post_id, "post-uuid-9");
    assert.equal(comment.body.wallet_address, WALLET);
  });

  it("drops a comment whose parent is unknown — a reply into nowhere threads nowhere", async () => {
    const reply = buildNoteEvent(CITIZEN_SK, "Wozu?", { tags: [["e", "d".repeat(64)]] });
    const h = harness([reply], { parentLookup: [] });
    const summary = await backfeedOnce(h.deps);
    assert.equal(summary.comments, 0);
    assert.equal(h.inserted.length, 0);
  });

  it("events older than the cutover are fenced off", async () => {
    const old = buildNoteEvent(CITIZEN_SK, "aus der Vorzeit", { createdAt: 500 });
    const h = harness([old], {});
    const summary = await backfeedOnce(h.deps);
    assert.equal(summary.posts, 0);
    assert.equal(summary.skipped, 1);
  });
});
