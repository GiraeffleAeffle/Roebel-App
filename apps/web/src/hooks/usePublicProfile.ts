import { useState, useEffect, useRef } from "react";
import { useActiveAccount } from "thirdweb/react";
import type { PublicProfile } from "@/lib/user-types";
import {
  publicProfileRequestBinding,
  resolveRequestBoundPublicProfileState,
} from "@/lib/context/wallet-bound-state.mjs";
import { resolvePublicProfileViewer } from "@/lib/stadtstack/profile-write-boundary.mjs";

/**
 * Hook to fetch a privacy-filtered public profile for another user
 */
export function usePublicProfile(targetWallet: string) {
  const account = useActiveAccount();
  const [profile, setProfile] = useState<PublicProfile | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const latestViewerRef = useRef<string | undefined>(
    account?.address?.toLowerCase(),
  );
  const requestGenerationRef = useRef(0);
  const profileRequestRef = useRef<string | undefined>(undefined);
  latestViewerRef.current = account?.address?.toLowerCase();
  // A query-string wallet is not authentication. The public staging lab has
  // no signed viewer session, so it may receive only the public projection.
  const effectiveViewer = resolvePublicProfileViewer(
    process.env.NEXT_PUBLIC_STADTSTACK_STAGING_LAB,
    account?.address,
  ) || undefined;
  const currentRequest = publicProfileRequestBinding(
    targetWallet,
    effectiveViewer,
  );

  useEffect(() => {
    const requestGeneration = ++requestGenerationRef.current;
    const requestViewer = account?.address?.toLowerCase();
    const requestBinding = publicProfileRequestBinding(
      targetWallet,
      effectiveViewer,
    );
    let current = true;

    async function fetchProfile() {
      if (!targetWallet) {
        profileRequestRef.current = undefined;
        setProfile(null);
        setError(null);
        setIsLoading(false);
        return;
      }

      setIsLoading(true);
      setError(null);
      // Do not keep a previous viewer's privacy-filtered response visible
      // while this viewer's request is pending.
      setProfile(null);
      profileRequestRef.current = undefined;

      try {
        const viewerParam = effectiveViewer
          ? `?viewer=${effectiveViewer}`
          : "";
        const response = await fetch(
          `/api/users/profile/${targetWallet}${viewerParam}`
        );
        const data = await response.json();

        if (
          !current ||
          requestGeneration !== requestGenerationRef.current ||
          latestViewerRef.current !== requestViewer
        ) {
          return;
        }

        if (data.success) {
          profileRequestRef.current = requestBinding;
          setProfile(data.profile);
        } else {
          profileRequestRef.current = requestBinding;
          setProfile(null);
          setError(data.error || "Failed to load profile");
        }
      } catch (err) {
        if (
          !current ||
          requestGeneration !== requestGenerationRef.current ||
          latestViewerRef.current !== requestViewer
        ) {
          return;
        }
        console.error("Error fetching public profile:", err);
        profileRequestRef.current = requestBinding;
        setProfile(null);
        setError(err instanceof Error ? err.message : "Unknown error");
      } finally {
        if (
          current &&
          requestGeneration === requestGenerationRef.current &&
          latestViewerRef.current === requestViewer
        ) {
          setIsLoading(false);
        }
      }
    }

    fetchProfile();
    return () => {
      current = false;
    };
  }, [targetWallet, account?.address, effectiveViewer]);

  return resolveRequestBoundPublicProfileState({
    currentRequest,
    stateRequest: profileRequestRef.current,
    profile,
    isLoading,
    error,
  });
}
