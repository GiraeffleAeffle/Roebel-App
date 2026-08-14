import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildAgentNoteEvent, buildCivicDiscussionEvent, buildNoteEvent, deriveAgentIdentity, deriveNostrSecretKey, type NostrEvent } from "@netizen-labs/nostr";
import { DEFAULT_BOUNDS, emptyHistory } from "../src/bounds";
import { watchOnce, type WatcherDeps } from "../src/watcher";

const MECKY = deriveAgentIdentity("a-node-secret-with-plenty-of-entropy-0123456789", "roebel", "mecky");
const CITIZEN = deriveNostrSecretKey("0x" + "9c".repeat(65));
const NOW = 1_785_000_000;

function harness(
  mentions: NostrEvent[],
  think: (q: string) => Promise<string | null> = async () => "Antwort",
  bounds = DEFAULT_BOUNDS,
) {
  const published: NostrEvent[] = [];
  const filters: Record<string, unknown>[] = [];
  return {
    published,
    filters,
    deps: {
      agent: MECKY,
      history: emptyHistory(),
      bounds,
      relayUrl: "ws://relay",
      now: () => NOW,
      think,
      makeClient: () => ({
        query: async (f: unknown[]) => {
          filters.push(...(f as Record<string, unknown>[]));
          return mentions;
        },
        publish: async (e: NostrEvent) => {
          published.push(e);
          return { ok: true, message: "" };
        },
        close: () => {},
      }),
    } as WatcherDeps,
  };
}

