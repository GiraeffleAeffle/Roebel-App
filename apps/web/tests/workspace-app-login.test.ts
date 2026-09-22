import assert from "node:assert/strict";
import { test } from "node:test";
import { createStagingWorkspaceLogin, STAGING_WORKSPACE_APP, STAGING_WORKSPACE_ISSUER } from "../src/lib/workspace/staging-login-bridge";
import type { CitizenSession } from "../src/lib/citizen-session/session";

function fixture(sign: (message: string) => Promise<string> = async () => "0x11") {
  const calls: string[] = [], sent: unknown[] = [], statuses: string[] = [];
  const session = { snapshot: { credential: { address: "0x" + "1".repeat(40), chainId: 100 } },
    signMessage: async (message: string) => { calls.push(message); return sign(message); } } as CitizenSession;
  const opener = { postMessage: (message: unknown, target: string) => { assert.equal(target, STAGING_WORKSPACE_ISSUER); sent.push(message); } };
  const bridge = createStagingWorkspaceLogin({ session, opener, appOrigin: STAGING_WORKSPACE_APP, onStatus: s => statuses.push(s) });
  const request = { origin: STAGING_WORKSPACE_ISSUER, source: opener,
    data: { schemaVersion: "roebel_workspace_login_request_v1", requestId: "interaction", nonce: "abcdef123456" } };
  return { bridge, request, calls, sent, statuses, session, opener };
}

test("login requires a user gesture, exact issuer and opener, and accepts only one response", async () => {
  const f = fixture();
  try {
    await f.bridge.receive(f.request); assert.equal(f.calls.length, 0);
    f.bridge.start();
    for (const request of [{ ...f.request, origin: "https://foreign.example" }, { ...f.request, source: {} }]) await f.bridge.receive(request);
    assert.equal(f.calls.length, 0);
    await f.bridge.receive(f.request); await f.bridge.receive(f.request);
    assert.equal(f.calls.length, 1); assert.equal(f.sent.length, 2);
    assert.match(f.calls[0]!, /^roebel-id\.staging\.agentcart\.eu wants you to sign in/);
    assert.match(f.calls[0]!, /URI: https:\/\/roebel-id\.staging\.agentcart\.eu\nVersion: 1\nChain ID: 100/);
    assert.equal(f.statuses.at(-1), "sent");
  } finally { f.bridge.dispose(); }
});

test("the channel cannot select an arbitrary message, nonce, chain or redirect", async () => {
  for (const changed of [{ message: "send money" }, { nonce: "bad\nnonce" }, { chainId: 1 }, { redirect: "https://foreign.example" }]) {
    const f = fixture();
    try {
      f.bridge.start(); await f.bridge.receive({ ...f.request, data: { ...f.request.data, ...changed } });
      assert.equal(f.calls.length, 0); assert.equal(f.sent.length, 1); assert.equal(f.statuses.at(-1), "failed");
    } finally { f.bridge.dispose(); }
  }
});

test("production and another chain cannot initialize this staging bridge", () => {
  const f = fixture();
  assert.throws(() => createStagingWorkspaceLogin({ session: f.session, opener: f.opener, appOrigin: "https://roebel.app", onStatus() {} }));
  assert.throws(() => createStagingWorkspaceLogin({ session: { ...f.session, snapshot: { ...f.session.snapshot,
    credential: { ...f.session.snapshot.credential, chainId: 1 } } }, opener: f.opener, appOrigin: STAGING_WORKSPACE_APP, onStatus() {} }));
  f.bridge.dispose();
});

test("cancellation can retry with a fresh request while a stalled issuer times out", async t => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let fail = true;
  const f = fixture(async () => { if (fail) throw Error("cancelled"); return "0x11"; });
  try {
    f.bridge.start(); t.mock.timers.tick(15_000); assert.equal(f.statuses.at(-1), "failed");
    f.bridge.start(); await f.bridge.receive(f.request); assert.equal(f.statuses.at(-1), "failed");
    fail = false; f.bridge.start(); await f.bridge.receive({ ...f.request, data: { ...f.request.data, nonce: "newnonce1234" } });
    assert.equal(f.statuses.at(-1), "sent");
    assert.match(f.calls.at(-1)!, /Nonce: newnonce1234/);
  } finally { f.bridge.dispose(); }
});

