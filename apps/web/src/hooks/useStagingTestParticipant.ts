"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { ThirdwebSigningAccount } from "@/lib/citizen-session/thirdweb-adapter";
import {
  type StagingParticipantStatus,
  STAGING_PARTICIPANT_LABEL,
  createStagingParticipantComment,
  createStagingParticipantPost,
  createStagingParticipantSession,
  getStagingParticipantStatus,
  requestStagingParticipantChallenge,
} from "@/lib/staging-participant/client";

const PARTICIPANT_STATUS_CHANGED = "roebel:staging-participant-status-changed";
let sharedStatusRequest: Promise<StagingParticipantStatus> | null = null;

function loadSharedStatus(): Promise<StagingParticipantStatus> {
  if (!sharedStatusRequest) {
    const request = getStagingParticipantStatus();
    sharedStatusRequest = request;
    void request.finally(() => {
      if (sharedStatusRequest === request) sharedStatusRequest = null;
    });
  }
  return sharedStatusRequest;
}

function invalidateSharedStatus(): void {
  sharedStatusRequest = null;
}

export function useStagingTestParticipant(account: ThirdwebSigningAccount | undefined) {
  const currentWalletAddress = account?.address.toLowerCase() ?? null;
  const currentWalletRef = useRef(currentWalletAddress);
  currentWalletRef.current = currentWalletAddress;
  const [checkedWalletAddress, setCheckedWalletAddress] = useState<string | null>(null);
  const [isActive, setIsActive] = useState(false);
  const [isAvailable, setIsAvailable] = useState(false);
  const [isLoading, setIsLoading] = useState(Boolean(account));
  const [isEnrolling, setIsEnrolling] = useState(false);

  const refresh = useCallback(async () => {
    const requestedWalletAddress = account?.address.toLowerCase() ?? null;
    if (!requestedWalletAddress) {
      setCheckedWalletAddress(null);
      setIsActive(false);
      setIsAvailable(false);
      setIsLoading(false);
      return false;
    }
    setIsLoading(true);
    try {
      const body = await loadSharedStatus();
      if (currentWalletRef.current !== requestedWalletAddress) return false;
      setCheckedWalletAddress(requestedWalletAddress);
      setIsAvailable(body.available === true);
      const active =
        body.active === true &&
        body.walletAddress?.toLowerCase() === requestedWalletAddress;
      setIsActive(active);
      return active;
    } catch {
      if (currentWalletRef.current !== requestedWalletAddress) return false;
      setCheckedWalletAddress(requestedWalletAddress);
      setIsActive(false);
      setIsAvailable(false);
      return false;
    } finally {
      if (currentWalletRef.current === requestedWalletAddress) {
        setIsLoading(false);
      }
    }
  }, [account?.address]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    const handleStatusChanged = () => {
      void refresh();
    };
    window.addEventListener(PARTICIPANT_STATUS_CHANGED, handleStatusChanged);
    return () => {
      window.removeEventListener(PARTICIPANT_STATUS_CHANGED, handleStatusChanged);
    };
  }, [refresh]);

  const enroll = useCallback(async (inviteToken?: string): Promise<{ success: boolean; error?: string }> => {
    if (!account?.address || !account.signMessage) {
      return { success: false, error: "Wallet nicht verbunden" };
    }
    const enrollmentWalletAddress = account.address.toLowerCase();
    setIsEnrolling(true);
    try {
      const challenge = await requestStagingParticipantChallenge(
        account.address,
        inviteToken,
      );
      if (!challenge.success || typeof challenge.data?.message !== "string") {
        return { success: false, error: "Anmeldung konnte nicht vorbereitet werden" };
      }
      const signature = await account.signMessage({ message: challenge.data.message });
      if (currentWalletRef.current !== enrollmentWalletAddress) {
        return { success: false, error: "Wallet wurde während der Anmeldung gewechselt" };
      }
      const session = await createStagingParticipantSession(signature);
      if (!session.success) {
        return { success: false, error: session.error };
      }
      invalidateSharedStatus();
      window.dispatchEvent(new Event(PARTICIPANT_STATUS_CHANGED));
      await refresh();
      return { success: true };
    } catch {
      return { success: false, error: "Staging-Testteilnahme fehlgeschlagen" };
    } finally {
      setIsEnrolling(false);
    }
  }, [account, refresh]);

  const statusBelongsToCurrentWallet =
    currentWalletAddress !== null && checkedWalletAddress === currentWalletAddress;

  return {
    isActive: statusBelongsToCurrentWallet && isActive,
    isAvailable: statusBelongsToCurrentWallet && isAvailable,
    isLoading: Boolean(currentWalletAddress) &&
      (!statusBelongsToCurrentWallet || isLoading),
    isEnrolling,
    enroll,
    createPost: createStagingParticipantPost,
    createComment: createStagingParticipantComment,
    label: STAGING_PARTICIPANT_LABEL,
  };
}
