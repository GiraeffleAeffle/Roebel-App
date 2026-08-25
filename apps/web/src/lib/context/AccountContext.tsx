"use client";

import {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  useMemo,
  useRef,
  type ReactNode,
} from "react";
import { useActiveAccount } from "thirdweb/react";
import {
  fetchOwnedAccounts,
  createOrgAccount as createOrgAccountDB,
  switchActiveAccount as switchActiveAccountDB,
  removeOwner as removeOwnerDB,
  type CreateOrgAccountOptions,
} from "@/lib/supabase-accounts";
import {
  getAccountRole,
  type AccountRole,
} from "@/lib/supabase-account-roles";
import { supabase } from "@/lib/supabase";
import type { Account, OrgSubType } from "@/types/account";
import {
  appendWalletBoundOwnedAccount,
  createAccountRefreshCoordinator,
  resolveOwnedActiveAccount,
  resolveWalletBoundOwnedAccount,
} from "./active-account-selection.mjs";
import { resolveWalletBoundAccountState } from "./wallet-bound-state.mjs";
import {
  isExplicitStaging,
  runNonStagingMutation,
} from "@/lib/stadtstack/profile-write-boundary.mjs";

const STORAGE_KEY = "roebel-active-account-id";

interface AccountContextValue {
  activeAccount: Account | null;
  ownedAccounts: Account[];
  roleInActiveAccount: AccountRole | null;
  switchAccount: (accountId: string) => Promise<void>;
  createOrgAccount: (
    subType: OrgSubType,
    name: string,
    options?: CreateOrgAccountOptions
  ) => Promise<Account>;
  removeCitizen: (accountId: string, walletAddress: string) => Promise<void>;
  isOwnerOf: (accountId: string | null) => boolean;
  canMutateAccounts: boolean;
  isLoading: boolean;
  refreshAccounts: () => Promise<void>;
}

const AccountContext = createContext<AccountContextValue | null>(null);

