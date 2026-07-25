import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, Pressable, StyleSheet, Alert } from 'react-native';
import { useActiveAccount } from 'thirdweb/react';
import { useTheme } from '@/context/ThemeContext';
import { useRoebelTaler } from '@/hooks/useRoebelTaler';
import MuenzenSendSheet from '@/components/messages/MuenzenSendSheet';
import { supabase } from '@/lib/supabase';
import {
  recordTip,
  sumTipsForContext,
  resolveOwnerWallet,
} from '@/lib/supabase-muenzen-tips';

interface Props {
  contextType: string; // e.g. 'blog_article'
  contextId: string;
  /** Account whose owner wallet receives the tip (the author). */
  authorAccountId: string | null;
  recipientName?: string;
}

/**
 * Reusable "Danke sagen" Münzen-tip control. Resolves the author's wallet,
 * hides itself for self-tips / unresolved recipients, and shows a running
 * "❤️ N Röbel Münzen" tally. The on-chain send is the source of truth; the
 * DB record + author notification are best-effort and never block the send.
 */
export default function MuenzenTipButton({ contextType, contextId, authorAccountId, recipientName }: Props) {
  const { colors } = useTheme();
  const account = useActiveAccount();
  const { send } = useRoebelTaler();
  const myWallet = account?.address?.toLowerCase() ?? null;

  const [recipientWallet, setRecipientWallet] = useState<string | null>(null);
  const [tallyAtto, setTallyAtto] = useState<bigint>(0n);
  const [showSheet, setShowSheet] = useState(false);

  const refreshTally = useCallback(async () => {
    setTallyAtto(await sumTipsForContext(contextType, contextId));
  }, [contextType, contextId]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (authorAccountId) {
        const w = await resolveOwnerWallet(authorAccountId);
        if (!cancelled) setRecipientWallet(w);
      } else {
        setRecipientWallet(null);
      }
      const sum = await sumTipsForContext(contextType, contextId);
      if (!cancelled) setTallyAtto(sum);
    })();
    return () => {
      cancelled = true;
    };
  }, [authorAccountId, contextType, contextId]);

  const isSelf = !!recipientWallet && !!myWallet && recipientWallet.toLowerCase() === myWallet;
  const canTip = !!recipientWallet && !isSelf;

  const handleSend = useCallback(
    async (amountRaw: bigint, amountDecimal: number) => {
      if (!recipientWallet || !myWallet) return;
      // On-chain send — throws on failure, which MuenzenSendSheet surfaces.
      const txHash = await send(recipientWallet, amountRaw);
      // Best-effort record + notify — never block the successful send.
      recordTip({
        fromWallet: myWallet,
        toWallet: recipientWallet,
        amountAtto: amountRaw,
        contextType,
        contextId,
        txHash,
      }).catch(() => {});
      supabase
        .from('notifications' as any)
        .insert({
          recipient_wallet: recipientWallet.toLowerCase(),
          type: 'muenzen_tip',
          title: 'Danke für deine Geschichte! 💛',
          body: `Du hast ${amountDecimal} Röbel Münzen erhalten.`,
          metadata: { context_type: contextType, context_id: contextId },
        })
        .then(undefined, (e: unknown) => console.error('tip notify failed:', e));
      setShowSheet(false);
      await refreshTally();
      Alert.alert('Danke gesendet 💛', `Du hast ${amountDecimal} Röbel Münzen gesendet.`);
    },
    [recipientWallet, myWallet, send, contextType, contextId, refreshTally],
  );

  const tallyMuenzen = Number(tallyAtto) / 1e18;
  const showTally = tallyAtto > 0n;

  if (!canTip && !showTally) return null;

  return (
    <View style={styles.wrap}>
      {canTip && (
        <Pressable
          onPress={() => setShowSheet(true)}
          style={[styles.button, { backgroundColor: colors.primary }]}
          accessibilityRole="button"
        >
          <Text style={[styles.buttonText, { color: colors.onPrimary }]}>💛 Danke sagen</Text>
        </Pressable>
      )}
      {showTally && (
        <Text style={[styles.tally, { color: colors.textSecondary }]}>
          💛 {tallyMuenzen.toLocaleString('de-DE', { maximumFractionDigits: 2 })} Röbel Münzen erhalten
        </Text>
      )}
      {canTip && (
        <MuenzenSendSheet
          visible={showSheet}
          onClose={() => setShowSheet(false)}
          peerName={recipientName ?? 'die Autor:in'}
          onSend={handleSend}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    alignItems: 'flex-start',
    gap: 8,
    marginVertical: 16,
  },
  button: {
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 24,
  },
  buttonText: {
    fontSize: 15,
    fontWeight: '600',
  },
  tally: {
    fontSize: 13,
  },
});
