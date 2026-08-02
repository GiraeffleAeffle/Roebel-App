"use client";

import { useCallback, useEffect, useState } from "react";
import { useActiveAccount } from "thirdweb/react";
import {
  fetchAccountVoteSummary,
  fetchUserAccountVote,
  voteAccount,
  clearAccountVote,
  type AccountVoteSummary,
  type VoteValue,
} from "@/lib/supabase-ratings";
import { hasSupabase } from "@/lib/record";

export function useAccountVote(accountId: string | null) {
  const account = useActiveAccount();
  const wallet = account?.address ?? null;

  const [summary, setSummary] = useState<AccountVoteSummary | null>(null);
  const [userVote, setUserVote] = useState<VoteValue | null>(null);
  const [loading, setLoading] = useState(false);

  // Votes are a Supabase-only feature with no record equivalent — skip the
  // fetch entirely in record mode rather than let it throw on the keyless
  // Proxy; summary/userVote simply stay at their neutral `null`.
  const refetch = useCallback(async () => {
    if (!accountId || !hasSupabase) return;
    setLoading(true);
    try {
      const [s, u] = await Promise.all([
        fetchAccountVoteSummary(accountId),
        wallet ? fetchUserAccountVote(accountId, wallet) : Promise.resolve(null),
      ]);
      setSummary(s);
      setUserVote(u);
    } finally {
      setLoading(false);
    }
  }, [accountId, wallet]);

  useEffect(() => {
    void refetch();
  }, [refetch]);

  const setVote = useCallback(
    async (vote: VoteValue) => {
      if (!accountId || !wallet || !hasSupabase) return;
      setUserVote(vote); // optimistic
      await voteAccount({ account_id: accountId, wallet_address: wallet, vote });
      await refetch();
    },
    [accountId, wallet, refetch]
  );

  const clearVote = useCallback(async () => {
    if (!accountId || !wallet || !hasSupabase) return;
    setUserVote(null); // optimistic
    await clearAccountVote(accountId, wallet);
    await refetch();
  }, [accountId, wallet, refetch]);

  return {
    summary,
    userVote,
    loading,
    isSignedIn: !!wallet,
    setVote,
    clearVote,
    refetch,
  };
}
