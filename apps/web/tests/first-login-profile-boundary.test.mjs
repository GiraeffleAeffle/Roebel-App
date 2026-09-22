import assert from "node:assert/strict";
import test from "node:test";

import {
  STAGING_PRIVATE_PROFILE_READ_ERROR,
  STAGING_PROFILE_MUTATION_ERROR,
  resolvePrivateProfileReadPermission,
  resolvePublicProfileViewer,
  resolveProfileWritePermission,
  resolveStagingOrgActionPermission,
  runNonStagingMutation,
  runPrivateProfileRead,
  runProfileWrite,
  runPublicProfileRead,
  runStagingRouteMutation,
  runStagingOrgAction,
} from "../src/lib/stadtstack/profile-write-boundary.mjs";
import {
  appendWalletBoundOwnedAccount,
  createAccountRefreshCoordinator,
  resolveOwnedActiveAccount,
  resolveWalletBoundOwnedAccount,
  selectOwnedActiveAccount,
} from "../src/lib/context/active-account-selection.mjs";
import {
  publicProfileRequestBinding,
  resolveRequestBoundPublicProfileState,
  resolveWalletBoundAccountState,
  resolveWalletBoundProfileState,
} from "../src/lib/context/wallet-bound-state.mjs";
import {
  createEmptyOrgManagementSnapshot,
  createEmptyOrgManagementTransientState,
  orgManagementBinding,
  resolveBoundOrgManagementSnapshot,
  resolveBoundOrgManagementTransientState,
  runOrgManagementLoad,
} from "../src/lib/context/org-management-state.mjs";
import {
  accountIdentityBinding,
  createAccountBoundDraft,
  resolveAccountBoundDraft,
  runAccountBoundAction,
} from "../src/lib/context/account-bound-draft.mjs";
import { executeLeaveOrg } from "../src/lib/org-membership/leave-org.mjs";

const WALLET = "0x1111111111111111111111111111111111111111";
const OTHER_WALLET = "0x2222222222222222222222222222222222222222";

test("ephemeral, staging, and stale profiles fail closed before a mutation fixture can run", async () => {
  for (const permission of [
    resolveProfileWritePermission({
      stagingFlag: undefined,
      profilePersistence: "ephemeral",
      profileWalletAddress: WALLET,
      activeWalletAddress: WALLET,
    }),
    resolveProfileWritePermission({
      stagingFlag: undefined,
      profilePersistence: null,
      profileWalletAddress: WALLET,
      activeWalletAddress: WALLET,
    }),
    resolveProfileWritePermission({
      stagingFlag: undefined,
      profilePersistence: "persisted",
      profileWalletAddress: WALLET,
      activeWalletAddress: OTHER_WALLET,
    }),
    resolveProfileWritePermission({
      stagingFlag: "1",
      profilePersistence: "persisted",
      profileWalletAddress: WALLET,
      activeWalletAddress: WALLET,
    }),
  ]) {
    let mutations = 0;
    const result = await runProfileWrite(permission, async () => {
      mutations += 1;
      return { success: true };
    });
    assert.equal(mutations, 0);
    assert.ok(permission.error);
    assert.deepEqual(result, { success: false, error: permission.error });
  }

  assert.deepEqual(
    resolveProfileWritePermission({
      stagingFlag: undefined,
      profilePersistence: "persisted",
      profileWalletAddress: WALLET,
      activeWalletAddress: WALLET.toUpperCase(),
    }),
    { allowed: true },
  );
});

