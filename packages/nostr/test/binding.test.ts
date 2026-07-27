import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  BINDING_ACCOUNT_TAG,
  BINDING_D_TAG,
  bindingStatement,
  buildBindingEvent,
  verifyBindingEvent,
} from "../src/binding.js";
import { deriveNostrIdentity, deriveNostrSecretKey } from "../src/keys.js";

const SIGNATURE =
  "0x" +
  "9c1f2b3a4d5e6f708192a3b4c5d6e7f8091a2b3c4d5e6f708192a3b4c5d6e7f8" +
  "1b2c3d4e5f60718293a4b5c6d7e8f9001a2b3c4d5e6f708192a3b4c5d6e7f809" +
  "1b";

const SECRET_KEY = deriveNostrSecretKey(SIGNATURE);
const IDENTITY = deriveNostrIdentity(SIGNATURE);
const ACCOUNT = "0x59aA26f499D7C2B3EC2c8524Ed06F54fc4E85dE5";
const CREATED_AT = 1_753_600_000;

describe("binding statement", () => {
  it("is byte-identical regardless of address casing", () => {
    assert.equal(
      bindingStatement({ account: ACCOUNT, npub: IDENTITY.npub }),
      bindingStatement({ account: ACCOUNT.toLowerCase(), npub: IDENTITY.npub }),
    );
  });

  it("names both halves of the binding", () => {
    const statement = bindingStatement({ account: ACCOUNT, npub: IDENTITY.npub });
    assert.equal(statement.split("\n")[0], "Netizen Nostr-Binding v1");
    assert.ok(statement.includes(`account=${ACCOUNT.toLowerCase()}`));
    assert.ok(statement.includes(`npub=${IDENTITY.npub}`));
  });

  it("rejects anything that is not an EVM address", () => {
    assert.throws(() => bindingStatement({ account: "0xnope", npub: IDENTITY.npub }), /EVM address/);
  });
});

describe("binding event", () => {
  it("builds a replaceable NIP-78 event tagged with the account", () => {
    const event = buildBindingEvent(SECRET_KEY, ACCOUNT, { createdAt: CREATED_AT });
    assert.equal(event.kind, 30078);
    assert.equal(event.tags.find((t) => t[0] === "d")?.[1], BINDING_D_TAG);
    assert.equal(event.tags.find((t) => t[0] === BINDING_ACCOUNT_TAG)?.[1], ACCOUNT.toLowerCase());
  });

  it("verifies against the expected account, in either casing", () => {
    const event = buildBindingEvent(SECRET_KEY, ACCOUNT, { createdAt: CREATED_AT });
    const result = verifyBindingEvent(event, ACCOUNT);
    assert.ok(result.valid);
    assert.equal(result.account, ACCOUNT.toLowerCase());
    assert.equal(result.pubkey, IDENTITY.publicKey);
    assert.equal(result.npub, IDENTITY.npub);
    assert.ok(verifyBindingEvent(event, ACCOUNT.toLowerCase()).valid);
  });

  it("rejects a binding presented for a different account", () => {
    const event = buildBindingEvent(SECRET_KEY, ACCOUNT, { createdAt: CREATED_AT });
    const result = verifyBindingEvent(event, "0x0000000000000000000000000000000000000001");
    assert.equal(result.valid, false);
    assert.equal(result.valid === false && result.reason, "account-mismatch");
  });

  it("rejects a tampered statement", () => {
    const event = buildBindingEvent(SECRET_KEY, ACCOUNT, { createdAt: CREATED_AT });
    const result = verifyBindingEvent({ ...event, content: "Netizen Nostr-Binding v1" }, ACCOUNT);
    assert.equal(result.valid === false && result.reason, "statement-mismatch");
  });

  it("rejects a forged signature", () => {
    const event = buildBindingEvent(SECRET_KEY, ACCOUNT, { createdAt: CREATED_AT });
    const result = verifyBindingEvent({ ...event, sig: "0".repeat(128) }, ACCOUNT);
    assert.equal(result.valid === false && result.reason, "bad-signature");
  });

  it("rejects the wrong kind", () => {
    const event = buildBindingEvent(SECRET_KEY, ACCOUNT, { createdAt: CREATED_AT });
    const result = verifyBindingEvent({ ...event, kind: 1 }, ACCOUNT);
    assert.equal(result.valid, false);
    assert.equal(result.valid === false && result.reason, "wrong-kind");
  });

  it("rejects the wrong d tag", () => {
    const event = buildBindingEvent(SECRET_KEY, ACCOUNT, { createdAt: CREATED_AT });
    const wrongD = { ...event, tags: [["d", "something-else"], ...event.tags.slice(1)] };
    const result = verifyBindingEvent(wrongD, ACCOUNT);
    assert.equal(result.valid, false);
    assert.equal(result.valid === false && result.reason, "wrong-d-tag");
  });

  it("cannot be replayed under another identity", () => {
    // Take a valid binding and swap in someone else's pubkey. The statement is
    // recomputed from the event's own pubkey, so the content no longer matches.
    const event = buildBindingEvent(SECRET_KEY, ACCOUNT, { createdAt: CREATED_AT });
    const impostor = deriveNostrIdentity(SIGNATURE.slice(0, -4) + "aa1c");
    const result = verifyBindingEvent({ ...event, pubkey: impostor.publicKey }, ACCOUNT);
    assert.equal(result.valid, false);
    assert.equal(result.valid === false && result.reason, "statement-mismatch");
  });
});