export function AccountProvider({ children }: { children: ReactNode }) {
  const thirdwebAccount = useActiveAccount();
  const walletAddress = thirdwebAccount?.address;
  const normalizedWalletAddress = walletAddress?.toLowerCase();
  const stagingFlag = process.env.NEXT_PUBLIC_STADTSTACK_STAGING_LAB;
  const canMutateAccounts = !isExplicitStaging(stagingFlag);

  const [activeAccount, setActiveAccount] = useState<Account | null>(null);
  const [ownedAccounts, setOwnedAccounts] = useState<Account[]>([]);
  const [roleInActiveAccount, setRoleInActiveAccount] =
    useState<AccountRole | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const latestWalletRef = useRef<string | undefined>(normalizedWalletAddress);
  const refreshGenerationRef = useRef(createAccountRefreshCoordinator());
  const roleGenerationRef = useRef(0);
  const previousWalletRef = useRef<string | undefined>(normalizedWalletAddress);
  const ownedAccountsWalletRef = useRef<string | undefined>(undefined);
  const activeAccountWalletRef = useRef<string | undefined>(undefined);
  const roleWalletRef = useRef<string | undefined>(undefined);
  const roleAccountIdRef = useRef<string | undefined>(undefined);
  const ownedAccountsRef = useRef<Account[]>([]);

  // Make a wallet switch fail closed during the render before its effects run.
  latestWalletRef.current = normalizedWalletAddress;

  // Do not display or retain the previous wallet's account while ownership is
  // being reloaded for the current wallet.
  useEffect(() => {
    if (
      previousWalletRef.current !== undefined &&
      previousWalletRef.current !== normalizedWalletAddress
    ) {
      // The key is browser-global; it cannot be trusted across wallets.
      localStorage.removeItem(STORAGE_KEY);
    }
    previousWalletRef.current = normalizedWalletAddress;
    ownedAccountsWalletRef.current = undefined;
    ownedAccountsRef.current = [];
    activeAccountWalletRef.current = undefined;
    roleWalletRef.current = undefined;
    roleAccountIdRef.current = undefined;
    setOwnedAccounts([]);
    setActiveAccount(null);
    setRoleInActiveAccount(null);
  }, [normalizedWalletAddress]);

  // Load accounts when wallet connects
  const refreshAccounts = useCallback(async () => {
    const requestGeneration = refreshGenerationRef.current.begin();
    const requestWallet = walletAddress?.toLowerCase();

    if (!walletAddress) {
      setOwnedAccounts([]);
      ownedAccountsRef.current = [];
      setActiveAccount(null);
      setRoleInActiveAccount(null);
      ownedAccountsWalletRef.current = undefined;
      activeAccountWalletRef.current = undefined;
      roleWalletRef.current = undefined;
      roleAccountIdRef.current = undefined;
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    try {
      const accounts = await fetchOwnedAccounts(walletAddress);
      if (
        !refreshGenerationRef.current.isCurrent(requestGeneration) ||
        latestWalletRef.current !== requestWallet
      ) {
        return;
      }
      // Get user's active_account_id from DB
      const { data: userData } = await supabase
        .from("users")
        .select("active_account_id")
        .eq("wallet_address", walletAddress.toLowerCase())
        // A freshly authenticated staging wallet has no persisted profile.
        // This must be a normal absence, never a 406-triggering lookup.
        .maybeSingle();

      if (
        !refreshGenerationRef.current.isCurrent(requestGeneration) ||
        latestWalletRef.current !== requestWallet
      ) {
        return;
      }
      const storedAccountId = localStorage.getItem(STORAGE_KEY);
      const {
        activeAccount: active,
        clearStoredAccountId,
      } = resolveOwnedActiveAccount(
        accounts,
        userData?.active_account_id || null,
        storedAccountId,
      );

      if (clearStoredAccountId) localStorage.removeItem(STORAGE_KEY);

      // Publish one wallet-bound authority snapshot only after every required
      // read and restoration decision belongs to the same current wallet.
      ownedAccountsWalletRef.current = requestWallet;
      ownedAccountsRef.current = accounts;
      activeAccountWalletRef.current = requestWallet;
      roleWalletRef.current = undefined;
      roleAccountIdRef.current = undefined;
      setOwnedAccounts(accounts);
      setRoleInActiveAccount(null);
      if (active) {
        setActiveAccount(active);
      } else {
        // Storage belongs to the browser, not a wallet. Never retain or adopt
        // an account that the fresh ownership query did not return.
        const personal = accounts.find((a) => a.account_type === "personal");
        setActiveAccount(personal || null);
      }
    } catch (error) {
      if (
        !refreshGenerationRef.current.isCurrent(requestGeneration) ||
        latestWalletRef.current !== requestWallet
      ) {
        return;
      }
      console.error("Failed to load accounts:", error);
    } finally {
      if (
        refreshGenerationRef.current.isCurrent(requestGeneration) &&
        latestWalletRef.current === requestWallet
      ) {
        setIsLoading(false);
      }
    }
  }, [walletAddress]);

  useEffect(() => {
    refreshAccounts();
  }, [refreshAccounts]);

  // Fetch role when active account changes
  const activeAccountId = activeAccount?.id;
  useEffect(() => {
    const requestGeneration = ++roleGenerationRef.current;
    const requestWallet = normalizedWalletAddress;
    const requestAccountId =
      activeAccountWalletRef.current === requestWallet
        ? activeAccountId
        : undefined;
    let current = true;

    if (!requestAccountId || !walletAddress) {
      roleWalletRef.current = undefined;
      roleAccountIdRef.current = undefined;
      setRoleInActiveAccount(null);
      return () => {
        current = false;
      };
    }

    getAccountRole(requestAccountId, walletAddress)
      .then((role) => {
        if (
          current &&
          requestGeneration === roleGenerationRef.current &&
          latestWalletRef.current === requestWallet &&
          activeAccountWalletRef.current === requestWallet &&
          activeAccountId === requestAccountId
        ) {
          roleWalletRef.current = requestWallet;
          roleAccountIdRef.current = requestAccountId;
          setRoleInActiveAccount(role);
        }
      })
      .catch((error) => {
        if (current) console.error("Failed to load account role:", error);
      });

    return () => {
      current = false;
    };
  }, [activeAccountId, normalizedWalletAddress, walletAddress]);

  const switchAccount = useCallback(
    async (accountId: string) => {
      return runNonStagingMutation(stagingFlag, async () => {
        if (!walletAddress) throw new Error("No wallet connected");

        const requestWallet = walletAddress.toLowerCase();
        if (ownedAccountsWalletRef.current !== requestWallet) {
          throw new Error("Account ownership is still loading for this wallet");
        }
        const account = resolveWalletBoundOwnedAccount({
          currentWallet: requestWallet,
          stateWallet: ownedAccountsWalletRef.current,
          ownedAccounts: ownedAccountsRef.current,
          accountId,
        });
        if (!account) {
          throw new Error("Cannot switch to an account not owned by this wallet");
        }

        const requestGeneration = refreshGenerationRef.current.current();
        if (latestWalletRef.current !== requestWallet) {
          throw new Error("Wallet changed before account switch");
        }

        await switchActiveAccountDB(walletAddress, accountId);

        if (
          !refreshGenerationRef.current.isCurrent(requestGeneration) ||
          latestWalletRef.current !== requestWallet
        ) {
          throw new Error("Wallet changed during account switch");
        }

        localStorage.setItem(STORAGE_KEY, accountId);
        activeAccountWalletRef.current = requestWallet;
        setActiveAccount(account);
      });
    },
    [stagingFlag, walletAddress]
  );

  const createOrgAccount = useCallback(
    async (
      subType: OrgSubType,
      name: string,
      options?: CreateOrgAccountOptions
    ): Promise<Account> => {
      return runNonStagingMutation(stagingFlag, async () => {
        if (!thirdwebAccount) throw new Error("No wallet connected");
        const requestWallet = thirdwebAccount.address.toLowerCase();
        if (latestWalletRef.current !== requestWallet) {
          throw new Error("Wallet changed before organization creation");
        }

        // Any ownership read that began before creation is stale by
        // definition: its result cannot contain the account being created.
        refreshGenerationRef.current.invalidate();
        setIsLoading(false);

        const account = await createOrgAccountDB(
          thirdwebAccount,
          subType,
          name,
          options
        );
        if (!account) throw new Error("Failed to create organization");
        if (latestWalletRef.current !== requestWallet) {
          throw new Error("Wallet changed during organization creation");
        }

        // Also invalidate a refresh that may have begun while the signed
        // create was in flight, before publishing the new owned snapshot.
        refreshGenerationRef.current.invalidate();

        const currentOwnedAccounts =
          ownedAccountsWalletRef.current === requestWallet
            ? ownedAccountsRef.current
            : [];
        const nextOwnedAccounts = appendWalletBoundOwnedAccount({
          currentWallet: requestWallet,
          stateWallet: requestWallet,
          ownedAccounts: currentOwnedAccounts,
          account,
        });
        ownedAccountsWalletRef.current = requestWallet;
        ownedAccountsRef.current = nextOwnedAccounts;
        setOwnedAccounts(nextOwnedAccounts);
        setIsLoading(false);
        return account;
      });
    },
    [stagingFlag, thirdwebAccount]
  );

  const removeCitizen = useCallback(
    async (accountId: string, citizenWallet: string) => {
      return runNonStagingMutation(stagingFlag, async () => {
        if (!thirdwebAccount) throw new Error("No wallet connected");
        const requestWallet = thirdwebAccount.address.toLowerCase();
        if (latestWalletRef.current !== requestWallet) {
          throw new Error("Wallet changed before organization membership update");
        }
        await removeOwnerDB(thirdwebAccount, accountId, citizenWallet);
      });
    },
    [stagingFlag, thirdwebAccount]
  );

  const isOwnerOf = useCallback(
    (accountId: string | null): boolean => {
      if (!accountId) return false;
      if (!canMutateAccounts) return false;
      return Boolean(resolveWalletBoundOwnedAccount({
        currentWallet: normalizedWalletAddress,
        stateWallet: ownedAccountsWalletRef.current,
        ownedAccounts: ownedAccountsRef.current,
        accountId,
      }));
    },
    [canMutateAccounts, normalizedWalletAddress]
  );

  const boundAccountState = resolveWalletBoundAccountState({
    currentWallet: normalizedWalletAddress,
    accountsWallet: ownedAccountsWalletRef.current,
    activeAccountWallet: activeAccountWalletRef.current,
    roleWallet: roleWalletRef.current,
    roleAccountId: roleAccountIdRef.current,
    activeAccount,
    ownedAccounts,
    roleInActiveAccount,
  });
  const safeIsLoading = Boolean(
    normalizedWalletAddress && !boundAccountState.authorityStateIsCurrent,
  ) || isLoading;

  const value = useMemo<AccountContextValue>(
    () => ({
      activeAccount: boundAccountState.activeAccount,
      ownedAccounts: boundAccountState.ownedAccounts,
      roleInActiveAccount: boundAccountState.roleInActiveAccount,
      switchAccount,
      createOrgAccount,
      removeCitizen,
      isOwnerOf,
      canMutateAccounts,
      isLoading: safeIsLoading,
      refreshAccounts,
    }),
    [
      boundAccountState.activeAccount,
      boundAccountState.ownedAccounts,
      boundAccountState.roleInActiveAccount,
      switchAccount,
      createOrgAccount,
      removeCitizen,
      isOwnerOf,
      canMutateAccounts,
      safeIsLoading,
      refreshAccounts,
    ]
  );

  return (
    <AccountContext.Provider value={value}>{children}</AccountContext.Provider>
  );
}

export function useAccount(): AccountContextValue {
  const ctx = useContext(AccountContext);
  if (!ctx) {
    throw new Error("useAccount must be used within <AccountProvider>");
  }
  return ctx;
}