test("explicit staging executes zero profile, Storage, or account mutation callbacks", async () => {
  const networkCalls = {
    userProfile: 0,
    profilePictureStorage: 0,
    accountContext: 0,
    orgMembership: 0,
  };
  const persistedStagingPermission = resolveProfileWritePermission({
    stagingFlag: "true",
    profilePersistence: "persisted",
    profileWalletAddress: WALLET,
    activeWalletAddress: WALLET,
  });
  assert.deepEqual(persistedStagingPermission, {
    allowed: false,
    error: STAGING_PROFILE_MUTATION_ERROR,
  });

  const hookResult = await runProfileWrite(persistedStagingPermission, async () => {
    networkCalls.userProfile += 1;
    return { success: true };
  });
  const pictureResult = await runProfileWrite(
    { allowed: false, error: STAGING_PROFILE_MUTATION_ERROR },
    async () => {
      networkCalls.profilePictureStorage += 1;
      return { success: true };
    },
  );
  await assert.rejects(
    runNonStagingMutation("1", async () => {
      networkCalls.accountContext += 1;
    }),
    new RegExp(STAGING_PROFILE_MUTATION_ERROR),
  );

  const orgMutationActions = [
    "create_account",
    "update_account",
    "create_invite",
    "revoke_invite",
    "accept_invite",
    "decline_invite",
    "leave",
    "remove_member",
    "update_member_role",
    "unknown_future_action",
  ];
  for (const action of orgMutationActions) {
    const denied = await runStagingOrgAction("true", action, async () => {
      networkCalls.orgMembership += 1;
      return { ok: true };
    });
    assert.deepEqual(denied, {
      allowed: false,
      error: STAGING_PROFILE_MUTATION_ERROR,
    });
  }

  assert.deepEqual(networkCalls, {
    userProfile: 0,
    profilePictureStorage: 0,
    accountContext: 0,
    orgMembership: 0,
  });
  assert.deepEqual(hookResult, {
    success: false,
    error: STAGING_PROFILE_MUTATION_ERROR,
  });
  assert.deepEqual(pictureResult, {
    success: false,
    error: STAGING_PROFILE_MUTATION_ERROR,
  });

  let productionCalls = 0;
  await runNonStagingMutation(undefined, async () => {
    productionCalls += 1;
  });
  assert.equal(productionCalls, 1, "non-staging behavior must remain enabled");

  let stagingReadCalls = 0;
  for (const action of ["list_invites", "has_pending_invite"]) {
    assert.deepEqual(resolveStagingOrgActionPermission("1", action), {
      allowed: true,
    });
    const result = await runStagingOrgAction("1", action, async () => {
      stagingReadCalls += 1;
      return { ok: true, action };
    });
    assert.deepEqual(result, {
      allowed: true,
      value: { ok: true, action },
    });
  }
  assert.equal(stagingReadCalls, 2, "exact signed read actions stay available");
});

test("organization transport performs zero sign/fetch for staging writes but keeps reads and production live", async () => {
  const calls = { sign: 0, fetch: 0 };
  const transport = async () => {
    calls.sign += 1;
    calls.fetch += 1;
    return { ok: true };
  };

  for (const action of ["create_account", "create_invite", "leave", "unknown_future_action"]) {
    const denied = await runStagingOrgAction("1", action, transport);
    assert.equal(denied.allowed, false);
  }
  assert.deepEqual(calls, { sign: 0, fetch: 0 });

  assert.equal((await runStagingOrgAction("1", "list_invites", transport)).allowed, true);
  assert.equal((await runStagingOrgAction(undefined, "create_invite", transport)).allowed, true);
  assert.deepEqual(calls, { sign: 2, fetch: 2 });
});

test("profile Storage stays zero-I/O for ephemeral/staging and executes once in production", async () => {
  let storageWrites = 0;
  for (const permission of [
    resolveProfileWritePermission({
      stagingFlag: undefined,
      profilePersistence: "ephemeral",
      profileWalletAddress: WALLET,
      activeWalletAddress: WALLET,
    }),
    resolveProfileWritePermission({
      stagingFlag: "1",
      profilePersistence: "persisted",
      profileWalletAddress: WALLET,
      activeWalletAddress: WALLET,
    }),
  ]) {
    await runProfileWrite(permission, async () => {
      storageWrites += 1;
      return { success: true };
    });
  }
  assert.equal(storageWrites, 0);

  const allowed = await runProfileWrite(
    resolveProfileWritePermission({
      stagingFlag: undefined,
      profilePersistence: "persisted",
      profileWalletAddress: WALLET,
      activeWalletAddress: WALLET,
    }),
    async () => {
      storageWrites += 1;
      return { success: true, url: "https://example.invalid/profile.png" };
    },
  );
  assert.equal(allowed.success, true);
  assert.equal(storageWrites, 1);
});

