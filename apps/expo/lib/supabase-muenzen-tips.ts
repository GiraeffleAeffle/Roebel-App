import { supabase } from './supabase';

// Data layer for Münzen tips (reader→author appreciation). On-chain transfer is
// the source of truth; these writes/reads are best-effort (never block a send).

export interface RecordTipInput {
  fromWallet: string;
  toWallet: string;
  amountAtto: bigint;
  contextType: string;
  contextId: string;
  txHash?: string | null;
}

export async function recordTip(input: RecordTipInput): Promise<{ success: boolean }> {
  try {
    const { error } = await supabase.from('muenzen_tips' as any).insert({
      from_wallet: input.fromWallet.toLowerCase(),
      to_wallet: input.toWallet.toLowerCase(),
      amount_atto: input.amountAtto.toString(),
      context_type: input.contextType,
      context_id: input.contextId,
      tx_hash: input.txHash ?? null,
    });
    if (error) {
      console.error('recordTip error:', error);
      return { success: false };
    }
    return { success: true };
  } catch (e) {
    console.error('recordTip failed:', e);
    return { success: false };
  }
}

/** Sum of all tips (in atto) for a context. Returns 0n on any error (e.g. table not yet migrated). */
export async function sumTipsForContext(contextType: string, contextId: string): Promise<bigint> {
  try {
    const { data, error } = await supabase
      .from('muenzen_tips' as any)
      .select('amount_atto')
      .eq('context_type', contextType)
      .eq('context_id', contextId);
    if (error || !data) return 0n;
    return (data as { amount_atto: string | number }[]).reduce(
      (acc, r) => acc + BigInt(String(r.amount_atto).split('.')[0] || '0'),
      0n,
    );
  } catch (e) {
    console.error('sumTipsForContext failed:', e);
    return 0n;
  }
}

/** Resolve an owner wallet for an account (prefer role='owner') — the author to tip. */
export async function resolveOwnerWallet(accountId: string): Promise<string | null> {
  try {
    const { data, error } = await supabase
      .from('account_owners' as any)
      .select('wallet_address, role')
      .eq('account_id', accountId);
    if (error || !data || data.length === 0) return null;
    const rows = data as { wallet_address: string; role: string }[];
    const owner = rows.find((r) => r.role === 'owner') ?? rows[0];
    return owner?.wallet_address ?? null;
  } catch (e) {
    console.error('resolveOwnerWallet failed:', e);
    return null;
  }
}
