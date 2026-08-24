import assert from "node:assert/strict";
import { test } from "node:test";

import {
  createEphemeralStagingGuest,
  resolveFirstLoginProfile,
} from "../src/lib/stadtstack/first-login-profile";
import type { User } from "../src/lib/user-types";

const WALLET = "0x1111111111111111111111111111111111111111";

function persistedUser(): User {
  return createEphemeralStagingGuest(WALLET);
}

test("a persisted profile always wins over the staging guest fallback", async () => {
  let created = 0;
  const user = persistedUser();
  const result = await resolveFirstLoginProfile(WALLET, "1", {}, {
    findUser: async () => ({ success: true, data: user }),
    createUser: async () => {
      created += 1;
      return { success: true, data: user };
    },
  });

  assert.deepEqual(result, { kind: "persisted", user });
  assert.equal(created, 0);
});

test("a missing staging profile returns an ephemeral guest and never calls create", async () => {
  let created = 0;
  const result = await resolveFirstLoginProfile(WALLET.toUpperCase().replace("0X", "0x"), "true", {}, {
    findUser: async () => ({ success: false, error: "User not found", notFound: true }),
    createUser: async () => {
      created += 1;
      return { success: false, error: "must not run" };
    },
  });

  assert.equal(result.kind, "ephemeral");
  assert.equal(created, 0);
  if (result.kind === "ephemeral") {
    assert.deepEqual(result.user, createEphemeralStagingGuest(WALLET));
    assert.equal(result.user.is_verified_citizen, false);
    assert.equal(result.user.active_account_id, null);
    assert.equal(result.user.nft_balance, 0n);
  }
});

test("a missing production profile still delegates to the existing creation path", async () => {
  let created = 0;
  const user = persistedUser();
  const result = await resolveFirstLoginProfile(WALLET, undefined, { signer: true }, {
    findUser: async () => ({ success: false, error: "User not found", notFound: true }),
    createUser: async (input, account) => {
      created += 1;
      assert.deepEqual(input, { wallet_address: WALLET });
      assert.deepEqual(account, { signer: true });
      return { success: true, data: user };
    },
  });

  assert.deepEqual(result, { kind: "created", user });
  assert.equal(created, 1);
});

test("invalid addresses fail closed before lookup or mutation", async () => {
  let called = 0;
  const result = await resolveFirstLoginProfile("not-a-wallet", "1", {}, {
    findUser: async () => {
      called += 1;
      return { success: false, error: "unexpected", notFound: true };
    },
    createUser: async () => {
      called += 1;
      return { success: false, error: "unexpected" };
    },
  });
  assert.deepEqual(result, { kind: "error", error: "Invalid wallet address" });
  assert.equal(called, 0);
  assert.throws(() => createEphemeralStagingGuest("invalid"), /Invalid wallet address/);
});
