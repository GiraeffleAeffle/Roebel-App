"use client";

import { useState, useEffect, useCallback } from "react";
import { useActiveAccount } from "thirdweb/react";
import { getContract, readContract } from "thirdweb";
import { client } from "@/app/client";
import { CONTRACTS, NETWORK, CITIZEN_GROUP_ID } from "@/lib/semaphore-config";
import { loadIdentity, hasIdentity, getCommitment } from "@/lib/semaphore/identity";
import { CheckCircle, XCircle, AlertCircle, Loader2, Shield, Users } from "lucide-react";
import Link from "next/link";

export default function StatusPage() {
  const account = useActiveAccount();
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState<{
    hasIdentity: boolean;
    identityCommitment?: string;
    isRegistered: boolean;
    hasNFT: boolean;
    totalCitizens: number;
    groupRoot?: string;
  }>({
    hasIdentity: false,
    isRegistered: false,
    hasNFT: false,
    totalCitizens: 0,
  });

  const checkStatus = useCallback(async () => {
    setLoading(true);
    try {
      // Check if user has generated identity
      const identityExists = hasIdentity();
      let commitment: string | undefined;

      if (identityExists) {
        const identity = loadIdentity();
        if (identity) {
          commitment = getCommitment(identity);
        }
      }

      // Get contracts
      const registryContract = getContract({
        client,
        address: CONTRACTS.CITIZEN_REGISTRY,
        chain: NETWORK,
      });

      const nftContract = getContract({
        client,
        address: CONTRACTS.CITIZEN_NFT,
        chain: NETWORK,
      });

      // Check if registered on-chain
      let isRegistered = false;
      let groupRoot: string | undefined;

      if (commitment) {
        try {
          isRegistered = await readContract({
            contract: registryContract,
            method: "function isCitizen(uint256) view returns (bool)",
            params: [BigInt(commitment)],
          });

          // Get group root
          const root = await readContract({
            contract: registryContract,
            method: "function getGroupRoot() view returns (uint256)",
            params: [],
          });
          groupRoot = `0x${root.toString(16)}`;
        } catch (error) {
          console.error("Error checking registration:", error);
        }
      }

      // Check if has NFT
      let hasNFT = false;
      if (account?.address) {
        try {
          const balance = await readContract({
            contract: nftContract,
            method: "function balanceOf(address) view returns (uint256)",
            params: [account.address],
          });
          hasNFT = balance > 0n;
        } catch (error) {
          console.error("Error checking NFT:", error);
        }
      }

      // Get total citizens
      let totalCitizens = 0;
      try {
        const count = await readContract({
          contract: registryContract,
          method: "function citizenCount() view returns (uint256)",
          params: [],
        });
        totalCitizens = Number(count);
      } catch (error) {
        console.error("Error getting citizen count:", error);
      }

      setStatus({
        hasIdentity: identityExists,
        identityCommitment: commitment,
        isRegistered,
        hasNFT,
        totalCitizens,
        groupRoot,
      });
    } catch (error) {
      console.error("Error checking status:", error);
    } finally {
      setLoading(false);
    }
  }, [account]);

  useEffect(() => {
    checkStatus();
  }, [checkStatus]);

  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-blue-50 to-purple-50 flex items-center justify-center">
        <div className="text-center">
          <Loader2 className="w-12 h-12 animate-spin text-primary mx-auto mb-4" />
          <p className="text-muted-foreground">Checking your status...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-purple-50 p-8">
      <div className="max-w-4xl mx-auto">
        <h1 className="text-4xl font-medium mb-8 text-foreground">Citizen Status</h1>

        {/* Overall Status */}
        <div className="bg-card rounded-2xl shadow-xl p-8 mb-8">
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-2xl font-medium text-foreground">Your Status</h2>
            {status.isRegistered ? (
              <div className="flex items-center space-x-2 text-green-600">
                <CheckCircle className="w-6 h-6" />
                <span className="font-medium">Verified Citizen</span>
              </div>
            ) : (
              <div className="flex items-center space-x-2 text-yellow-600">
                <AlertCircle className="w-6 h-6" />
                <span className="font-medium">Not Registered</span>
              </div>
            )}
          </div>

          {/* Status Checklist */}
          <div className="space-y-4">
            {/* Identity Check */}
            <div className="flex items-start space-x-3 p-4 bg-muted rounded-lg">
              {status.hasIdentity ? (
                <CheckCircle className="w-6 h-6 text-green-600 flex-shrink-0 mt-0.5" />
              ) : (
                <XCircle className="w-6 h-6 text-red-600 flex-shrink-0 mt-0.5" />
              )}
              <div className="flex-1">
                <h3 className="font-medium text-foreground mb-1">Semaphore Identity</h3>
                {status.hasIdentity ? (
                  <p className="text-sm text-muted-foreground">
                    Identity generated and stored locally
                  </p>
                ) : (
                  <div>
                    <p className="text-sm text-red-600 mb-2">
                      You need to generate your identity first
                    </p>
                    <Link
                      href="/semaphore/identity"
                      className="inline-block bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-blue-700"
                    >
                      Generate Identity
                    </Link>
                  </div>
                )}
              </div>
            </div>

            {/* Registration Check */}
            <div className="flex items-start space-x-3 p-4 bg-muted rounded-lg">
              {status.isRegistered ? (
                <CheckCircle className="w-6 h-6 text-green-600 flex-shrink-0 mt-0.5" />
              ) : (
                <XCircle className="w-6 h-6 text-red-600 flex-shrink-0 mt-0.5" />
              )}
              <div className="flex-1">
                <h3 className="font-medium text-foreground mb-1">
                  Citizenship Registration
                </h3>
                {status.isRegistered ? (
                  <p className="text-sm text-muted-foreground">
                    Your identity commitment is registered on-chain
                  </p>
                ) : (
                  <div>
                    <p className="text-sm text-red-600 mb-2">
                      {status.hasIdentity
                        ? "Your identity is not registered yet. Apply for citizenship or wait for admin approval."
                        : "Generate your identity first, then apply for citizenship."}
                    </p>
                    {status.hasIdentity && (
                      <Link
                        href="/semaphore/apply"
                        className="inline-block bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-blue-700"
                      >
                        Apply for Citizenship
                      </Link>
                    )}
                  </div>
                )}
              </div>
            </div>

            {/* NFT Check */}
            <div className="flex items-start space-x-3 p-4 bg-muted rounded-lg">
              {status.hasNFT ? (
                <CheckCircle className="w-6 h-6 text-green-600 flex-shrink-0 mt-0.5" />
              ) : (
                <AlertCircle className="w-6 h-6 text-muted-foreground flex-shrink-0 mt-0.5" />
              )}
              <div className="flex-1">
                <h3 className="font-medium text-foreground mb-1">Citizen NFT</h3>
                {status.hasNFT ? (
                  <p className="text-sm text-muted-foreground">You have minted your Citizen NFT</p>
                ) : (
                  <p className="text-sm text-muted-foreground">
                    Optional: Mint an NFT to prove citizenship (requires registration first)
                  </p>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Identity Commitment Details */}
        {status.hasIdentity && status.identityCommitment && (
          <div className="bg-card rounded-2xl shadow-xl p-8 mb-8">
            <h2 className="text-2xl font-medium mb-4 text-foreground">Your Identity</h2>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-foreground mb-2">
                  Identity Commitment (Public)
                </label>
                <div className="bg-muted p-4 rounded-lg break-all font-mono text-sm text-foreground">
                  {status.identityCommitment}
                </div>
                <p className="text-xs text-muted-foreground mt-2">
                  This is your public identifier. Share this with administrators for
                  verification.
                </p>
              </div>

              {status.isRegistered && status.groupRoot && (
                <div>
                  <label className="block text-sm font-medium text-foreground mb-2">
                    Group Merkle Root
                  </label>
                  <div className="bg-muted p-4 rounded-lg break-all font-mono text-sm text-foreground">
                    {status.groupRoot}
                  </div>
                  <p className="text-xs text-muted-foreground mt-2">
                    Current merkle tree root for the citizen group (Group ID: {CITIZEN_GROUP_ID.toString()})
                  </p>
                </div>
              )}
            </div>
          </div>
        )}

        {/* System Statistics */}
        <div className="bg-card rounded-2xl shadow-xl p-8 mb-8">
          <h2 className="text-2xl font-medium mb-4 text-foreground">System Statistics</h2>
          <div className="grid md:grid-cols-2 gap-6">
            <div className="flex items-start space-x-4">
              <div className="w-12 h-12 bg-blue-100 rounded-lg flex items-center justify-center flex-shrink-0">
                <Users className="w-6 h-6 text-primary" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Total Registered Citizens</p>
                <p className="text-3xl font-medium text-foreground">{status.totalCitizens}</p>
              </div>
            </div>

            <div className="flex items-start space-x-4">
              <div className="w-12 h-12 bg-purple-100 rounded-lg flex items-center justify-center flex-shrink-0">
                <Shield className="w-6 h-6 text-purple-600" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Citizen Group ID</p>
                <p className="text-3xl font-medium text-foreground">{CITIZEN_GROUP_ID.toString()}</p>
              </div>
            </div>
          </div>
        </div>

        {/* Next Steps */}
        <div className="bg-blue-50 border-l-4 border-blue-500 p-6 rounded-lg">
          <h3 className="font-medium text-blue-900 mb-2">Next Steps</h3>
          {!status.hasIdentity && (
            <p className="text-blue-800">
              1. Generate your Semaphore identity at{" "}
              <Link href="/semaphore/identity" className="underline font-medium">
                /semaphore/identity
              </Link>
            </p>
          )}
          {status.hasIdentity && !status.isRegistered && (
            <div className="space-y-2 text-blue-800">
              <p>2. Apply for citizenship or contact an administrator</p>
              <p className="text-sm">
                Share your commitment: <span className="font-mono text-xs break-all">{status.identityCommitment}</span>
              </p>
            </div>
          )}
          {status.isRegistered && (
            <div className="space-y-2 text-blue-800">
              <p>✅ You&apos;re all set! You can now:</p>
              <ul className="list-disc list-inside ml-4 space-y-1">
                <li>
                  <Link href="/semaphore/proposals" className="underline">
                    View and create proposals
                  </Link>
                </li>
                <li>Vote anonymously on active proposals</li>
                <li>Participate in governance</li>
              </ul>
            </div>
          )}
        </div>

        {/* Actions */}
        <div className="mt-8 flex gap-4">
          <button
            onClick={checkStatus}
            className="flex-1 bg-gray-600 hover:bg-gray-700 text-white font-medium py-3 px-6 rounded-lg transition-colors"
          >
            Refresh Status
          </button>
          <Link
            href="/semaphore"
            className="flex-1 bg-blue-600 hover:bg-blue-700 text-white font-medium py-3 px-6 rounded-lg transition-colors text-center"
          >
            Back to Home
          </Link>
        </div>
      </div>
    </div>
  );
}
