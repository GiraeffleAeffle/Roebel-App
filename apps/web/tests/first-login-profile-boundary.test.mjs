import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  EPHEMERAL_PROFILE_WRITE_ERROR,
  STAGING_PRIVATE_PROFILE_READ_ERROR,
  STAGING_PROFILE_MUTATION_ERROR,
  isExplicitStaging,
  isEvmWalletAddress,
  resolvePrivateProfileReadPermission,
  resolvePublicProfileViewer,
  resolveProfileWritePermission,
  resolveStagingMutationPermission,
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

function source(relativePath) {
  return readFileSync(new URL(relativePath, import.meta.url), "utf8");
}

function filesUnder(relativeDirectory) {
  const root = new URL(relativeDirectory, import.meta.url);
  const files = [];
  function walk(directory, relativePrefix = "") {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const relative = relativePrefix ? `${relativePrefix}/${entry.name}` : entry.name;
      const absolute = `${directory}/${entry.name}`;
      if (entry.isDirectory()) walk(absolute, relative);
      else files.push({ relative, text: readFileSync(absolute, "utf8") });
    }
  }
  walk(fileURLToPath(root));
  return files;
}

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
  assert.equal(EPHEMERAL_PROFILE_WRITE_ERROR, "Staging guest profiles cannot be updated");
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

  const hook = source("../src/hooks/useUserProfile.ts");
  assert.equal(
    [...hook.matchAll(/resolveProfileWritePermission\(\{/g)].length,
    3,
  );
  assert.equal(
    [...hook.matchAll(/stagingFlag:\s*process\.env\.NEXT_PUBLIC_STADTSTACK_STAGING_LAB/g)].length,
    3,
  );

  const picture = source("../src/components/profile/ProfilePictureUpload.tsx");
  assert.match(picture, /if \(!canPersist\) return;/);
  assert.match(picture, /runProfileWrite\([\s\S]*supabase\.storage/);

  const accountContext = source("../src/lib/context/AccountContext.tsx");
  assert.equal(
    [...accountContext.matchAll(/runNonStagingMutation\(stagingFlag/g)].length,
    3,
  );
  assert.match(accountContext, /canMutateAccounts:\s*boolean/);
  assert.match(accountContext, /if \(!canMutateAccounts\) return false/);
  assert.match(accountContext, /runNonStagingMutation\(stagingFlag,[\s\S]*await switchActiveAccountDB/);
  assert.match(accountContext, /runNonStagingMutation\(stagingFlag,[\s\S]*await createOrgAccountDB/);
  assert.match(accountContext, /runNonStagingMutation\(stagingFlag,[\s\S]*await removeOwnerDB/);

  const orgClient = source("../src/lib/org-membership/client.ts");
  const orgMessage = source("../src/lib/org-membership/message.ts");
  const declaredOrgActions = [
    ...orgMessage.matchAll(/\|\s*"([^"]+)"/g),
  ].map((match) => match[1]);
  assert.deepEqual(
    declaredOrgActions.sort(),
    [...orgMutationActions.slice(0, -1), "list_invites", "has_pending_invite"].sort(),
    "the staging action inventory must cover the complete OrgAction union",
  );
  const orgGuard = orgClient.indexOf("const guarded = await runStagingOrgAction");
  const orgSignature = orgClient.indexOf("const body = await requestBody");
  const orgNetwork = orgClient.indexOf("await fetch(");
  assert.ok(orgGuard >= 0 && orgGuard < orgSignature && orgSignature < orgNetwork);
  assert.match(orgClient, /code:\s*"STAGING_READ_ONLY"/);

  const orgManage = source("../src/app/app/org/manage/page.tsx");
  assert.match(orgManage, /canMutateAccounts && canManageMembers/);
  assert.match(orgManage, /canMutateAccounts && canLeaveOrg/);
  assert.match(orgManage, /orgManagementBinding\(walletAddress, accountId\)/);
  assert.match(orgManage, /resolveBoundOrgManagementSnapshot\(currentBinding, snapshot\)/);
  assert.match(orgManage, /resolveBoundOrgManagementTransientState\(/);
  assert.match(orgManage, /loadGenerationRef/);
  assert.match(orgManage, /searchGenerationRef/);
  assert.match(orgManage, /runOrgManagementLoad\(/);

  const openingHours = source("../src/app/dashboard/opening-hours/page.tsx");
  const dashboardProfile = source("../src/app/dashboard/profile/page.tsx");
  assert.match(openingHours, /if \(!canMutateAccounts\)/);
  assert.match(openingHours, /const canEdit = Boolean\([\s\S]*canMutateAccounts/);
  assert.match(openingHours, /disabled=\{saving \|\| !canEdit\}/);
  assert.match(dashboardProfile, /const canEdit = Boolean\([\s\S]*canMutateAccounts/);
  assert.match(dashboardProfile, /canUpload=\{canEdit\}/);
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

  const route = source("../src/app/api/users/profile/route.ts");
  const privateReaders = filesUnder("../src/app/api/")
    .filter(
      ({ relative, text }) =>
        relative.endsWith("/route.ts") && text.includes("getUserByWalletAddress"),
    )
    .map(({ relative }) => relative);
  assert.deepEqual(privateReaders, ["users/profile/route.ts"]);
  const initialGuard = route.indexOf("const readPermission");
  const queryWrapper = route.indexOf("const guardedRead");
  const privateQuery = route.indexOf("() => getUserByWalletAddress(walletAddress)");
  assert.ok(initialGuard >= 0);
  assert.ok(initialGuard < queryWrapper);
  assert.ok(queryWrapper < privateQuery);
  assert.match(route, /if \(!readPermission\.allowed\)[\s\S]*status:\s*403/);
  assert.match(route, /runPrivateProfileRead\(/);
});

test("every profile writer is routed through the same guarded hook capability", () => {
  for (const route of [
    "../src/app/profile/page.tsx",
    "../src/app/app/profile/page.tsx",
  ]) {
    const text = source(route);
    assert.doesNotMatch(text, /import\s+\{\s*updateUserProfile\s*\}/);
    assert.match(text, /updateProfile\(updates\)/);
    assert.match(text, /updateProfile\(\{ privacy_settings: settings \}\)/);
    assert.match(text, /canPersistProfile/);
    assert.match(text, /canPersistProfile\s*&&\s*showEditModal/);
    assert.match(text, /canPersistProfile\s*&&\s*showPrivacyModal/);
    assert.match(text, /privacyWalletRef/);
    assert.match(text, /currentWalletRef/);
    assert.match(text, /user\??\.privacy_settings/);
  }

  const profileForm = source("../src/components/profile/ProfileForm.tsx");
  const pictureUpload = source("../src/components/profile/ProfilePictureUpload.tsx");
  assert.match(profileForm, /if \(!canPersist\) return;/);
  assert.match(profileForm, /<ProfilePictureUpload[\s\S]*canPersist=\{canPersist\}/);
  assert.match(pictureUpload, /if \(!canPersist\) return;/);
  assert.match(pictureUpload, /runProfileWrite\([\s\S]*supabase\.storage/);
  assert.match(pictureUpload, /disabled=\{!canPersist \|\| isUploading\}/);
});

test("explicit staging disables the closed set of unauthenticated users-table mutation routes", async () => {
  assert.equal(isExplicitStaging("1"), true);
  assert.equal(isExplicitStaging(" TRUE "), true);
  assert.equal(isExplicitStaging("0"), false);
  assert.equal(isExplicitStaging(undefined), false);
  assert.equal(isEvmWalletAddress(WALLET), true);
  assert.equal(isEvmWalletAddress("arbitrary-wallet"), false);

  const stagingPermission = resolveStagingMutationPermission("1");
  assert.deepEqual(stagingPermission, {
    allowed: false,
    error: STAGING_PROFILE_MUTATION_ERROR,
  });
  const productionPermission = resolveStagingMutationPermission(undefined);
  assert.deepEqual(productionPermission, { allowed: true });

  const writers = new Map([
    ["auth/link-wallet/route.ts", { guards: 1, calls: [".update(", ".insert("] }],
    ["users/profile/route.ts", { guards: 2, calls: ["await createOrUpdateUser(", "await updateUserProfile("] }],
    ["users/nft-status/route.ts", { guards: 1, calls: ["await updateUserNFTStatus("] }],
    ["users/delete/route.ts", { guards: 1, calls: ["await deleteUser("] }],
  ]);
  const apiFiles = filesUnder("../src/app/api/");
  const mutationMarker = /(?:await\s+(?:createOrUpdateUser|updateUserProfile|updateUserNFTStatus|deleteUser)\s*\(|\.from\(["']users["']\)[\s\S]*?\.(?:insert|update|upsert|delete)\s*\()/;
  const discoveredWriters = apiFiles
    .filter(({ relative, text }) => relative.endsWith("/route.ts") && mutationMarker.test(text))
    .map(({ relative }) => relative)
    .sort();
  assert.deepEqual(discoveredWriters, [...writers.keys()].sort());

  for (const [route, { guards, calls }] of writers) {
    const text = apiFiles.find(({ relative }) => relative === route)?.text;
    assert.ok(text, `${route} is missing from the API tree`);
    const guard = text.indexOf("runStagingRouteMutation(");
    assert.ok(guard >= 0, `${route} is not wired to the executable staging route seam`);
    assert.equal(
      [...text.matchAll(/runStagingRouteMutation\(/g)].length,
      guards,
      `${route} does not guard each route mutation wrapper exactly once`,
    );
    assert.match(text, /if \(!guarded\.allowed\)/);
    assert.match(text, /status:\s*403/);
    const bodyRead = text.indexOf("await request.json(");
    if (bodyRead >= 0) {
      assert.ok(bodyRead > guard, `${route} parses attacker input before its staging guard`);
    }
    for (const call of calls) {
      const invocation = text.indexOf(call);
      assert.ok(invocation > guard, `${route} writes before its staging guard`);
    }
    assert.match(text, /isEvmWalletAddress\(/);
  }
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

test("all profile Storage writers fail closed for ephemeral guests", () => {
  const profileForm = source("../src/components/profile/ProfileForm.tsx");
  const pictureUpload = source("../src/components/profile/ProfilePictureUpload.tsx");
  const imageDropzone = source("../src/components/ui/image-upload-dropzone.tsx");
  const dashboardProfile = source("../src/app/dashboard/profile/page.tsx");

  assert.match(profileForm, /if \(!canPersist\) return;/);
  assert.match(profileForm, /supabase\.storage/);
  assert.match(pictureUpload, /if \(!canPersist\) return;/);
  assert.match(pictureUpload, /supabase\.storage/);
  assert.match(imageDropzone, /if \(!canUpload\)/);
  assert.match(imageDropzone, /disabled=\{!canUpload \|\| isUploading\}/);
  assert.match(
    dashboardProfile,
    /const canEdit = Boolean\([\s\S]*canPersistProfile[\s\S]*canMutateAccounts[\s\S]*isOwnerOf/,
  );
  assert.match(
    dashboardProfile,
    /canUpload=\{canEdit\}/,
  );
});

test("async profile and account selection paths carry current-wallet guards", () => {
  const accountContext = source("../src/lib/context/AccountContext.tsx");
  const userProfile = source("../src/hooks/useUserProfile.ts");
  const publicProfile = source("../src/hooks/usePublicProfile.ts");

  assert.match(accountContext, /refreshGenerationRef/);
  assert.match(accountContext, /latestWalletRef/);
  assert.match(accountContext, /not owned by this wallet/);
  assert.match(accountContext, /localStorage\.removeItem\(STORAGE_KEY\)/);
  assert.match(accountContext, /resolveOwnedActiveAccount\(/);
  assert.match(accountContext, /await switchActiveAccountDB\(/);
  assert.match(accountContext, /ownedAccountsWalletRef/);
  assert.match(accountContext, /canMutateAccounts/);
  assert.match(accountContext, /runNonStagingMutation/);
  assert.match(accountContext, /resolveWalletBoundAccountState\(/);
  assert.match(accountContext, /isExplicitStaging\(/);
  assert.match(userProfile, /profileGenerationRef/);
  assert.match(userProfile, /latestWalletRef/);
  assert.match(userProfile, /await updateUserNFTStatus\(/);
  assert.match(userProfile, /resolveFirstLoginProfile\(/);
  assert.match(userProfile, /resolveProfileWritePermission\(/);
  assert.match(userProfile, /resolveWalletBoundProfileState\(/);
  assert.match(userProfile, /await updateUserProfileFn|return updateUserProfileFn/);
  assert.match(userProfile, /Wallet changed before the profile write completed/);
  assert.match(publicProfile, /requestGenerationRef/);
  assert.match(publicProfile, /latestViewerRef/);
  assert.match(publicProfile, /setProfile\(null\)/);
  assert.match(publicProfile, /resolveRequestBoundPublicProfileState\(/);
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

test("organization dashboard editors use the identity-bound draft capability", () => {
  const profile = source("../src/app/dashboard/profile/page.tsx");
  const openingHours = source("../src/app/dashboard/opening-hours/page.tsx");

  for (const editor of [profile, openingHours]) {
    assert.match(editor, /accountIdentityBinding\(/);
    assert.match(editor, /resolveAccountBoundDraft\(/);
    assert.match(editor, /runAccountBoundAction\(/);
    assert.match(editor, /latestBindingRef\.current = currentBinding/);
    assert.match(editor, /draft\.current/);
  }
  assert.equal(
    [...profile.matchAll(/<ImageUploadDropzone/g)].length,
    2,
  );
  assert.equal(
    [...profile.matchAll(/key=\{`(?:avatar|cover)-\$\{currentBinding/g)].length,
    2,
  );
  assert.match(profile, /onUploadComplete=\{\(url\) => updateCurrentDraft/);
  assert.match(profile, /canUpload=\{canEdit\}/);
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

test("explicit staging never promotes a caller-controlled public-profile viewer", () => {
  const route = source("../src/app/api/users/profile/[wallet_address]/route.ts");
  const hook = source("../src/hooks/usePublicProfile.ts");
  assert.match(route, /runPublicProfileRead\(/);
  assert.match(route, /request\.nextUrl\.searchParams\.get\("viewer"\)/);
  assert.match(hook, /const effectiveViewer = resolvePublicProfileViewer\(/);
  assert.match(hook, /publicProfileRequestBinding\([\s\S]*effectiveViewer/);
  assert.match(hook, /effectiveViewer\s*\? `\?viewer=/);
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

  const accountContext = source("../src/lib/context/AccountContext.tsx");
  assert.match(accountContext, /resolveOwnedActiveAccount\(/);
  assert.doesNotMatch(accountContext, /fetchAccountById/);
  assert.match(accountContext, /localStorage\.removeItem\(STORAGE_KEY\)/);
});

test("a newly created organization can be selected immediately exactly once", async () => {
  const personal = { id: "personal-a", account_type: "personal" };
  const created = { id: "organization-a", account_type: "organisation" };
  let owned = [personal];
  let createCalls = 0;
  let activeUpdates = 0;

  const account = await (async () => {
    createCalls += 1;
    return created;
  })();
  owned = appendWalletBoundOwnedAccount({
    currentWallet: WALLET,
    stateWallet: WALLET,
    ownedAccounts: owned,
    account,
  });
  const selected = resolveWalletBoundOwnedAccount({
    currentWallet: WALLET,
    stateWallet: WALLET,
    ownedAccounts: owned,
    accountId: account.id,
  });
  assert.equal(selected, created);
  await (async () => {
    activeUpdates += 1;
  })();

  assert.equal(createCalls, 1);
  assert.equal(activeUpdates, 1);
  assert.equal(owned.filter((candidate) => candidate.id === created.id).length, 1);

  const accountContext = source("../src/lib/context/AccountContext.tsx");
  const synchronousPublish = accountContext.indexOf(
    "ownedAccountsRef.current = nextOwnedAccounts",
  );
  const createReturn = accountContext.indexOf("return account;", synchronousPublish);
  const switchResolution = accountContext.indexOf(
    "ownedAccounts: ownedAccountsRef.current",
  );
  assert.ok(synchronousPublish >= 0 && synchronousPublish < createReturn);
  assert.ok(switchResolution >= 0);
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
  let createCalls = 0;
  let activeUpdates = 0;

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

  // createOrgAccount invalidates reads that started before creation and again
  // before publishing so a refresh started during creation cannot win either.
  refreshCoordinator.invalidate();
  const account = await (async () => {
    createCalls += 1;
    return created;
  })();
  refreshCoordinator.invalidate();
  owned = appendWalletBoundOwnedAccount({
    currentWallet: WALLET,
    stateWallet: WALLET,
    ownedAccounts: owned,
    account,
  });

  releaseRefresh([personal]);
  assert.equal(await refreshResult, false);
  assert.equal(owned.includes(created), true);

  const selected = resolveWalletBoundOwnedAccount({
    currentWallet: WALLET,
    stateWallet: WALLET,
    ownedAccounts: owned,
    accountId: account.id,
  });
  assert.equal(selected, created);
  await (async () => {
    activeUpdates += 1;
  })();

  assert.deepEqual(
    { createCalls, activeUpdates },
    { createCalls: 1, activeUpdates: 1 },
  );

  const accountContext = source("../src/lib/context/AccountContext.tsx");
  const createStart = accountContext.indexOf("const createOrgAccount = useCallback");
  const createIO = accountContext.indexOf("await createOrgAccountDB", createStart);
  const ownershipPublish = accountContext.indexOf(
    "ownedAccountsRef.current = nextOwnedAccounts",
    createIO,
  );
  const firstInvalidation = accountContext.indexOf(
    "refreshGenerationRef.current.invalidate()",
    createStart,
  );
  const secondInvalidation = accountContext.indexOf(
    "refreshGenerationRef.current.invalidate()",
    firstInvalidation + 1,
  );
  assert.ok(
    createStart >= 0 &&
      firstInvalidation > createStart &&
      firstInvalidation < createIO &&
      secondInvalidation > createIO &&
      secondInvalidation < ownershipPublish,
  );
});

test("staging leave rejects before owner lookup, signing, or fetch; production remains live", async () => {
  const memberManagement = source("../src/lib/supabase-member-management.ts");
  assert.match(
    memberManagement,
    /export async function leaveOrg[\s\S]*return executeLeaveOrg\(\{[\s\S]*fetchOwners: fetchAccountOwners/,
  );

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
    /einzige Inhaber/,
  );
  assert.deepEqual(calls, { owners: 2, sign: 1, fetch: 1 });
});
