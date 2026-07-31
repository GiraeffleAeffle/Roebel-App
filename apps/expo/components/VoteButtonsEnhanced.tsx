/**
 * Enhanced Vote Buttons Component with Edge Cases
 *
 * Handles all voting scenarios with comprehensive UX explanations
 */

import React, { useState, useEffect, useRef } from 'react';
import { View, Text, StyleSheet, Pressable, ActivityIndicator } from 'react-native';
import { useActiveAccount, useReadContract } from 'thirdweb/react';
import { prepareContractCall, sendTransaction, readContract } from 'thirdweb';
import { governorContract, citizenNFTContract } from '@/constants/thirdweb';
import { balanceOf } from 'thirdweb/extensions/erc721';
import { VoteType, ProposalState } from '@/lib/governance-types';
import { isProposalActive } from '@/lib/governance-utils';
import { recordVote as recordVoteToSupabase } from '@/lib/supabase-votes';
import { claimReward, rewardAmountToMuenzen } from '@/lib/rewards-claim';
import { useRewardCelebration } from '@/context/RewardCelebrationContext';
import VoteConfirmationDrawer from './VoteConfirmationDrawer';
import ErrorDrawer from './ErrorDrawer';
import SuccessDrawer from './SuccessDrawer';
import { useRouter } from 'expo-router';
import { useTheme } from '@/context/ThemeContext';

interface VoteButtonsEnhancedProps {
  proposalId: bigint;
  proposalState: ProposalState;
  hasVoted: boolean;
  isCitizen: boolean;
  onVoteSuccess: () => void;
}