test("a pending signer expires at the SIWE deadline and a user can retry", async t => {
  t.mock.timers.enable({ apis: ["setTimeout", "Date"], now: 1_000 });
  const f = fixture(() => new Promise(() => {}));
  try {
    f.bridge.start(); void f.bridge.receive(f.request);
    f.bridge.start();
    t.mock.timers.tick(119_999);
    assert.equal(f.statuses.at(-1), "signing");
    assert.equal(f.sent.length, 1);
    t.mock.timers.tick(1);
    assert.equal(f.statuses.at(-1), "failed");
    f.bridge.start();
    assert.equal(f.statuses.at(-1), "waiting");
    assert.equal(f.sent.length, 2);
    t.mock.timers.tick(15_000);
    assert.equal(f.statuses.at(-1), "failed");
  } finally { f.bridge.dispose(); }
});

for (const settlement of ["resolve", "reject"] as const) {
  for (const retryStatus of ["waiting", "signing", "sent"] as const) {
    test(`expired signer ${settlement} cannot affect a ${retryStatus} retry`, async t => {
      t.mock.timers.enable({ apis: ["setTimeout", "Date"], now: 1_000 });
      let resolveOld!: (signature: string) => void, rejectOld!: (error: Error) => void;
      let resolveNew!: (signature: string) => void;
      let attempt = 0;
      const f = fixture(() => ++attempt === 1
        ? new Promise((resolve, reject) => { resolveOld = resolve; rejectOld = reject; })
        : new Promise(resolve => { resolveNew = resolve; }));
      try {
        f.bridge.start(); const oldPending = f.bridge.receive(f.request);
        t.mock.timers.tick(120_000);
        f.bridge.start();
        assert.equal(f.statuses.at(-1), "waiting");
        let newPending: Promise<void> | undefined;
        if (retryStatus !== "waiting") {
          newPending = f.bridge.receive({ ...f.request, data: { ...f.request.data, requestId: "retry", nonce: "newnonce1234" } });
          if (retryStatus === "sent") { resolveNew("0x22"); await newPending; }
        }
        assert.equal(f.statuses.at(-1), retryStatus);
        const before = { statuses: [...f.statuses], sent: [...f.sent] };
        if (settlement === "resolve") resolveOld("0x11"); else rejectOld(Error("cancelled"));
        await oldPending;
        assert.deepEqual({ statuses: f.statuses, sent: f.sent }, before);
        if (retryStatus === "signing") {
          resolveNew("0x22"); await newPending;
          assert.equal(f.statuses.at(-1), "sent");
        } else if (retryStatus === "waiting") {
          t.mock.timers.tick(15_000);
          assert.equal(f.statuses.at(-1), "failed");
        }
        if (retryStatus !== "waiting") {
          const response = f.sent.at(-1) as { requestId: string; message: string; signature: string };
          assert.equal(response.requestId, "retry");
          assert.equal(response.signature, "0x22");
          t.mock.timers.tick(120_000);
          assert.equal(f.statuses.at(-1), "sent");
          assert.equal(f.sent.length, 3);
          assert.match(response.message, /Nonce: newnonce1234/);
        }
      } finally { f.bridge.dispose(); }
    });
  }

  test(`disposal during signing ignores late ${settlement} and all further gestures`, async t => {
    t.mock.timers.enable({ apis: ["setTimeout", "Date"], now: 1_000 });
    let resolve!: (signature: string) => void, reject!: (error: Error) => void;
    const f = fixture(() => new Promise((yes, no) => { resolve = yes; reject = no; }));
    f.bridge.start(); const pending = f.bridge.receive(f.request);
    f.bridge.dispose();
    const before = { statuses: [...f.statuses], sent: [...f.sent], calls: [...f.calls] };
    t.mock.timers.tick(120_000);
    if (settlement === "resolve") resolve("0x11"); else reject(Error("cancelled"));
    await pending;
    f.bridge.start(); await f.bridge.receive(f.request);
    assert.deepEqual({ statuses: f.statuses, sent: f.sent, calls: f.calls }, before);
  });
}

test("an expired signature is discarded even before its deadline callback runs", async t => {
  t.mock.timers.enable({ apis: ["setTimeout", "Date"], now: 1_000 });
  let resolve!: (signature: string) => void;
  const f = fixture(() => new Promise(yes => { resolve = yes; }));
  try {
    f.bridge.start(); const pending = f.bridge.receive(f.request);
    t.mock.timers.setTime(121_000);
    resolve("0x11"); await pending;
    assert.equal(f.statuses.at(-1), "failed");
    assert.equal(f.sent.length, 1);
  } finally { f.bridge.dispose(); }
});
