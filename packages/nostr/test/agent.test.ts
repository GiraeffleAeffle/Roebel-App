import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  AGENT_TAG,
  agentOf,
  buildAgentNoteEvent,
  buildAgentProfileEvent,
  deriveAgentIdentity,
  isAgentEvent,
} from "../src/agent";
import { buildNoteEvent, verifyEvent } from "../src/events";
import { deriveNostrSecretKey } from "../src/keys";

const SECRET = "a-node-secret-with-plenty-of-entropy-0123456789";

describe("agent identity derivation", () => {
  it("is deterministic — an agent that loses its state is not a stranger", () => {
    const a = deriveAgentIdentity(SECRET, "roebel", "mecky");
    const b = deriveAgentIdentity(SECRET, "roebel", "mecky");
    assert.equal(a.npub, b.npub);
  });

  it("scopes by NODE, so one agent name on two nodes is two identities", () => {
    // "Mecky of Röbel" and "Mecky of another town" are different actors and must
    // not be able to speak for each other.
    const roebel = deriveAgentIdentity(SECRET, "roebel", "mecky");
    const other = deriveAgentIdentity(SECRET, "testnode", "mecky");
    assert.notEqual(roebel.npub, other.npub);
  });

  it("scopes by AGENT, so two agents on one node never collide", () => {
    assert.notEqual(
      deriveAgentIdentity(SECRET, "roebel", "mecky").npub,
      deriveAgentIdentity(SECRET, "roebel", "newsroom").npub,
    );
  });

  it("changes entirely if the node secret changes", () => {
    assert.notEqual(
      deriveAgentIdentity(SECRET, "roebel", "mecky").npub,
      deriveAgentIdentity(SECRET + "x", "roebel", "mecky").npub,
    );
  });

  it("cannot collide with a Citizen key derived from a wallet signature", () => {
    const agent = deriveAgentIdentity(SECRET, "roebel", "mecky");
    const citizen = deriveNostrSecretKey("0x" + "9c".repeat(65));
    assert.notDeepEqual(agent.secretKey, citizen);
  });

  it("refuses a weak node secret rather than deriving a guessable identity", () => {
    assert.throws(() => deriveAgentIdentity("short", "roebel", "mecky"), /at least 32/);
  });

  it("refuses ids that are not slugs, so a name cannot smuggle separators", () => {
    assert.throws(() => deriveAgentIdentity(SECRET, "Roebel", "mecky"), /lowercase slug/);
    assert.throws(() => deriveAgentIdentity(SECRET, "roebel", "mecky\nagent=x"), /lowercase slug/);
  });
});

describe("agent events are labelled as machine-authored", () => {
  const agent = deriveAgentIdentity(SECRET, "roebel", "mecky");

  it("sets NIP-24 bot:true on the profile", () => {
    // The standard field every client already understands. An unlabelled agent in
    // a civic feed is indistinguishable from a resident.
    const event = buildAgentProfileEvent(agent, { name: "Mecky" }, { createdAt: 1 });
    const content = JSON.parse(event.content);
    assert.equal(content.bot, true);
    assert.equal(content.name, "Mecky");
    assert.ok(verifyEvent(event));
  });

  it("tags every note so one event is self-describing without the profile", () => {
    const event = buildAgentNoteEvent(agent, "Der Stadtrat tagt am Dienstag.", { createdAt: 1 });
    assert.ok(isAgentEvent(event));
    assert.deepEqual(agentOf(event), { name: "mecky", nodeId: "roebel" });
    assert.ok(verifyEvent(event));
  });

  it("keeps caller tags alongside the agent tag", () => {
    const event = buildAgentNoteEvent(agent, "x", { createdAt: 1, tags: [["t", "stadtrat"]] });
    assert.ok(event.tags.some((t) => t[0] === "t" && t[1] === "stadtrat"));
    assert.ok(event.tags.some((t) => t[0] === AGENT_TAG));
  });

  it("a citizen's note is NOT reported as agent-authored", () => {
    const citizen = deriveNostrSecretKey("0x" + "9c".repeat(65));
    const event = buildNoteEvent(citizen, "Moin", { createdAt: 1 });
    assert.equal(isAgentEvent(event), false);
    assert.equal(agentOf(event), null);
  });
});