test("explicit staging private-profile GET returns no query result and invokes no query", async () => {
  assert.deepEqual(resolvePrivateProfileReadPermission(" TRUE "), {
    allowed: false,
    error: STAGING_PRIVATE_PROFILE_READ_ERROR,
  });
  assert.deepEqual(resolvePrivateProfileReadPermission(undefined), {
    allowed: true,
  });

  let privateQueries = 0;
  const denied = await runPrivateProfileRead("1", async () => {
    privateQueries += 1;
    return { private: "row" };
  });
  assert.equal(privateQueries, 0);
  assert.deepEqual(denied, {
    allowed: false,
    error: STAGING_PRIVATE_PROFILE_READ_ERROR,
  });

  const permitted = await runPrivateProfileRead(undefined, async () => {
    privateQueries += 1;
    return { publicOutsideStaging: true };
  });
  assert.equal(privateQueries, 1);
  assert.deepEqual(permitted, {
    allowed: true,
    value: { publicOutsideStaging: true },
  });
});

test("the staging route seam rejects before request parsing or database mutation", async () => {
  let requestParses = 0;
  let databaseMutations = 0;
  const denied = await runStagingRouteMutation("1", async () => {
    requestParses += 1;
    databaseMutations += 1;
    return { status: 200 };
  });
  assert.deepEqual(denied, {
    allowed: false,
    error: STAGING_PROFILE_MUTATION_ERROR,
  });
  assert.equal(requestParses, 0);
  assert.equal(databaseMutations, 0);

  const allowed = await runStagingRouteMutation(undefined, async () => {
    requestParses += 1;
    databaseMutations += 1;
    return { status: 200 };
  });
  assert.deepEqual(allowed, { allowed: true, value: { status: 200 } });
  assert.equal(requestParses, 1);
  assert.equal(databaseMutations, 1);
});

test("wallet-bound presentation state masks cross-wallet and cross-viewer renders synchronously", () => {
  const userA = { wallet_address: WALLET, username: "private-a" };
  const userB = { wallet_address: OTHER_WALLET, username: "private-b" };
  assert.deepEqual(
    resolveWalletBoundProfileState({
      currentWallet: WALLET,
      stateWallet: WALLET,
      user: userA,
      profilePersistence: "persisted",
      isLoading: false,
      error: null,
    }),
    {
      user: userA,
      profilePersistence: "persisted",
      isLoading: false,
      error: null,
    },
  );
  assert.deepEqual(
    resolveWalletBoundProfileState({
      currentWallet: OTHER_WALLET,
      stateWallet: WALLET,
      user: userA,
      profilePersistence: "persisted",
      isLoading: false,
      error: "old error",
    }),
    { user: null, profilePersistence: null, isLoading: true, error: null },
  );
  assert.deepEqual(
    resolveWalletBoundProfileState({
      currentWallet: OTHER_WALLET,
      stateWallet: OTHER_WALLET,
      user: userB,
      profilePersistence: "ephemeral",
      isLoading: false,
      error: null,
    }).user,
    userB,
  );

  const target = "0x3333333333333333333333333333333333333333";
  const requestA = publicProfileRequestBinding(target, WALLET);
  const requestB = publicProfileRequestBinding(target, OTHER_WALLET);
  const privateForA = { wallet_address: target, neighborhood: "private-for-a" };
  assert.deepEqual(
    resolveRequestBoundPublicProfileState({
      currentRequest: requestB,
      stateRequest: requestA,
      profile: privateForA,
      isLoading: false,
      error: null,
    }),
    { profile: null, isLoading: true, error: null },
  );
  assert.equal(
    resolveRequestBoundPublicProfileState({
      currentRequest: requestA,
      stateRequest: requestA,
      profile: privateForA,
      isLoading: false,
      error: null,
    }).profile,
    privateForA,
  );

  const accountA = { id: "account-a", account_type: "organisation" };
  const accountB = { id: "account-b", account_type: "personal" };
  assert.deepEqual(
    resolveWalletBoundAccountState({
      currentWallet: OTHER_WALLET,
      accountsWallet: WALLET,
      activeAccountWallet: WALLET,
      roleWallet: WALLET,
      roleAccountId: accountA.id,
      activeAccount: accountA,
      ownedAccounts: [accountA],
      roleInActiveAccount: "owner",
    }),
    {
      activeAccount: null,
      ownedAccounts: [],
      roleInActiveAccount: null,
      authorityStateIsCurrent: false,
    },
  );
  assert.deepEqual(
    resolveWalletBoundAccountState({
      currentWallet: OTHER_WALLET,
      accountsWallet: OTHER_WALLET,
      activeAccountWallet: OTHER_WALLET,
      roleWallet: WALLET,
      roleAccountId: accountA.id,
      activeAccount: accountB,
      ownedAccounts: [accountB],
      roleInActiveAccount: "owner",
    }),
    {
      activeAccount: accountB,
      ownedAccounts: [accountB],
      roleInActiveAccount: null,
      authorityStateIsCurrent: true,
    },
  );
});

