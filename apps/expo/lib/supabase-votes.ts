import { supabase } from './supabase';

/**
 * Mirror of governance PARTICIPATION for gamification/profile stats.
 *
 * Governance voting itself happens on-chain (MACI poll / legacy Governor); this
 * table is a best-effort Supabase cache so a user's "Abstimmungen" count can be
 * shown on their profile and the claim-reward verifier can confirm a vote
 * exists. It records THAT a wallet voted, never WHAT it voted: MACI encrypts
 * the choice on-chain at real cost, and mirroring it here in plaintext was the
 * leak the 2026-07-09 ZK assessment said to fix first (`vote_type` is nulled by
 * migration 20260731_vote_history_choice_purge.sql and no longer sent).
 *
 * The `vote_history` table has a unique constraint on (wallet_address,
 * proposal_id) and only INSERT/SELECT RLS policies — so we insert with ON
 * CONFLICT DO NOTHING (one row per proposal per wallet). Re-voting/changing a
 * vote keeps the existing row → the count stays "proposals voted on", which is
 * exactly what the stat shows.
 */
export async function recordVote(args: {
  walletAddress: string;
  /** On-chain proposal id (numeric, as string). Used for both the dedup key and the chain id column. */
  proposalId: string;
  votingPower?: number;
  proposalNumber?: number;
  proposalTitle?: string;
  transactionHash?: string;
}): Promise<void> {
  try {
    const { error } = await supabase.from('vote_history').upsert(
      {
        wallet_address: args.walletAddress,
        proposal_id: args.proposalId,
        blockchain_proposal_id: args.proposalId,
        voting_power: args.votingPower ?? 1,
        proposal_number: args.proposalNumber ?? null,
        proposal_title: args.proposalTitle ?? null,
        transaction_hash: args.transactionHash ?? null,
        voted_at: new Date().toISOString(),
      },
      { onConflict: 'wallet_address,proposal_id', ignoreDuplicates: true }
    );
    if (error) console.error('recordVote failed:', error);
  } catch (err) {
    console.error('recordVote threw:', err);
  }
}

/** Count of distinct proposals a wallet has voted on (best-effort; 0 on error). */
export async function countUserVotes(walletAddress: string): Promise<number> {
  try {
    const { count, error } = await supabase
      .from('vote_history')
      .select('*', { count: 'exact', head: true })
      .eq('wallet_address', walletAddress);
    if (error) {
      console.error('countUserVotes failed:', error);
      return 0;
    }
    return count ?? 0;
  } catch (err) {
    console.error('countUserVotes threw:', err);
    return 0;
  }
}
