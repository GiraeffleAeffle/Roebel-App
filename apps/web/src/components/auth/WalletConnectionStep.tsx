"use client";

import { useState } from "react";
import { ConnectButton, useActiveAccount } from "thirdweb/react";
import { client } from "@/app/client";
import { activeChain } from "@/lib/chains";
import { inAppWallet } from "thirdweb/wallets";

const wallets = [
  inAppWallet({
    auth: {
      options: ["email", "phone", "google", "apple", "facebook"],
    },
    smartAccount: {
      chain: activeChain, // Base mainnet
      sponsorGas: true, // Enable gasless transactions globally - all txs are FREE for users
    },
  }),
];

interface WalletConnectionStepProps {
  supabaseUserId: string;
  phoneNumber: string;
  onWalletLinked: (userData: any) => void;
}

export function WalletConnectionStep({
  supabaseUserId,
  phoneNumber,
  onWalletLinked,
}: WalletConnectionStepProps) {
  const account = useActiveAccount();
  const [isLinking, setIsLinking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasAttemptedLink, setHasAttemptedLink] = useState(false);

  // Auto-link wallet when account connects
  const handleLinkWallet = async () => {
    if (!account?.address || isLinking || hasAttemptedLink) return;

    setIsLinking(true);
    setError(null);
    setHasAttemptedLink(true);

    try {
      // Determine auth provider from account
      let authProvider = "unknown";
      let email = null;

      // Try to extract email from account metadata if available
      // This depends on thirdweb's account structure
      if ((account as any).email) {
        email = (account as any).email;
      }

      // Call API to link wallet to phone
      const response = await fetch("/api/auth/link-wallet", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          supabase_user_id: supabaseUserId,
          phone_number: phoneNumber,
          wallet_address: account.address,
          auth_provider: authProvider,
          email: email,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Failed to link wallet");
      }

      // Success! Call parent callback
      onWalletLinked(data.user);
    } catch (err: any) {
      console.error("Error linking wallet:", err);
      setError(err.message || "Failed to link wallet. Please try again.");
      setIsLinking(false);
      setHasAttemptedLink(false);
    }
  };

  // Trigger linking when account becomes available
  if (account && !isLinking && !hasAttemptedLink) {
    handleLinkWallet();
  }

  return (
    <div className="w-full max-w-md mx-auto">
      <div className="bg-foreground border border-gray-800 rounded-lg p-8">
        <div className="text-center mb-6">
          <div className="w-16 h-16 bg-green-900/20 border border-green-800 rounded-full flex items-center justify-center mx-auto mb-4">
            <svg
              className="w-8 h-8 text-green-400"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M5 13l4 4L19 7"
              />
            </svg>
          </div>
          <h2 className="text-2xl font-medium text-white mb-2">
            Phone Verified!
          </h2>
          <p className="text-muted-foreground">
            {phoneNumber}
          </p>
        </div>

        <div className="mb-6">
          <div className="bg-blue-900/20 border border-blue-800 rounded-lg p-4 mb-4">
            <p className="text-sm text-blue-300">
              Now create your wallet using social login. Your wallet will be
              securely linked to your verified phone number.
            </p>
          </div>
        </div>

        {!account ? (
          <div className="space-y-4">
            <div className="flex justify-center">
              <ConnectButton
                client={client}
                chain={activeChain}
                wallets={wallets}
                autoConnect={false}
                connectModal={{
                  title: "Create Your Wallet",
                  size: "compact",
                }}
              />
            </div>
            <p className="text-xs text-muted-foreground text-center">
              Choose your preferred sign-in method
            </p>
          </div>
        ) : isLinking ? (
          <div className="text-center py-4">
            <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-white mb-4"></div>
            <p className="text-muted-foreground">Linking wallet to phone number...</p>
          </div>
        ) : null}

        {error && (
          <div className="mt-4 p-4 bg-red-900/20 border border-red-800 rounded-lg">
            <div className="flex items-start gap-3">
              <svg
                className="w-5 h-5 text-red-400 flex-shrink-0 mt-0.5"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                />
              </svg>
              <div>
                <p className="text-sm font-medium text-red-300">Error</p>
                <p className="text-sm text-red-400 mt-1">{error}</p>
              </div>
            </div>
          </div>
        )}
      </div>

      <div className="mt-6 text-center">
        <p className="text-sm text-muted-foreground">
          After wallet creation, an admin will verify your phone number against
          town records before you can mint your Citizen NFT.
        </p>
      </div>
    </div>
  );
}