test("organization dashboard drafts mask A immediately on B and reject stale actions", async () => {
  const bindingA = accountIdentityBinding(WALLET, "account-a");
  const bindingAccountB = accountIdentityBinding(WALLET, "account-b");
  const bindingWalletB = accountIdentityBinding(OTHER_WALLET, "account-a");
  assert.equal(
    accountIdentityBinding(WALLET.toUpperCase(), "ACCOUNT-A"),
    bindingA,
  );
  const profileA = createAccountBoundDraft(bindingA, {
    name: "Private organization A",
    avatar_url: "https://example.invalid/private-a.png",
  });
  const hoursA = createAccountBoundDraft(bindingA, {
    monday: [{ open: "08:00", close: "10:00" }],
  });

  assert.deepEqual(
    resolveAccountBoundDraft(bindingAccountB, profileA, { name: "", avatar_url: "" }),
    {
      binding: bindingAccountB,
      value: { name: "", avatar_url: "" },
      current: false,
    },
  );
  assert.equal(
    resolveAccountBoundDraft(bindingWalletB, profileA, {}).current,
    false,
  );
  assert.deepEqual(resolveAccountBoundDraft(undefined, hoursA, {}), {
    binding: undefined,
    value: {},
    current: false,
  });

  let writes = 0;
  let publishes = 0;
  assert.deepEqual(
    await runAccountBoundAction({
      binding: bindingA,
      currentBinding: () => bindingAccountB,
      action: async () => {
        writes += 1;
        return "must-not-run";
      },
      publish: () => {
        publishes += 1;
      },
    }),
    { started: false, current: false },
  );
  assert.deepEqual({ writes, publishes }, { writes: 0, publishes: 0 });

  let releaseSave;
  const pendingSave = new Promise((resolve) => {
    releaseSave = resolve;
  });
  let currentBinding = bindingA;
  const lateA = runAccountBoundAction({
    binding: bindingA,
    currentBinding: () => currentBinding,
    action: async () => {
      writes += 1;
      return pendingSave;
    },
    publish: () => {
      publishes += 1;
    },
  });
  currentBinding = bindingAccountB;
  releaseSave("saved-a");
  assert.deepEqual(await lateA, {
    started: true,
    current: false,
    value: "saved-a",
  });
  assert.deepEqual({ writes, publishes }, { writes: 1, publishes: 0 });
});

