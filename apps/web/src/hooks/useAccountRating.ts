"use client";

import { useCallback, useEffect, useState } from "react";
import { useActiveAccount } from "thirdweb/react";
import {
  fetchAccountRatingSummary,
  fetchUserRatingForAccount,
  upsertAccountRating,
  deleteAccountRating,
  type AccountRatingSummary,
  type AccountRatingRecord,
} from "@/lib/supabase-ratings";
import { hasSupabase } from "@/lib/record";

export function useAccountRating(accountId: string | null) {
  const account = useActiveAccount();
  const wallet = account?.address ?? null;

  const [summary, setSummary] = useState<AccountRatingSummary | null>(null);
  const [userRating, setUserRating] = useState<AccountRatingRecord | null>(null);
  const [loading, setLoading] = useState(false);

  // Ratings are a Supabase-only feature with no record equivalent — skip
  // the fetch entirely in record mode rather than let it throw on the
  // keyless Proxy; summary/userRating simply stay at their neutral `null`.
  const refetch = useCallback(async () => {
    if (!accountId || !hasSupabase) return;
    setLoading(true);
    try {
      const [s, u] = await Promise.all([
        fetchAccountRatingSummary(accountId),
        wallet ? fetchUserRatingForAccount(accountId, wallet) : Promise.resolve(null),
      ]);
      setSummary(s);
      setUserRating(u);
    } finally {
      setLoading(false);
    }
  }, [accountId, wallet]);

  useEffect(() => {
    void refetch();
  }, [refetch]);

  const setRating = useCallback(
    async (stars: number, comment?: string | null) => {
      if (!accountId || !wallet || !hasSupabase) return;
      const rec = await upsertAccountRating({
        account_id: accountId,
        wallet_address: wallet,
        stars,
        comment,
      });
      if (rec) setUserRating(rec);
      await refetch();
    },
    [accountId, wallet, refetch]
  );

  const removeRating = useCallback(async () => {
    if (!accountId || !wallet || !hasSupabase) return;
    await deleteAccountRating(accountId, wallet);
    setUserRating(null);
    await refetch();
  }, [accountId, wallet, refetch]);

  return {
    summary,
    userRating,
    loading,
    isSignedIn: !!wallet,
    setRating,
    removeRating,
    refetch,
  };
}
