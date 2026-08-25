import { useState, useEffect, useCallback, useRef } from "react";
import { useActiveAccount, useReadContract } from "thirdweb/react";
import { nftContract } from "@/lib/contracts";
import { balanceOf } from "thirdweb/extensions/erc721";
import {
  createOrUpdateUser,
  getUserByWalletAddress,
  updateUserNFTStatus,
  updateUserProfile as updateUserProfileFn,
} from "@/lib/supabase-users";
import type { User, UpdateUserProfileInput } from "@/lib/user-types";
import { resolveFirstLoginProfile } from "@/lib/stadtstack/first-login-profile";
import {
  resolveProfileWritePermission,
  runProfileWrite,
} from "@/lib/stadtstack/profile-write-boundary.mjs";
import { resolveWalletBoundProfileState } from "@/lib/context/wallet-bound-state.mjs";

/**
 * Custom hook to manage user profile
 * - Fetches/creates user profile when wallet connects
 * - Syncs NFT balance and delegation status
 * - Provides loading states and error handling
 */
export function useUserProfile() {
  const account = useActiveAccount();
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [profilePersistence, setProfilePersistence] = useState<
    "persisted" | "ephemeral" | null
  >(null);
  const latestWalletRef = useRef<string | undefined>(
    account?.address?.toLowerCase(),
  );
  const profileGenerationRef = useRef(0);
  const profileStateWalletRef = useRef<string | undefined>(undefined);

  // A promise can resolve between the wallet event and React's effect
  // cleanup. Keep the current wallet observable synchronously for every
  // write/read continuation.
  latestWalletRef.current = account?.address?.toLowerCase();

  // Get NFT balance from blockchain
  const { data: nftBalance, isLoading: nftBalanceLoading } = useReadContract(balanceOf, {
    contract: nftContract,
    owner: account?.address || "",
    queryOptions: { enabled: !!account },
  });

  // Get delegation status from blockchain
  const { data: currentDelegate, isLoading: currentDelegateLoading } = useReadContract({
    contract: nftContract,
    method: "function delegates(address account) view returns (address)",
    params: [account?.address || "0x0"],
    queryOptions: { enabled: !!account },
  });

  // Initialize user profile when wallet connects
  useEffect(() => {
    const generation = ++profileGenerationRef.current;
    const requestWallet = account?.address?.toLowerCase();
    let current = true;

    async function initializeUser() {
      if (!account?.address) {
        profileStateWalletRef.current = undefined;
        setUser(null);
        setProfilePersistence(null);
        setError(null);
        setIsLoading(false);
        return;
      }

      setIsLoading(true);
      setError(null);
      setUser(null);
      setProfilePersistence(null);
      profileStateWalletRef.current = undefined;

      try {
        const result = await resolveFirstLoginProfile(
          account.address,
          process.env.NEXT_PUBLIC_STADTSTACK_STAGING_LAB,
          account,
          {
            findUser: getUserByWalletAddress,
            createUser: (input, signingAccount) =>
              createOrUpdateUser(
                { ...input, phone_number: undefined, phone_verified: false },
                signingAccount,
              ),
          },
        );

        if (
          !current ||
          generation !== profileGenerationRef.current ||
          latestWalletRef.current !== requestWallet
        ) {
          return;
        }

        if (result.kind === "error") {
          profileStateWalletRef.current = requestWallet;
          setError(result.error);
        } else {
          profileStateWalletRef.current = requestWallet;
          setUser(result.user);
          setProfilePersistence(result.kind === "ephemeral" ? "ephemeral" : "persisted");
        }
      } catch (err) {
        if (
          !current ||
          generation !== profileGenerationRef.current ||
          latestWalletRef.current !== requestWallet
        ) {
          return;
        }
        console.error("❌ Error initializing user:", err);
        profileStateWalletRef.current = requestWallet;
        setError(err instanceof Error ? err.message : "Unknown error");
      } finally {
        if (
          current &&
          generation === profileGenerationRef.current &&
          latestWalletRef.current === requestWallet
        ) {
          setIsLoading(false);
        }
      }
    }

    initializeUser();
    return () => {
      current = false;
    };
  }, [account?.address]);

  // Sync NFT status when balance or delegation changes
  useEffect(() => {
    const generation = profileGenerationRef.current;
    const requestWallet = account?.address?.toLowerCase();
    let current = true;

    async function syncNFTStatus() {
      if (
        !account?.address ||
        !user ||
        user.wallet_address.toLowerCase() !== account.address.toLowerCase()
      ) return;
      const permission = resolveProfileWritePermission({
        stagingFlag: process.env.NEXT_PUBLIC_STADTSTACK_STAGING_LAB,
        profilePersistence,
        profileWalletAddress: user.wallet_address,
        activeWalletAddress: account.address,
      });
      if (!permission.allowed) return;
      // Thirdweb may retain the previous query's data while a new owner is
      // being fetched. Never copy that transient value into the new wallet's
      // users row.
      if (nftBalanceLoading || currentDelegateLoading) return;
      if (nftBalance === undefined && currentDelegate === undefined) return;

      const hasDelegated = currentDelegate && currentDelegate !== "0x0000000000000000000000000000000000000000";
      const balance = nftBalance || 0n;

      // Compare with type-safe conversion (user.nft_balance is stored as string)
      const currentBalanceStr = balance.toString();
      if (
        String(user.nft_balance) === currentBalanceStr &&
        user.has_delegated === !!hasDelegated &&
        user.delegate_address === (currentDelegate || null)
      ) {
        return; // No changes needed
      }

      if (
        generation !== profileGenerationRef.current ||
        latestWalletRef.current !== requestWallet
      ) {
        return;
      }

      const result = await updateUserNFTStatus({
        wallet_address: account.address,
        nft_balance: balance,
        has_delegated: !!hasDelegated,
        delegate_address: currentDelegate || null,
      });

      if (
        current &&
        generation === profileGenerationRef.current &&
        latestWalletRef.current === requestWallet &&
        result.success &&
        result.data
      ) {
        setUser(result.data);
      }
    }

    syncNFTStatus();
    return () => {
      current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    account?.address,
    nftBalance,
    nftBalanceLoading,
    currentDelegate,
    currentDelegateLoading,
    profilePersistence,
    user,
  ]);

  // Helper to refresh user profile
  const refreshUser = async () => {
    if (!account?.address) return;

    const generation = profileGenerationRef.current;
    const requestWallet = account.address.toLowerCase();
    if (latestWalletRef.current !== requestWallet) return;

    setIsLoading(true);
    try {
      const result = await getUserByWalletAddress(account.address);
      if (
        generation !== profileGenerationRef.current ||
        latestWalletRef.current !== requestWallet
      ) {
        return;
      }
      if (result.success && result.data) {
        profileStateWalletRef.current = requestWallet;
        setUser(result.data);
        setProfilePersistence("persisted");
      }
    } catch (err) {
      console.error("❌ Error refreshing user:", err);
    } finally {
      if (
        generation === profileGenerationRef.current &&
        latestWalletRef.current === requestWallet
      ) {
        setIsLoading(false);
      }
    }
  };

  // Update user profile fields
  const updateProfile = useCallback(
    async (updates: Omit<UpdateUserProfileInput, "wallet_address">) => {
      const permission = resolveProfileWritePermission({
        stagingFlag: process.env.NEXT_PUBLIC_STADTSTACK_STAGING_LAB,
        profilePersistence,
        profileWalletAddress: user?.wallet_address,
        activeWalletAddress: account?.address,
      });

      const generation = profileGenerationRef.current;
      const requestWallet = account?.address?.toLowerCase();
      const result = await runProfileWrite(permission, async () => {
        if (
          !user ||
          !requestWallet ||
          generation !== profileGenerationRef.current ||
          latestWalletRef.current !== requestWallet ||
          user.wallet_address.toLowerCase() !== requestWallet
        ) {
          return {
            success: false,
            error: "Wallet changed before the profile write completed",
          };
        }

        return updateUserProfileFn({
          wallet_address: user.wallet_address,
          ...updates,
        });
      });

      if (
        result.success &&
        result.data &&
        generation === profileGenerationRef.current &&
        latestWalletRef.current === requestWallet
      ) {
        setUser(result.data);
      }

      return result;
    },
    [account?.address, profilePersistence, user]
  );

  const boundProfileState = resolveWalletBoundProfileState({
    currentWallet: account?.address,
    stateWallet: profileStateWalletRef.current,
    user,
    profilePersistence,
    isLoading,
    error,
  });
  const profileWritePermission = resolveProfileWritePermission({
    stagingFlag: process.env.NEXT_PUBLIC_STADTSTACK_STAGING_LAB,
    profilePersistence: boundProfileState.profilePersistence,
    profileWalletAddress: boundProfileState.user?.wallet_address,
    activeWalletAddress: account?.address,
  });

  return {
    user: boundProfileState.user,
    isLoading: boundProfileState.isLoading,
    error: boundProfileState.error,
    refreshUser,
    updateProfile,
    isConnected: !!account,
    walletAddress: account?.address,
    profilePersistence: boundProfileState.profilePersistence,
    isEphemeralProfile: boundProfileState.profilePersistence === "ephemeral",
    canPersistProfile: profileWritePermission.allowed,
  };
}