test("organization management masks A on B/no-account and discards a late A load", async () => {
  const accountA = "account-a";
  const accountB = "account-b";
  const bindingA = orgManagementBinding(WALLET, accountA);
  const bindingB = orgManagementBinding(OTHER_WALLET, accountB);
  const snapshotA = {
    binding: bindingA,
    members: [{ wallet_address: WALLET, role: "owner" }],
    pendingInvites: [{ id: "invite-a", invited_wallet: OTHER_WALLET }],
    currentRole: "owner",
  };

  assert.deepEqual(
    resolveBoundOrgManagementSnapshot(bindingB, snapshotA),
    createEmptyOrgManagementSnapshot(bindingB),
  );
  assert.deepEqual(
    resolveBoundOrgManagementSnapshot(undefined, snapshotA),
    createEmptyOrgManagementSnapshot(undefined),
  );
  assert.deepEqual(
    resolveBoundOrgManagementTransientState(bindingB, {
      ...createEmptyOrgManagementTransientState(bindingA),
      showInvite: true,
      searchQuery: "private-a",
      searchResults: [{ wallet_address: WALLET }],
      selectedUser: { wallet_address: WALLET },
      generatedLink: "https://example.invalid/private-a",
      isSending: true,
    }),
    createEmptyOrgManagementTransientState(bindingB),
  );

  let resolveA;
  const lateA = new Promise((resolve) => {
    resolveA = resolve;
  });
  let currentBinding = bindingA;
  const pending = runOrgManagementLoad({
    binding: bindingA,
    load: () => lateA,
    currentBinding: () => currentBinding,
  });

  currentBinding = bindingB;
  resolveA({
    members: snapshotA.members,
    pendingInvites: snapshotA.pendingInvites,
    currentRole: snapshotA.currentRole,
  });
  assert.equal(await pending, null);

  assert.equal(
    await runOrgManagementLoad({
      binding: bindingB,
      load: async () => ({
        members: [{ wallet_address: OTHER_WALLET, role: "owner" }],
        pendingInvites: [],
        currentRole: "owner",
      }),
      currentBinding: () => bindingB,
      isCurrent: () => false,
    }),
    null,
    "an older refresh for the same wallet/account binding must be discarded",
  );

  assert.equal(
    (
      await runOrgManagementLoad({
        binding: bindingB,
        load: async () => ({
          binding: bindingA,
          members: [],
          pendingInvites: [],
          currentRole: null,
        }),
        currentBinding: () => bindingB,
      })
    )?.binding,
    bindingB,
    "loaded data cannot overwrite its wallet/account ownership binding",
  );

  currentBinding = undefined;
  assert.equal(
    await runOrgManagementLoad({
      binding: undefined,
      load: async () => {
        throw new Error("no-account must not load");
      },
      currentBinding: () => currentBinding,
    }),
    null,
  );
});

test("public profile reads strip staging viewers and preserve non-staging viewers", async () => {
  const observedViewers = [];
  const query = async (viewer) => {
    observedViewers.push(viewer);
    return { publicProjection: viewer === null };
  };

  assert.equal(resolvePublicProfileViewer("1", WALLET), null);
  assert.equal(resolvePublicProfileViewer(undefined, WALLET), WALLET);
  assert.deepEqual(await runPublicProfileRead("true", WALLET, query), {
    publicProjection: true,
  });
  assert.deepEqual(await runPublicProfileRead(undefined, WALLET, query), {
    publicProjection: false,
  });
  assert.deepEqual(observedViewers, [null, WALLET]);
});

test("active-account restoration never adopts a stale browser account", () => {
  const owned = [
    { id: "owned-personal", account_type: "personal" },
    { id: "owned-org", account_type: "organisation" },
  ];

  assert.equal(
    selectOwnedActiveAccount(owned, null, "other-wallet-account"),
    null,
  );
  assert.equal(
    selectOwnedActiveAccount(owned, "other-wallet-account", "owned-org"),
    null,
  );
  assert.deepEqual(
    selectOwnedActiveAccount(owned, null, "owned-org"),
    owned[1],
  );
  assert.deepEqual(
    selectOwnedActiveAccount(owned, "owned-personal", "owned-org"),
    owned[0],
  );

  assert.deepEqual(
    resolveOwnedActiveAccount(owned, "owned-personal", "owned-org"),
    { activeAccount: owned[0], clearStoredAccountId: true },
  );
  assert.deepEqual(
    resolveOwnedActiveAccount(owned, null, "owned-org"),
    { activeAccount: owned[1], clearStoredAccountId: false },
  );
  assert.deepEqual(
    resolveOwnedActiveAccount(owned, null, "other-wallet-account"),
    { activeAccount: null, clearStoredAccountId: true },
  );
});

