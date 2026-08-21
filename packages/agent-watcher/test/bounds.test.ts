import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildAgentNoteEvent, buildNoteEvent, deriveAgentIdentity, deriveNostrSecretKey } from "@netizen-labs/nostr";
import { DEFAULT_BOUNDS, deferReply, emptyHistory, recordReply, shouldAnswer } from "../src/bounds";

const NODE_SECRET = "a-node-secret-with-plenty-of-entropy-0123456789";
const MECKY = deriveAgentIdentity(NODE_SECRET, "roebel", "mecky");
const OTHER_AGENT = deriveAgentIdentity(NODE_SECRET, "roebel", "newsroom");
const CITIZEN = deriveNostrSecretKey("0x" + "9c".repeat(65));
const NOW = 1_785_000_000;

const ask = (content = "Wann tagt der Stadtrat?") =>
  buildNoteEvent(CITIZEN, content, { createdAt: NOW - 10 });

describe("what an agent will answer", () => {
  it("answers a citizen's question", () => {
    const d = shouldAnswer({ event: ask(), agentPubkey: MECKY.publicKey, history: emptyHistory(), now: NOW });
    assert.equal(d.answer, true);
  });

  it("never answers itself — otherwise a reply mentioning it loops forever", () => {
    const own = buildAgentNoteEvent(MECKY, "meine eigene Antwort", { createdAt: NOW });
    const d = shouldAnswer({ event: own, agentPubkey: MECKY.publicKey, history: emptyHistory(), now: NOW });
    assert.equal(d.reason, "self");
  });

  it("never answers ANOTHER agent — two bots would talk until someone sees the bill", () => {
    const fromBot = buildAgentNoteEvent(OTHER_AGENT, "hallo Mecky", { createdAt: NOW });
    const d = shouldAnswer({ event: fromBot, agentPubkey: MECKY.publicKey, history: emptyHistory(), now: NOW });
    assert.equal(d.reason, "other-agent");
  });

  it("answers each question once, however often the pass sees it", () => {
    const history = emptyHistory();
    const event = ask();
    recordReply(history, event, NOW);
    const d = shouldAnswer({ event, agentPubkey: MECKY.publicKey, history, now: NOW });
    assert.equal(d.reason, "already-answered");
  });

  it("backs off a transient failure and allows a later retry", () => {
    const history = emptyHistory();
    const event = ask("vorübergehend nicht erreichbar");
    deferReply(history, event, NOW);

    assert.equal(
      shouldAnswer({ event, agentPubkey: MECKY.publicKey, history, now: NOW + 59 }).reason,
      "retry-backoff",
    );
    assert.equal(
      shouldAnswer({ event, agentPubkey: MECKY.publicKey, history, now: NOW + 60 }).answer,
      true,
    );
  });

  it("rate-limits a single author", () => {
    const history = emptyHistory();
    for (let i = 0; i < DEFAULT_BOUNDS.perAuthorPerHour; i++) {
      recordReply(history, ask(`frage ${i}`), NOW - i);
    }
    const d = shouldAnswer({ event: ask("noch eine"), agentPubkey: MECKY.publicKey, history, now: NOW });
    assert.equal(d.reason, "author-rate-limit");
  });

  it("lets the same author back in once the window passes", () => {
    const history = emptyHistory();
    for (let i = 0; i < DEFAULT_BOUNDS.perAuthorPerHour; i++) {
      recordReply(history, ask(`alt ${i}`), NOW - 7200);
    }
    const d = shouldAnswer({ event: ask("neu"), agentPubkey: MECKY.publicKey, history, now: NOW });
    assert.equal(d.answer, true);
  });

  it("stops at the daily cap, so a bad prompt cannot drain a budget", () => {
    const history = emptyHistory();
    history.repliedAt = Array.from({ length: DEFAULT_BOUNDS.perDay }, (_, i) => NOW - i);
    const d = shouldAnswer({ event: ask(), agentPubkey: MECKY.publicKey, history, now: NOW });
    assert.equal(d.reason, "daily-cap");
  });

  it("the kill switch stops everything", () => {
    const d = shouldAnswer({
      event: ask(),
      agentPubkey: MECKY.publicKey,
      history: emptyHistory(),
      now: NOW,
      bounds: { ...DEFAULT_BOUNDS, enabled: false },
    });
    assert.equal(d.reason, "kill-switch");
  });

  it("ignores an empty mention", () => {
    const d = shouldAnswer({ event: ask("   "), agentPubkey: MECKY.publicKey, history: emptyHistory(), now: NOW });
    assert.equal(d.reason, "empty");
  });
});
