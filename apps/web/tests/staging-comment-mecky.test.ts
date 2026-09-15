import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { requestStagingCommentMecky } from "../src/lib/staging-participant/comment-mecky";
import { createCitizenSession } from "../src/lib/citizen-session/session";
import { verifyEvent } from "@netizen-labs/nostr";
const originalFetch = globalThis.fetch;
const originalStorage = Object.getOwnPropertyDescriptor(
  globalThis,
  "localStorage"
);
const rows = new Map<string, string>();
function setup() {
  rows.clear();
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      getItem: (k: string) => rows.get(k) ?? null,
      setItem: (k: string, v: string) => rows.set(k, v),
      removeItem: (k: string) => rows.delete(k),
    },
  });
}
afterEach(() => {
  globalThis.fetch = originalFetch;
  if (originalStorage)
    Object.defineProperty(globalThis, "localStorage", originalStorage);
  else Reflect.deleteProperty(globalThis, "localStorage");
});
const first = "0x" + "1".repeat(40),
  second = "0x" + "2".repeat(40);
function session(address: string) {
  return createCitizenSession({
    appAccountId: `account-${address}`,
    memberId: null,
    credential: {
      kind: "thirdweb_smart_account",
      address: address as `0x${string}`,
      chainId: 100,
      signMessage: async () =>
        `0x${address.slice(2, 4).repeat(65)}` as `0x${string}`,
    },
  });
}
const comment = {
  id: "10000000-0000-4000-8000-000000000001",
  post_id: "20000000-0000-4000-8000-000000000001",
  wallet_address: first,
  content: "@Mecky, was sagt Verkehr?",
};
function config() {
  return new Response(
    JSON.stringify({
      schemaVersion: "roebel_e2e_workbench_config_v1",
      authorityBinding: "none",
      personas: [],
      meckyPubkey: "a".repeat(64),
    })
  );
}

test("two citizens retain distinct signed feed questions; retry survives a lost response without retaining wallet proof", async () => {
  setup();
  const bodies: any[] = [];
  let fail = true;
  globalThis.fetch = async (url, init) => {
    if (String(url).endsWith("/instance")) return config();
    assert.equal(url, "/api/staging-participant/v1/nostr-comment");
    const body = JSON.parse(String(init?.body));
    bodies.push(body);
    assert.equal(verifyEvent(body.event), true);
    if (fail) {
      fail = false;
      throw Error("lost response");
    }
    return new Response(
      JSON.stringify({
        status: "published",
        eventId: body.event.id,
        authority: "none",
      })
    );
  };
  const one = session(first),
    two = session(second);
  await assert.rejects(requestStagingCommentMecky({ comment, session: one }));
  const eventId = await requestStagingCommentMecky({ comment, session: one });
  assert.equal(eventId, bodies[0].event.id);
  assert.equal(bodies[0].requestId, bodies[1].requestId);
  await requestStagingCommentMecky({ comment, session: one });
  assert.equal(bodies[2].event.id, eventId);
  await requestStagingCommentMecky({
    comment: {
      ...comment,
      id: "10000000-0000-4000-8000-000000000002",
      wallet_address: second,
    },
    session: two,
  });
  assert.notEqual(bodies[3].event.pubkey, bodies[0].event.pubkey);
  assert.equal(bodies[3].sourcePostId, bodies[0].sourcePostId);
  assert.notEqual(bodies[3].sourceCommentId, bodies[0].sourceCommentId);
  assert.equal(rows.size, 2);
  for (const saved of rows.values())
    assert.doesNotMatch(saved, /walletSignature|admissionProof|credential/);
});

test("a different logged-in account cannot request a reply for someone else's comment", async () => {
  setup();
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    throw Error("must not call");
  };
  await assert.rejects(
    requestStagingCommentMecky({ comment, session: session(second) }),
    /verbundenen Konto/
  );
  await assert.rejects(
    requestStagingCommentMecky({
      comment: { ...comment, content: "Ohne Erwähnung" },
      session: session(first),
    })
  );
  assert.equal(calls, 0);
});

test("a proven stale first attempt is renewed once; a mismatched acknowledgement is never success", async () => {
  setup();
  const bodies: any[] = [];
  globalThis.fetch = async (url, init) => {
    if (String(url).endsWith("/instance")) return config();
    bodies.push(JSON.parse(String(init?.body)));
    return bodies.length === 1
      ? new Response(JSON.stringify({ error: "nostr_comment_stale" }), {
          status: 400,
        })
      : new Response(
          JSON.stringify({
            status: "published",
            eventId: "f".repeat(64),
            authority: "none",
          })
        );
  };
  await assert.rejects(
    requestStagingCommentMecky({ comment, session: session(first) }),
    /erneut/
  );
  assert.equal(bodies.length, 2);
  assert.notEqual(bodies[0].requestId, bodies[1].requestId);
  assert.equal(rows.size, 1);
});
