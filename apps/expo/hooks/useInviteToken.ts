import { useState, useEffect, useCallback } from 'react';
import { useActiveAccount } from 'thirdweb/react';
import { useUser } from '@/context/UserContext';
import { useAccount } from '@/context/AccountContext';
import { fetchInviteByToken, acceptInvite as acceptInviteDB, declineInvite as declineInviteDB } from '@/lib/supabase-invites';
import { isAccountOwner } from '@/lib/supabase-accounts';
import type { InviteTokenWithAccount } from '@/lib/types';

export default function useInviteToken(token: string) {
  const { user } = useUser();
  const { refreshAccounts } = useAccount();
  const account = useActiveAccount();
  const walletAddress = user?.wallet_address;

  const [invite, setInvite] = useState<InviteTokenWithAccount | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isExpired, setIsExpired] = useState(false);
  const [isAlreadyMember, setIsAlreadyMember] = useState(false);
  const [isAccepting, setIsAccepting] = useState(false);
  const [isDeclining, setIsDeclining] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resolved, setResolved] = useState<'accepted' | 'declined' | null>(null);

  useEffect(() => {
    if (!token) return;

    setIsLoading(true);
    fetchInviteByToken(token)
      .then(async (data) => {
        if (!data) {
          setError('Einladung nicht gefunden oder ungültig');
          return;
        }

        setInvite(data);

        // Check expiration
        if (new Date(data.expires_at) < new Date() || data.status === 'expired') {
          setIsExpired(true);
          return;
        }

        // Check if already used
        if (data.status !== 'pending') {
          setResolved(data.status === 'accepted' ? 'accepted' : 'declined');
          return;
        }

        // Check if already a member
        if (walletAddress) {
          const isMember = await isAccountOwner(data.account_id, walletAddress);
          setIsAlreadyMember(isMember);
        }
      })
      .catch(() => {
        setError('Einladung konnte nicht geladen werden');
      })
      .finally(() => {
        setIsLoading(false);
      });
  }, [token, walletAddress]);

  const accept = useCallback(async () => {
    if (!invite || !account) return;

    setIsAccepting(true);
    try {
      await acceptInviteDB(account, invite.id);
      setResolved('accepted');
      await refreshAccounts();
    } catch (err: any) {
      setError(err?.message || 'Fehler beim Annehmen der Einladung');
    } finally {
      setIsAccepting(false);
    }
  }, [invite, account, refreshAccounts]);

  const decline = useCallback(async () => {
    if (!invite || !account) return;

    setIsDeclining(true);
    try {
      await declineInviteDB(account, invite.id);
      setResolved('declined');
    } catch (err: any) {
      setError(err?.message || 'Fehler beim Ablehnen der Einladung');
    } finally {
      setIsDeclining(false);
    }
  }, [invite, account]);

  return {
    invite,
    isLoading,
    isExpired,
    isAlreadyMember,
    isAccepting,
    isDeclining,
    error,
    resolved,
    accept,
    decline,
    isLoggedIn: !!walletAddress,
  };
}
