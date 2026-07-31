import { useState, useEffect, useCallback } from "react";
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

  // Get NFT balance from blockchain
  const { data: nftBalance } = useReadContract(balanceOf, {
    contract: nftContract,
    owner: account?.address || "",
    queryOptions: { enabled: !!account },
  });

  // Get delegation status from blockchain
  const { data: currentDelegate } = useReadContract({
    contract: nftContract,
    method: "function delegates(address account) view returns (address)",
    params: [account?.address || "0x0"],
    queryOptions: { enabled: !!account },
  });

  // Initialize user profile when wallet connects
  useEffect(() => {
    async function initializeUser() {
      if (!account?.address) {
        setUser(null);
        return;
      }

      setIsLoading(true);
      setError(null);

      try {
        // Initialize user profile

        // Try to get existing user
        const existingUser = await getUserByWalletAddress(account.address);

        if (existingUser.success && existingUser.data) {
          // Profile loaded
          setUser(existingUser.data);
        } else {
          // Create new user
          // Create new user profile — `account` signs the personal-account
          // creation request (org-membership edge function).
          const newUser = await createOrUpdateUser(
            {
              wallet_address: account.address,
              phone_number: undefined, // Will be set by thirdweb if available
              phone_verified: false,
            },
            account
          );

          if (newUser.success && newUser.data) {
            // Profile created
            setUser(newUser.data);
          } else {
            setError(newUser.error || "Failed to create user profile");
          }
        }
      } catch (err) {
        console.error("❌ Error initializing user:", err);
        setError(err instanceof Error ? err.message : "Unknown error");
      } finally {
        setIsLoading(false);
      }
    }

    initializeUser();
  }, [account?.address]);

  // Sync NFT status when balance or delegation changes
  useEffect(() => {
    async function syncNFTStatus() {
      if (!account?.address || !user) return;
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

      const result = await updateUserNFTStatus({
        wallet_address: account.address,
        nft_balance: balance,
        has_delegated: !!hasDelegated,
        delegate_address: currentDelegate || null,
      });

      if (result.success && result.data) {
        setUser(result.data);
      }
    }

    syncNFTStatus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [account?.address, nftBalance, currentDelegate]);

  // Helper to refresh user profile
  const refreshUser = async () => {
    if (!account?.address) return;

    setIsLoading(true);
    try {
      const result = await getUserByWalletAddress(account.address);
      if (result.success && result.data) {
        setUser(result.data);
      }
    } catch (err) {
      console.error("❌ Error refreshing user:", err);
    } finally {
      setIsLoading(false);
    }
  };

  // Update user profile fields
  const updateProfile = useCallback(
    async (updates: Omit<UpdateUserProfileInput, "wallet_address">) => {
      if (!account?.address) return { success: false, error: "Not connected" };

      const result = await updateUserProfileFn({
        wallet_address: account.address,
        ...updates,
      });

      if (result.success && result.data) {
        setUser(result.data);
      }

      return result;
    },
    [account?.address]
  );

  return {
    user,
    isLoading,
    error,
    refreshUser,
    updateProfile,
    isConnected: !!account,
    walletAddress: account?.address,
  };
}
