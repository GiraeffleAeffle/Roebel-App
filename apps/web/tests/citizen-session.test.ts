import assert from "node:assert/strict";
import { test } from "node:test";
import {
  createCitizenSession,
  type CitizenCredential,
} from "../src/lib/citizen-session/session";
import { createThirdwebCitizenSession } from "../src/lib/citizen-session/thirdweb-adapter";
import {
  NOSTR_KEY_DERIVATION_MESSAGE,
  verifyBindingEvent,
  verifyEvent,
} from "@netizen-labs/nostr";
import { readFileSync } from "node:fs";

const ADDRESS = "0x1111111111111111111111111111111111111111";
const SIGNATURE = `0x${"42".repeat(65)}`;

function credential(
  overrides: Partial<CitizenCredential> = {}
): CitizenCredential {
  return {
    kind: "thirdweb_smart_account",
    address: ADDRESS,
    chainId: 100,
    signMessage: async () => SIGNATURE,
    ...overrides,
  };
}

test("exposes a provider-neutral immutable citizen snapshot", () => {
  const session = createCitizenSession({
    appAccountId: "account-1",
    credential: credential(),
    memberId: null,
  });

  assert.deepEqual(session.snapshot, {
    schemaVersion: "roebel_citizen_session_v1",
    status: "authenticated",
    memberId: null,
    appAccountId: "account-1",
    credential: {
      kind: "thirdweb_smart_account",
      address: ADDRESS,
      chainId: 100,
    },
    assurance: {
      authentication: "provider_authenticated",
      authorization: "legacy_wallet_projection",
      recovery: "provider_managed",
    },
    capabilities: ["message_signing", "nostr_signing"],
  });
  assert.ok(Object.isFrozen(session.snapshot));
  assert.equal("provider" in session.snapshot, false);
});

test("derives the Nostr identity once and signs ordinary posts without exposing the key", async () => {
  let signatureCalls = 0;
  const session = createCitizenSession({
    appAccountId: "account-1",
    credential: credential({
      signMessage: async () => {
        signatureCalls += 1;
        return SIGNATURE;
      },
    }),
    memberId: null,
  });

  const first = await session.signPublicPost({
    content: "Normaler Beitrag",
    createdAt: 10,
  });
  const second = await session.signPublicPost({
    content: "Noch ein Beitrag",
    createdAt: 11,
  });

  assert.equal(signatureCalls, 1);
  assert.equal(first.kind, 1);
  assert.equal(first.tags.length, 0);
  assert.equal(first.content, "Normaler Beitrag");
  assert.equal(second.pubkey, first.pubkey);
  assert.equal(verifyEvent(first), true);
  assert.equal(verifyEvent(second), true);
  assert.equal("secretKey" in session, false);
});

test("creates a mutual wallet and Nostr admission proof without exposing either secret", async () => {
  const messages: string[] = [];
  const session = createCitizenSession({
    appAccountId: "account-1",
    credential: credential({
      signMessage: async ({ message }) => {
        messages.push(message);
        return SIGNATURE;
      },
    }),
    memberId: null,
  });

  const proof = await session.createAdmissionProof({ createdAt: 12 });

  assert.equal(messages[0], NOSTR_KEY_DERIVATION_MESSAGE);
  assert.equal(messages[1], proof.statement);
  assert.equal(proof.walletSignature, SIGNATURE);
  assert.equal(proof.bindingEvent.content, proof.statement);
  assert.deepEqual(verifyBindingEvent(proof.bindingEvent, ADDRESS), {
    valid: true,
    account: ADDRESS,
    pubkey: proof.bindingEvent.pubkey,
    npub: proof.statement.split("npub=")[1],
  });
  assert.equal("secretKey" in proof, false);
  assert.equal("derivationSignature" in proof, false);
});

test("adds only explicit Nostr mentions to an ordinary signed post", async () => {
  const session = createCitizenSession({
    appAccountId: "account-1",
    credential: credential(),
    memberId: null,
  });
  const mecky = "ab".repeat(32);
  const post = await session.signPublicPost({
    content: "@Mecky, was ist dazu bekannt?",
    createdAt: 13,
    mentionPubkeys: [mecky, mecky],
  });

  assert.deepEqual(post.tags, [["p", mecky]]);
  assert.equal(verifyEvent(post), true);
});

test("binds an ordinary signed post to the immutable Röbel app post it mirrors", async () => {
  const session = createCitizenSession({
    appAccountId: "account-1",
    credential: credential(),
    memberId: null,
  });
  const post = await session.signPublicPost({
    content: "Die Querung an der Marienfelder Straße ist unübersichtlich.",
    createdAt: 14,
    sourceAppPostId: "018f1c63-7b2a-7a11-8a55-2e3d9c4b5a61",
  });

  assert.deepEqual(post.tags, [
    ["source-app-post", "018f1c63-7b2a-7a11-8a55-2e3d9c4b5a61"],
  ]);
  assert.equal(verifyEvent(post), true);
});