describe("answering a mention", () => {
  it("reads citizen mentions from one relay and restores/publishes Mecky replies on another", async () => {
    const question = buildNoteEvent(CITIZEN, "getrennte Relays", {
      createdAt: NOW - 5,
      tags: [["p", MECKY.publicKey]],
    });
    const queried: string[] = [];
    const published: { url: string; event: NostrEvent }[] = [];
    const closed: string[] = [];
    const deps = {
      agent: MECKY,
      history: emptyHistory(),
      relayUrl: "ws://citizen-relay",
      replyRelayUrl: "ws://agent-relay",
      now: () => NOW,
      think: async () => "Antwort auf dem Agent-Relay",
      makeClient: (url: string) => ({
        query: async () => {
          queried.push(url);
          return url === "ws://citizen-relay" ? [question] : [];
        },
        publish: async (event: NostrEvent) => {
          published.push({ url, event });
          return { ok: true, message: "" };
        },
        close: () => closed.push(url),
      }),
    } satisfies WatcherDeps;

    const result = await watchOnce(deps);

    assert.equal(result.answered, 1);
    assert.deepEqual(queried, ["ws://citizen-relay", "ws://agent-relay"]);
    assert.deepEqual(published.map((entry) => entry.url), ["ws://agent-relay"]);
    assert.deepEqual(closed.sort(), ["ws://agent-relay", "ws://citizen-relay"]);
  });

  it("uses one relay connection when the reply relay is unchanged", async () => {
    const urls: string[] = [];
    const h = harness([]);
    h.deps.makeClient = (url: string) => {
      urls.push(url);
      return {
        query: async () => [],
        publish: async () => ({ ok: true, message: "" }),
        close: () => {},
      };
    };

    await watchOnce(h.deps);

    assert.deepEqual(urls, ["ws://relay"]);
  });

  it("answers a civic discussion without prematurely creating or admitting a CivicCase", async () => {
    const question = buildCivicDiscussionEvent(CITIZEN, {
      municipalityId: "roebel-mueritz",
      sourceCaseId: "marienfelder-strasse",
      canonicalCaseId:
        "urn:stadtstack:case:municipality:roebel-mueritz:018f0000-0000-7000-8000-000000000001",
      agentPubkey: MECKY.publicKey,
      content: "@Mecky Kann hier eine sichere Querung geprüft werden?",
      createdAt: NOW - 5,
    });
    let thought = 0;
    const h = harness([question], async () => {
      thought += 1;
      return "Aus geprüften Quellen.";
    });

    const result = await watchOnce(h.deps);

    assert.equal(result.answered, 1);
    assert.equal(thought, 1);
    assert.equal(h.published.length, 1);
    assert.equal(h.published[0]?.content, "Aus geprüften Quellen.");
  });

  it("asks the relay for events tagging the agent", async () => {
    const h = harness([]);
    await watchOnce(h.deps);
    assert.deepEqual(h.filters[0]["#p"], [MECKY.publicKey]);
    assert.deepEqual(h.filters[0].kinds, [1]);
  });

  it("backfills an older unanswered mention within the reviewed lookback window", async () => {
    const question = buildNoteEvent(CITIZEN, "beim Start verpasst", {
      createdAt: NOW - 1_200,
      tags: [["p", MECKY.publicKey]],
    });
    const h = harness([question]);
    h.deps.lookbackSeconds = 86_400;

    const result = await watchOnce(h.deps);

    assert.equal(result.answered, 1);
    assert.equal(h.filters[0].since, NOW - 86_400);
    assert.equal(h.published.length, 1);
  });

  it("rejects lookback windows outside the reviewed one-minute to one-day boundary", async () => {
    for (const invalid of [59, 86_401, 60.5, Number.NaN]) {
      const h = harness([]);
      h.deps.lookbackSeconds = invalid;
      await assert.rejects(watchOnce(h.deps), /watcher_lookback_seconds_invalid/);
    }
  });

  it("replies as a threaded, agent-labelled note", async () => {
    const question = buildNoteEvent(CITIZEN, "Wann tagt der Stadtrat?", { createdAt: NOW - 5 });
    const h = harness([question], async () => "Am Dienstag um 18 Uhr.");
    const result = await watchOnce(h.deps);

    assert.equal(result.answered, 1);
    const reply = h.published[0];
    assert.equal(reply.content, "Am Dienstag um 18 Uhr.");
    // threaded onto the question, and addressed back to the asker
    assert.ok(reply.tags.some((t) => t[0] === "e" && t[1] === question.id));
    assert.ok(reply.tags.some((t) => t[0] === "p" && t[1] === question.pubkey));
    // and unmistakably machine-authored
    assert.ok(reply.tags.some((t) => t[0] === "netizen_agent"));
  });

  it("keeps a deterministic civic receipt on the signed Mecky reply", async () => {
    const question = buildCivicDiscussionEvent(CITIZEN, {
      municipalityId: "roebel-mueritz",
      sourceCaseId: "marienfelder-strasse",
      canonicalCaseId:
        "urn:stadtstack:case:municipality:roebel-mueritz:018f0000-0000-7000-8000-000000000001",
      agentPubkey: MECKY.publicKey,
      content: "@Mecky Kann hier eine sichere Querung geprüft werden?",
      createdAt: NOW - 5,
    });
    const receiptId = `urn:stadtstack:mecky-answer:${"a".repeat(64)}`;
    const h = harness([question], async () => ({
      content: "Nur aus geprüften Quellen beantwortet.",
      tags: [
        ["mecky-receipt", receiptId],
        ["municipality", "roebel-mueritz"],
        ["case", "marienfelder-strasse"],
      ],
    }) as never);

    const result = await watchOnce(h.deps);

    assert.equal(result.answered, 1);
    assert.equal(h.published[0]?.content, "Nur aus geprüften Quellen beantwortet.");
    assert.ok(h.published[0]?.tags.some((tag) => tag[0] === "mecky-receipt" && tag[1] === receiptId));
    assert.ok(h.published[0]?.tags.some((tag) => tag[0] === "municipality" && tag[1] === "roebel-mueritz"));
    assert.ok(h.published[0]?.tags.some((tag) => tag[0] === "case" && tag[1] === "marienfelder-strasse"));
  });

  it("answers a burst oldest-first, in the order asked", async () => {
    const first = buildNoteEvent(CITIZEN, "erste", { createdAt: NOW - 50 });
    const second = buildNoteEvent(CITIZEN, "zweite", { createdAt: NOW - 10 });
    const h = harness([second, first], async (q) => `re: ${q}`);
    await watchOnce(h.deps);
    assert.deepEqual(h.published.map((e) => e.content), ["re: erste", "re: zweite"]);
  });

  it("does not answer the same question twice across passes", async () => {
    const question = buildNoteEvent(CITIZEN, "einmal", { createdAt: NOW - 5 });
    const h = harness([question]);
    await watchOnce(h.deps);
    await watchOnce(h.deps);
    assert.equal(h.published.length, 1);
  });

  it("does not answer again after restart when its relay reply already exists", async () => {
    const question = buildNoteEvent(CITIZEN, "nur einmal, auch nach Neustart", {
      createdAt: NOW - 10,
    });
    const existingReply = buildAgentNoteEvent(MECKY, "Schon beantwortet.", {
      createdAt: NOW - 5,
      tags: [
        ["e", question.id, "", "reply"],
        ["p", question.pubkey],
      ],
    });
    let thought = 0;
    const h = harness([question, existingReply], async () => {
      thought += 1;
      return "Doppelte Antwort";
    });

    const result = await watchOnce(h.deps);

    assert.equal(result.answered, 0);
    assert.equal(thought, 0);
    assert.equal(h.published.length, 0);
    assert.deepEqual(h.filters[1].authors, [MECKY.publicKey]);
  });

  it("does not trust a forged relay reply as restart evidence", async () => {
    const question = buildNoteEvent(CITIZEN, "bitte wirklich beantworten", {
      createdAt: NOW - 10,
    });
    const signedReply = buildAgentNoteEvent(MECKY, "Gefälschte Historie.", {
      createdAt: NOW - 5,
      tags: [
        ["e", question.id, "", "reply"],
        ["p", question.pubkey],
      ],
    });
    const forgedReply = { ...signedReply, sig: "00".repeat(64) };
    const h = harness([question, forgedReply]);

    const result = await watchOnce(h.deps);

    assert.equal(result.answered, 1);
    assert.equal(h.published.length, 1);
  });

  it("does not answer a mention with an invalid Nostr signature", async () => {
    const signedQuestion = buildNoteEvent(CITIZEN, "nicht verifiziert", {
      createdAt: NOW - 10,
    });
    const forgedQuestion = { ...signedQuestion, sig: "00".repeat(64) };
    let thought = 0;
    const h = harness([forgedQuestion], async () => {
      thought += 1;
      return "Nicht senden";
    });

    const result = await watchOnce(h.deps);

    assert.equal(result.seen, 0);
    assert.equal(result.answered, 0);
    assert.equal(thought, 0);
    assert.equal(h.published.length, 0);
  });

  it("restores the daily cap from its relay replies after restart", async () => {
    const oldQuestion = buildNoteEvent(CITIZEN, "alte Frage", {
      createdAt: NOW - 20,
    });
    const existingReply = buildAgentNoteEvent(MECKY, "Schon beantwortet.", {
      createdAt: NOW - 15,
      tags: [
        ["e", oldQuestion.id, "", "reply"],
        ["p", oldQuestion.pubkey],
      ],
    });
    const newQuestion = buildNoteEvent(CITIZEN, "neue Frage", {
      createdAt: NOW - 5,
    });
    const h = harness(
      [newQuestion, existingReply],
      async () => "Zu viel",
      { ...DEFAULT_BOUNDS, perDay: 1 },
    );

    const result = await watchOnce(h.deps);

    assert.equal(result.answered, 0);
    assert.equal(result.refused["daily-cap"], 1);
    assert.equal(h.published.length, 0);
  });

  it("skips another agent's post without spending a thought", async () => {
    let thought = 0;
    const other = deriveAgentIdentity("a-node-secret-with-plenty-of-entropy-0123456789", "roebel", "newsroom");
    const h = harness([buildAgentNoteEvent(other, "hallo", { createdAt: NOW })], async () => {
      thought += 1;
      return "x";
    });
    const result = await watchOnce(h.deps);
    assert.equal(result.answered, 0);
    assert.equal(thought, 0, "must refuse before calling the model");
    assert.equal(result.refused["other-agent"], 1);
  });

  it("marks a declined question answered, so it is not retried forever", async () => {
    const question = buildNoteEvent(CITIZEN, "unbeantwortbar", { createdAt: NOW - 5 });
    const h = harness([question], async () => null);
    await watchOnce(h.deps);
    await watchOnce(h.deps);
    assert.equal(h.published.length, 0);
  });

  it("retries when the RELAY refused the reply — that is not the asker's fault", async () => {
    const question = buildNoteEvent(CITIZEN, "frage", { createdAt: NOW - 5 });
    const published: NostrEvent[] = [];
    const deps = {
      agent: MECKY, history: emptyHistory(), relayUrl: "ws://relay", now: () => NOW,
      think: async () => "Antwort",
      makeClient: () => ({
        query: async () => [question],
        publish: async (e: NostrEvent) => {
          published.push(e);
          return { ok: false, message: "blocked" };
        },
        close: () => {},
      }),
    } as never;
    await watchOnce(deps);
    await watchOnce(deps);
    assert.equal(published.length, 2, "a rejected reply must be retried");
  });

  it("a thinking failure does not abort the pass", async () => {
    const bad = buildNoteEvent(CITIZEN, "explodiert", { createdAt: NOW - 50 });
    const good = buildNoteEvent(CITIZEN, "geht", { createdAt: NOW - 10 });
    let call = 0;
    const h = harness([bad, good], async () => {
      call += 1;
      if (call === 1) throw new Error("model down");
      return "Antwort";
    });
    const result = await watchOnce(h.deps);
    assert.equal(result.answered, 1);
  });
});
