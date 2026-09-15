import assert from "node:assert/strict";
import { test } from "node:test";
import { runInNewContext } from "node:vm";
import { privateKeyToAccount } from "viem/accounts";
import { verifyMessage } from "viem";
import { createStagingWorkspaceLogin, STAGING_WORKSPACE_APP as appOrigin, STAGING_WORKSPACE_ISSUER as origin } from "../src/lib/workspace/staging-login-bridge";
import { createThirdwebCitizenSession } from "../src/lib/citizen-session/thirdweb-adapter";
import { renderStagingLoginPage } from "../../roebel-id/src/interaction/staging-login-page";
import { verifySiwe } from "../../roebel-id/src/auth-bridge/verify-siwe";
import { createMemoryNonceStore } from "../../roebel-id/src/auth-bridge/nonce-store";

// This cross-application test belongs to full-repository quality. The identity
// publisher tests its own pruned package without pulling Web into its graph.
for (const key of ["11", "22"]) test(`the delivered login script and app account complete SIWE once (fixture ${key})`, async () => {
  const signer = privateKeyToAccount(`0x${key.repeat(32)}`);
  const session = createThirdwebCitizenSession({ account: signer, memberId: null, appAccountId: null });
  const store = createMemoryNonceStore(), nonce = store.issue();
  const requests: unknown[] = [], replies: unknown[] = [], statuses: string[] = [];
  const popup = { postMessage(message: unknown, target: string) { assert.equal(target, appOrigin); requests.push(message); } };
  const opener = { postMessage(message: unknown, target: string) { assert.equal(target, origin); replies.push(message); } };
  const appButton = { onclick: undefined as undefined | (() => void), disabled: false };
  const status = { textContent: "" };
  const location = { origin, host: new URL(origin).host, href: `${origin}/interaction/test` };
  let receive = async (_event: { origin: string; source: unknown; data: unknown }) => {};
  let fetchCount = 0, walletCalls = 0;
  runInNewContext(renderStagingLoginPage("test").split("<script>")[1]!.split("</script>")[0]!, {
    URL, TextEncoder, Error, AbortSignal, location,
    document: { getElementById: (id: string) => id === "app-login" ? appButton : id === "status" ? status : {} },
    window: { open: () => popup, ethereum: { request() { walletCalls++; throw Error("Unexpected browser wallet request"); } },
      addEventListener: (_type: string, listener: typeof receive) => { receive = listener; } },
    fetch: async (url: string, init?: { body: string }) => {
      fetchCount++;
      if (url === "/interaction/test/nonce") return new Response(nonce);
      assert.equal(url, "/interaction/test/login");
      const verified = await verifySiwe({ ...JSON.parse(init!.body), nonceStore: store,
        expectedDomain: new URL(origin).host, expectedChainId: 100, verifier: verifyMessage });
      assert.equal(verified.address, signer.address.toLowerCase());
      return Response.json({ redirectTo: `${origin}/auth/resume` });
    },
  });
  const bridge = createStagingWorkspaceLogin({ session, opener, appOrigin, onStatus: value => statuses.push(value) });
  try {
    appButton.onclick!(); bridge.start();
    await receive({ origin: appOrigin, source: popup, data: replies[0] });
    assert.equal(requests.length, 1);
    await bridge.receive({ origin, source: opener, data: requests[0] });
    assert.equal(replies.length, 2);
    const reply = replies[1] as { message: string; signature: string };
    await receive({ origin: appOrigin, source: popup, data: reply });
    assert.equal(location.href, `${origin}/auth/resume`, status.textContent);
    assert.equal(fetchCount, 2);
    await receive({ origin: appOrigin, source: popup, data: reply });
    assert.equal(fetchCount, 2);
    await assert.rejects(verifySiwe({ ...reply, nonceStore: store, expectedDomain: new URL(origin).host,
      expectedChainId: 100, verifier: verifyMessage }), /nonce/);
    assert.equal(walletCalls, 0);
    assert.equal(statuses.at(-1), "sent");
  } finally { bridge.dispose(); session.dispose(); }
});