test("promotes only the authenticated citizen's signed source post", async () => {
  const session = createCitizenSession({
    appAccountId: "account-1",
    credential: credential(),
    memberId: null,
  });
  const sourcePost = await session.signPublicPost({
    content: "Hinweis",
    createdAt: 20,
  });
  const promoted = await session.promotePublicPost({
    sourcePost,
    municipalityId: "roebel-mueritz",
    sourceCaseId: "marienfelder-strasse",
    canonicalCaseId:
      "urn:stadtstack:case:municipality:roebel-mueritz:018f1c63-7b2a-7a11-8a55-2e3d9c4b5a61",
    topicId:
      "urn:stadtstack:topic:municipality:roebel-mueritz:marienfelder-strasse",
    agentPubkey: "ab".repeat(32),
    content: "@Mecky, welche geprüften Informationen liegen vor?",
    createdAt: 21,
  });

  assert.equal(promoted.pubkey, sourcePost.pubkey);
  assert.equal(verifyEvent(promoted), true);
  assert.deepEqual(
    promoted.tags.find((tag) => tag[0] === "source-post"),
    ["source-post", sourcePost.id]
  );
  assert.deepEqual(
    promoted.tags.find((tag) => tag[0] === "topic"),
    [
      "topic",
      "urn:stadtstack:topic:municipality:roebel-mueritz:marienfelder-strasse",
    ]
  );
});

test("starts a signed civic topic without creating a CivicCase binding", async () => {
  const session = createCitizenSession({
    appAccountId: "account-1",
    credential: credential(),
    memberId: null,
  });
  const sourcePost = await session.signPublicPost({
    content: "Uns fehlt ein gemeinsamer Treffpunkt.",
    createdAt: 30,
    sourceAppPostId: "018f1c63-7b2a-4a11-8a55-2e3d9c4b5a61",
  });

  const promoted = await session.promotePublicPostToTopic({
    sourcePost,
    municipalityId: "roebel-mueritz",
    topicId:
      "urn:stadtstack:topic:municipality:roebel-mueritz:offener-treffpunkt",
    topicTitle: "Offener Treffpunkt in Röbel",
    agentPubkey: "ab".repeat(32),
    content: "@Mecky, welche geprüften Informationen liegen dazu vor?",
    createdAt: 31,
  });

  assert.equal(verifyEvent(promoted), true);
  assert.equal(promoted.tags.some((tag) => tag[0] === "case"), false);
  assert.equal(
    promoted.tags.some((tag) => tag[0] === "stadtstack-case"),
    false
  );
});

test("signs a participant's argument without exposing either citizen key", async () => {
  const author = createCitizenSession({
    appAccountId: "account-1",
    credential: credential(),
    memberId: null,
  });
  const participant = createCitizenSession({
    appAccountId: "account-2",
    credential: credential({
      address: "0x2222222222222222222222222222222222222222",
      signMessage: async () => `0x${"43".repeat(65)}`,
    }),
    memberId: null,
  });
  const sourcePost = await author.signPublicPost({
    content: "Uns fehlt ein gemeinsamer Treffpunkt.",
    createdAt: 40,
    sourceAppPostId: "018f1c63-7b2a-4a11-8a55-2e3d9c4b5a61",
  });
  const root = await author.promotePublicPostToTopic({
    sourcePost,
    municipalityId: "roebel-mueritz",
    topicId: "urn:stadtstack:topic:municipality:roebel-mueritz:treffpunkt",
    topicTitle: "Offener Treffpunkt",
    agentPubkey: "ab".repeat(32),
    content: "@Mecky, welche Optionen gibt es?",
    createdAt: 41,
  });
  const argument = await participant.signCivicArgument({
    rootEvent: root,
    parentEvent: root,
    municipalityId: "roebel-mueritz",
    topicId: "urn:stadtstack:topic:municipality:roebel-mueritz:treffpunkt",
    stance: "con",
    content: "Betrieb und Zugänglichkeit müssen dauerhaft geklärt sein.",
    createdAt: 42,
  });

  assert.notEqual(argument.pubkey, root.pubkey);
  assert.equal(verifyEvent(argument), true);
  assert.equal(argument.tags.some((tag) => tag[0] === "case"), false);
});

test("fails closed when the provider returns a malformed signature", async () => {
  const session = createCitizenSession({
    appAccountId: null,
    credential: credential({ signMessage: async () => "not-a-signature" }),
    memberId: null,
  });

  await assert.rejects(
    () => session.signPublicPost({ content: "Nicht signierbar", createdAt: 1 }),
    /citizen_session_signature_invalid/
  );
});

test("adapts Thirdweb structurally without exposing its SDK to civic callers", async () => {
  const messages: string[] = [];
  const session = createThirdwebCitizenSession({
    account: {
      address: ADDRESS,
      signMessage: async ({ message }) => {
        messages.push(message);
        return SIGNATURE;
      },
    },
    appAccountId: "account-1",
    memberId: null,
  });

  assert.equal(session.snapshot.credential.kind, "thirdweb_smart_account");
  assert.equal(session.snapshot.credential.chainId, 100);
  assert.equal(await session.signMessage("Beweis"), SIGNATURE);
  assert.deepEqual(messages, ["Beweis"]);

  const coreSource = readFileSync(
    new URL("../src/lib/citizen-session/session.ts", import.meta.url),
    "utf8"
  );
  const adapterSource = readFileSync(
    new URL("../src/lib/citizen-session/thirdweb-adapter.ts", import.meta.url),
    "utf8"
  );
  assert.doesNotMatch(coreSource, /from ["']thirdweb/);
  assert.doesNotMatch(adapterSource, /from ["']thirdweb/);
});