export default function VoteButtonsEnhanced({
  proposalId,
  proposalState,
  hasVoted,
  isCitizen,
  onVoteSuccess,
}: VoteButtonsEnhancedProps) {
  const router = useRouter();
  const account = useActiveAccount();
  const { colors } = useTheme();
  const { celebrate } = useRewardCelebration();
  // Münzen amount from the (idempotent) vote reward, shown after the privacy
  // success drawer is dismissed so the two screens don't fight for attention.
  const pendingRewardMuenzen = useRef<number | null>(null);
  const [voting, setVoting] = useState(false);
  const [selectedVote, setSelectedVote] = useState<'for' | 'against' | 'abstain' | null>(null);
  const [showConfirmation, setShowConfirmation] = useState(false);
  const [errorDrawer, setErrorDrawer] = useState({ visible: false, message: '' });
  const [successDrawer, setSuccessDrawer] = useState({ visible: false, message: '', action: null as (() => void) | null });

  // Get NFT balance for voting eligibility
  const { data: nftBalance } = useReadContract(balanceOf, {
    contract: citizenNFTContract,
    owner: account?.address || '',
    queryOptions: { enabled: !!account },
  });

  // Calculate voting eligibility (auto-delegation: NFT ownership = voting power)
  const hasNFT = nftBalance !== undefined && nftBalance > 0n;
  const canVote = account && hasNFT && isProposalActive(proposalState) && !hasVoted;

  const handleVoteClick = (voteType: 'for' | 'against' | 'abstain') => {
    setSelectedVote(voteType);
    setShowConfirmation(true);
  };

  const handleConfirmVote = async () => {
    if (!account || !selectedVote) return;

    const voteTypeMap: Record<string, VoteType> = {
      for: VoteType.For,
      against: VoteType.Against,
      abstain: VoteType.Abstain,
    };

    try {
      setVoting(true);

      const transaction = prepareContractCall({
        contract: governorContract,
        method: 'function castVote(uint256 proposalId, uint8 support) returns (uint256)',
        params: [proposalId, voteTypeMap[selectedVote]],
      });

      await sendTransaction({
        transaction,
        account,
      });

      // Best-effort mirror of PARTICIPATION to Supabase so the voter's profile
      // "Abstimmungen" count reflects this vote — never the choice.
      // Fire-and-forget; never blocks the success UX.
      void recordVoteToSupabase({
        walletAddress: account.address,
        proposalId: proposalId.toString(),
      });

      // Reward participation in Röbel Münzen (once per proposal, never the choice).
      // Fire-and-forget: pays once the funder is live, no-op until then. When it
      // pays, we stash the amount and celebrate after the privacy drawer closes.
      pendingRewardMuenzen.current = null;
      void claimReward(account.address, 'proposal_vote', proposalId.toString())
        .then((r) => {
          if (r.status === 'paid') pendingRewardMuenzen.current = rewardAmountToMuenzen(r.amountAtto);
        })
        .catch(() => {});

      setShowConfirmation(false);
      setSuccessDrawer({
        visible: true,
        message: 'Deine Stimme wurde erfolgreich abgegeben!',
        action: () => {
          onVoteSuccess();
          const muenzen = pendingRewardMuenzen.current;
          pendingRewardMuenzen.current = null;
          if (muenzen)
            celebrate(muenzen, {
              subtitle:
                'Danke fürs Mitbestimmen! Für deine Teilnahme an der Abstimmung gibt es Röbel Münzen.',
            });
        }
      });
    } catch (error) {
      console.error('Error voting:', error);
      setShowConfirmation(false);
      setErrorDrawer({
        visible: true,
        message: error instanceof Error ? error.message : 'Abstimmung fehlgeschlagen. Bitte versuche es erneut.'
      });
    } finally {
      setVoting(false);
      setSelectedVote(null);
    }
  };

  const handleCancelVote = () => {
    setShowConfirmation(false);
    setSelectedVote(null);
  };

  // No wallet connected
  if (!account) {
    return (
      <View style={styles.container}>
        <View style={[styles.infoCard, { backgroundColor: colors.surfaceSecondary }]}>
          <Text style={styles.infoIcon}>🔐</Text>
          <Text style={[styles.infoTitle, { color: colors.textPrimary }]}>Wallet erforderlich</Text>
          <Text style={[styles.infoText, { color: colors.textSecondary }]}>
            Verbinde dein Wallet, um an der Abstimmung teilzunehmen.
          </Text>
        </View>
      </View>
    );
  }

  // User doesn't have NFT
  if (!hasNFT) {
    return (
      <View style={styles.container}>
        <View style={[styles.infoCard, { backgroundColor: colors.surfaceSecondary }]}>
          <Text style={styles.infoIcon}>🎫</Text>
          <Text style={[styles.infoTitle, { color: colors.textPrimary }]}>Bürgerschaft erforderlich</Text>
          <Text style={[styles.infoText, { color: colors.textSecondary }]}>
            Du benötigst eine Bürgerschaft, um an Abstimmungen teilzunehmen.
          </Text>
          <Pressable
            style={[styles.actionButton, { backgroundColor: colors.textPrimary }]}
            onPress={() => router.push('/verification/request-citizen' as any)}
          >
            <Text style={[styles.actionButtonText, { color: colors.textInverted }]}>Bürgerschaft beantragen</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  // Proposal is in voting delay (Pending state)
  if (proposalState === ProposalState.Pending) {
    return (
      <View style={styles.container}>
        <View style={[styles.infoCard, { backgroundColor: colors.surfaceSecondary }]}>
          <Text style={[styles.infoText, { color: colors.textSecondary }]}>
            Die Abstimmung hat noch nicht begonnen. Siehe Timer unten für die verbleibende Zeit.
          </Text>
        </View>
      </View>
    );
  }

  // Proposal is not active (other states)
  if (!isProposalActive(proposalState)) {
    const getStateMessage = () => {
      switch (proposalState) {
        case 2: // Canceled
          return 'Dieser Vorschlag wurde abgebrochen.';
        case 3: // Defeated
          return 'Abstimmung beendet. Dieser Vorschlag wurde abgelehnt.';
        case 4: // Succeeded
          return 'Abstimmung beendet. Dieser Vorschlag wurde angenommen.';
        case 5: // Queued
          return 'Abstimmung abgeschlossen. Vorschlag ist in Warteschlange zur Ausführung.';
        case 6: // Expired
          return 'Dieser Vorschlag ist abgelaufen.';
        case 7: // Executed
          return 'Abstimmung abgeschlossen. Dieser Vorschlag wurde ausgeführt.';
        default:
          return 'Abstimmung ist derzeit nicht aktiv für diesen Vorschlag.';
      }
    };

    return (
      <View style={styles.container}>
        <View style={[styles.infoCard, { backgroundColor: colors.surfaceSecondary }]}>
          <Text style={[styles.infoText, { color: colors.textSecondary }]}>{getStateMessage()}</Text>
        </View>
      </View>
    );
  }

  // User already voted
  if (hasVoted) {
    return (
      <View style={styles.container}>
        <View style={[styles.infoCard, styles.successCard]}>
          <Text style={styles.infoIcon}>✅</Text>
          <Text style={[styles.infoTitle, { color: colors.textPrimary }]}>Stimme abgegeben</Text>
          <Text style={[styles.infoText, { color: colors.textSecondary }]}>
            Du hast bereits über diesen Vorschlag abgestimmt.
          </Text>
        </View>
      </View>
    );
  }

  // User can vote - show voting interface
  return (
    <View style={styles.container}>
      <Text style={[styles.title, { color: colors.textPrimary }]}>Abstimmen</Text>

      {/* Voting Power Display */}
      <View style={[styles.votingPowerCard, { backgroundColor: colors.surfaceSecondary }]}>
        <Text style={[styles.votingPowerLabel, { color: colors.textSecondary }]}>Deine Abstimmungsmacht</Text>
        <Text style={[styles.votingPowerValue, { color: colors.textPrimary }]}>{nftBalance?.toString() || '1'}</Text>
      </View>

      {/* Vote Buttons */}
      <View style={styles.buttonsContainer}>
        <Pressable
          style={[styles.voteButton, styles.voteButtonFor]}
          onPress={() => handleVoteClick('for')}
          disabled={voting}
        >
          <Text style={styles.voteButtonText}>Dafür</Text>
        </Pressable>

        <Pressable
          style={[styles.voteButton, styles.voteButtonAgainst]}
          onPress={() => handleVoteClick('against')}
          disabled={voting}
        >
          <Text style={styles.voteButtonText}>Dagegen</Text>
        </Pressable>

        <Pressable
          style={[styles.voteButton, { backgroundColor: colors.surfaceSecondary, borderWidth: 1, borderColor: colors.disabled }]}
          onPress={() => handleVoteClick('abstain')}
          disabled={voting}
        >
          <Text style={[styles.voteButtonText, { color: colors.textPrimary }]}>Enthalten</Text>
        </Pressable>
      </View>

      <Text style={[styles.hint, { color: colors.textTertiary }]}>
        Deine Stimme wird on-chain gespeichert und kann nicht geändert werden
      </Text>

      {/* Confirmation Drawer */}
      <VoteConfirmationDrawer
        visible={showConfirmation}
        voteType={selectedVote}
        votingPower={nftBalance?.toString() || '1'}
        onConfirm={handleConfirmVote}
        onCancel={handleCancelVote}
        isVoting={voting}
      />

      {/* Error Drawer */}
      <ErrorDrawer
        visible={errorDrawer.visible}
        message={errorDrawer.message}
        onDismiss={() => setErrorDrawer({ visible: false, message: '' })}
      />

      {/* Success Drawer */}
      <SuccessDrawer
        visible={successDrawer.visible}
        message={successDrawer.message}
        primaryButtonText="OK"
        onPrimaryAction={() => {
          setSuccessDrawer({ visible: false, message: '', action: null });
          if (successDrawer.action) successDrawer.action();
        }}
        onDismiss={() => {
          setSuccessDrawer({ visible: false, message: '', action: null });
          if (successDrawer.action) successDrawer.action();
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    marginVertical: 16,
    paddingHorizontal: 20,
  },
  title: {
    fontSize: 18,
    fontFamily: 'Inter-Medium',
    marginBottom: 16,
  },
  votingPowerCard: {
    borderRadius: 12,
    padding: 16,
    marginBottom: 16,
    alignItems: 'center',
  },
  votingPowerLabel: {
    fontSize: 13,
    fontFamily: 'Inter-Regular',
    marginBottom: 6,
  },
  votingPowerValue: {
    fontSize: 24,
    fontFamily: 'Inter-Medium',
  },
  buttonsContainer: {
    gap: 12,
    marginBottom: 12,
  },
  voteButton: {
    paddingVertical: 16,
    paddingHorizontal: 24,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  voteButtonFor: {
    backgroundColor: '#10b981',
  },
  voteButtonAgainst: {
    backgroundColor: '#ef4444',
  },
  voteButtonText: {
    fontSize: 16,
    fontFamily: 'MonaSansSemiCondensed-Bold',
    color: '#ffffff',
  },
  hint: {
    fontSize: 12,
    fontFamily: 'Inter-Regular',
    textAlign: 'center',
  },
  infoCard: {
    borderRadius: 12,
    padding: 20,
    alignItems: 'center',
  },
  warningCard: {
    backgroundColor: '#FFFBEB',
    borderWidth: 1,
    borderColor: '#FCD34D',
  },
  successCard: {
    backgroundColor: '#ECFDF5',
    borderWidth: 1,
    borderColor: '#6EE7B7',
  },
  infoIcon: {
    fontSize: 48,
    marginBottom: 12,
  },
  infoTitle: {
    fontSize: 18,
    fontFamily: 'Inter-Medium',
    marginBottom: 8,
    textAlign: 'center',
  },
  infoText: {
    fontSize: 14,
    fontFamily: 'Inter-Regular',
    textAlign: 'center',
    lineHeight: 20,
    marginBottom: 8,
  },
  infoSubtext: {
    fontSize: 12,
    fontFamily: 'Inter-Regular',
    textAlign: 'center',
    lineHeight: 18,
    marginTop: 8,
  },
  boldText: {
    fontFamily: 'Inter-Medium',
  },
  statsContainer: {
    borderRadius: 8,
    padding: 12,
    marginTop: 12,
    marginBottom: 8,
    width: '100%',
  },
  statRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 6,
  },
  statLabel: {
    fontSize: 13,
    fontFamily: 'Inter-Regular',
  },
  statValue: {
    fontSize: 13,
    fontFamily: 'Inter-Medium',
  },
  actionButton: {
    paddingVertical: 12,
    paddingHorizontal: 24,
    borderRadius: 12,
    marginTop: 16,
  },
  actionButtonText: {
    fontSize: 15,
    fontFamily: 'MonaSansSemiCondensed-Bold',
  },
});