test("a newly created organization is selectable only by its owning wallet", () => {
  const personal = { id: "personal-a", account_type: "personal" };
  const created = { id: "organization-a", account_type: "organisation" };
  let owned = [personal];
  owned = appendWalletBoundOwnedAccount({
    currentWallet: WALLET,
    stateWallet: WALLET,
    ownedAccounts: owned,
    account: created,
  });
  const selected = resolveWalletBoundOwnedAccount({
    currentWallet: WALLET,
    stateWallet: WALLET,
    ownedAccounts: owned,
    accountId: created.id,
  });
  assert.equal(selected, created);
  assert.equal(owned.filter((candidate) => candidate.id === created.id).length, 1);
  assert.equal(
    resolveWalletBoundOwnedAccount({
      currentWallet: OTHER_WALLET,
      stateWallet: WALLET,
      ownedAccounts: owned,
      accountId: created.id,
    }),
    null,
  );
});

test("a late pre-create refresh cannot remove the new organization before switch", async () => {
  const personal = { id: "personal-a", account_type: "personal" };
  const created = { id: "organization-a", account_type: "organisation" };
  const refreshCoordinator = createAccountRefreshCoordinator();
  let owned = [personal];
  let releaseRefresh;

  const delayedRefresh = new Promise((resolve) => {
    releaseRefresh = resolve;
  });
  const refreshGeneration = refreshCoordinator.begin();
  const refreshResult = (async () => {
    const staleAccounts = await delayedRefresh;
    if (!refreshCoordinator.isCurrent(refreshGeneration)) return false;
    owned = staleAccounts;
    return true;
  })();

  // Creating an account supersedes reads started before creation.
  refreshCoordinator.invalidate();
  owned = appendWalletBoundOwnedAccount({
    currentWallet: WALLET,
    stateWallet: WALLET,
    ownedAccounts: owned,
    account: created,
  });

  releaseRefresh([personal]);
  assert.equal(await refreshResult, false);
  assert.equal(owned.includes(created), true);

  const selected = resolveWalletBoundOwnedAccount({
    currentWallet: WALLET,
    stateWallet: WALLET,
    ownedAccounts: owned,
    accountId: created.id,
  });
  assert.equal(selected, created);
});

test("staging leave rejects before owner lookup, signing, or fetch; production remains live", async () => {
  const calls = { owners: 0, sign: 0, fetch: 0 };
  const dependencies = {
    fetchOwners: async () => {
      calls.owners += 1;
      return [
        { wallet_address: WALLET, role: "owner" },
        { wallet_address: OTHER_WALLET, role: "owner" },
      ];
    },
    leave: async () => {
      calls.sign += 1;
      calls.fetch += 1;
      return { ok: true };
    },
  };

  await assert.rejects(
    executeLeaveOrg({
      stagingFlag: "1",
      account: { address: WALLET },
      accountId: "account-a",
      ...dependencies,
    }),
    new RegExp(STAGING_PROFILE_MUTATION_ERROR),
  );
  assert.deepEqual(calls, { owners: 0, sign: 0, fetch: 0 });

  await executeLeaveOrg({
    stagingFlag: undefined,
    account: { address: WALLET },
    accountId: "account-a",
    ...dependencies,
  });
  assert.deepEqual(calls, { owners: 1, sign: 1, fetch: 1 });

  await assert.rejects(
    executeLeaveOrg({
      stagingFlag: undefined,
      account: { address: WALLET },
      accountId: "last-owner-account",
      fetchOwners: async () => {
        calls.owners += 1;
        return [{ wallet_address: WALLET, role: "owner" }];
      },
      leave: async () => {
        calls.sign += 1;
        calls.fetch += 1;
        return { ok: true };
      },
    }),
  );
  assert.deepEqual(calls, { owners: 2, sign: 1, fetch: 1 });
});
