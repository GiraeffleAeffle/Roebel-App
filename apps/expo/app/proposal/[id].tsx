import React, { useState, useEffect, useRef } from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator, Share, RefreshControl } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useGoBack } from '@/hooks/useGoBack';
import { useActiveAccount } from 'thirdweb/react';
import { balanceOf } from 'thirdweb/extensions/erc721';
import { ArrowLeftIcon } from '@/components/Icons';
import { governanceCitizenNFTContract as citizenNFTContract } from '@/constants/thirdweb';
import { useProposalDetails } from '@/hooks/useProposalDetails';
import { useProposalContent } from '@/hooks/useProposalContent';
import { shortenAddress, calculateReadingTime } from '@/lib/governance-utils';
import { useTheme } from '@/context/ThemeContext';
import ProposalStateBadge from '@/components/ProposalStateBadge';
import ProposalContent from '@/components/ProposalContent';
import StadtkasseSnapshotCard from '@/components/feed/StadtkasseSnapshotCard';
import VotingStats from '@/components/VotingStats';
import VoteButtons from '@/components/VoteButtons';
import ProposalTimeline from '@/components/ProposalTimeline';
import ProposalDetailSkeleton from '@/components/ProposalDetailSkeleton';
import MeckyNotFound from '@/components/MeckyNotFound';
import ProposalCommentSection from '@/components/proposals/ProposalCommentSection';
import InlineErrorBoundary from '@/components/InlineErrorBoundary';
import { getTreasuryEuro } from '@/lib/roebel-taler';
import { attesterSafeGnosisAddress } from '@/constants/gnosis';

export default function ProposalDetailScreen() {
  const goBack = useGoBack();
  const router = useRouter();
  const { colors } = useTheme();
  const params = useLocalSearchParams();
  const account = useActiveAccount();

  // Get proposal ID from route params (UUID string from Supabase)
  const proposalId = params.id as string | null;
  // Optional deeplink target: a specific comment to scroll to + highlight.
  const commentId = (params.commentId as string | undefined) || undefined;
  const scrollRef = useRef<ScrollView>(null);

  const { proposal, userVoteStatus, loading, error, refetch } = useProposalDetails(
    proposalId,
    account?.address
  );

  const [isCitizen, setIsCitizen] = useState<boolean>(false);
  const [refreshing, setRefreshing] = useState(false);

  // Live Gemeinschaftskasse balance for the piggy-bank card (see below).
  const [liveKasseEuro, setLiveKasseEuro] = useState<number | null>(null);
  useEffect(() => {
    if (!proposal?.gemeinschaftskasseSnapshot) return;
    let cancelled = false;
    getTreasuryEuro(attesterSafeGnosisAddress)
      .then((e) => { if (!cancelled) setLiveKasseEuro(e); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [proposal?.gemeinschaftskasseSnapshot]);

  // Fetch Irys content if available
  const proposalContent = useProposalContent(
    proposal?.irysUrl || proposal?.summary || proposal?.description || ''
  );

  // Check if user is a citizen
  useEffect(() => {
    async function checkCitizenStatus() {
      if (!account?.address) {
        setIsCitizen(false);
        return;
      }

      try {
        const balance = await balanceOf({
          contract: citizenNFTContract,
          owner: account.address,
        });
        setIsCitizen(balance > 0n);
      } catch (error) {
        console.error('Error checking citizen status:', error);
        setIsCitizen(false);
      }
    }

    checkCitizenStatus();
  }, [account]);

  const handleVoteSuccess = () => {
    // Refetch proposal data after successful vote
    refetch();
  };

  const handleRefresh = async () => {
    setRefreshing(true);
    await refetch();
    setRefreshing(false);
  };

  const handleShare = async () => {
    if (!proposal) return;

    try {
      await Share.share({
        message: `${proposal.title}\n\nAbstimmen: https://www.roebel.app/proposals/${proposalId}`,
        title: proposal.title,
      });
    } catch (error) {
      console.error('Error sharing:', error);
    }
  };

  // Format date in German
  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    const day = date.getDate();
    const month = date.toLocaleDateString('de-DE', { month: 'short' });
    const year = date.getFullYear();
    return `${day}. ${month} ${year}`;
  };

  // Defensive: convert the proposal's on-chain numeric id (string) to BigInt
  // without throwing if it's missing/malformed. Components downstream guard
  // against `0n` (treat as "not yet linked") and don't render any state.
  const parseProposalIdSafe = (p: { blockchainProposalId?: string | number | null; proposalId?: string | number | null }): bigint => {
    const raw = p?.blockchainProposalId ?? p?.proposalId;
    if (raw === null || raw === undefined || raw === '') return 0n;
    try {
      return BigInt(raw as any);
    } catch {
      return 0n;
    }
  };

  if (loading) {
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
        <View style={[styles.header, { borderBottomColor: colors.border }]}>
          <Pressable onPress={goBack} style={styles.backButton}>
            <ArrowLeftIcon size={24} color={colors.textPrimary} />
          </Pressable>
          <View style={styles.headerSpacer} />
        </View>
        <ScrollView style={styles.content} showsVerticalScrollIndicator={false}>
          <ProposalDetailSkeleton />
        </ScrollView>
      </SafeAreaView>
    );
  }

  if (error || !proposal) {
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
        <View style={[styles.header, { borderBottomColor: colors.border }]}>
          <Pressable onPress={goBack} style={styles.backButton}>
            <ArrowLeftIcon size={24} color={colors.textPrimary} />
          </Pressable>
          <View style={styles.headerSpacer} />
        </View>
        <MeckyNotFound title={error || 'Vorschlag nicht gefunden'} />
      </SafeAreaView>
    );
  }

  const content = proposalContent.markdownContent || proposal.summary || proposal.description;
  const readingTime = calculateReadingTime(content);

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
      {/* Header */}
      <View style={[styles.header, { borderBottomColor: colors.border }]}>
        <Pressable onPress={goBack} style={styles.backButton}>
          <ArrowLeftIcon size={24} color={colors.textPrimary} />
        </Pressable>
        <Text style={[styles.headerTitle, { color: colors.textPrimary }]} numberOfLines={1}>
          {proposal.title || 'Vorschlag'}
        </Text>
        <Pressable onPress={handleShare} style={styles.shareButton}>
          <Text style={[styles.shareIcon, { color: colors.textPrimary }]}>&#x2197;</Text>
        </Pressable>
      </View>

      <ScrollView
        ref={scrollRef}
        style={styles.content}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={handleRefresh}
            tintColor={colors.primary}
          />
        }
      >
        {/* Status Badge — drives off live governor.state(id) so it doesn't
            stay stuck on Supabase's cached value after voting ends. */}
        <View style={styles.statusContainer}>
          <ProposalStateBadge
            state={proposal.state}
            proposalId={parseProposalIdSafe(proposal)}
          />
        </View>

        {/* Title */}
        <Text style={[styles.title, { color: colors.textPrimary }]}>{proposal.title || proposal.description}</Text>

        {/* Metadata */}
        <View style={styles.metadataRow}>
          <Text style={[styles.metadataText, { color: colors.textSecondary }]}>
            von {shortenAddress(proposal.proposer)}
          </Text>
          {proposal.createdAt && (
            <>
              <Text style={[styles.separator, { color: colors.textTertiary }]}>&#x2022;</Text>
              <Text style={[styles.metadataText, { color: colors.textSecondary }]}>
                {formatDate(proposal.createdAt)}
              </Text>
            </>
          )}
          <Text style={[styles.separator, { color: colors.textTertiary }]}>&#x2022;</Text>
          <Text style={[styles.metadataText, { color: colors.textSecondary }]}>
            {readingTime} min read
          </Text>
        </View>

        {/* Proposal Content */}
        <ProposalContent
          content={content}
          isLoading={proposalContent.loading}
        />

        {/* LIVE Gemeinschaftskasse balance (opt-in card by the proposer) —
            taps through to the treasury. Live, not the frozen creation-time
            figure: voters coming back after a payout executed must see the
            same number as the Kasse page, otherwise the proposal page and
            the treasury visibly contradict each other. The frozen value is
            only the instant placeholder while the live read is in flight. */}
        {proposal.gemeinschaftskasseSnapshot && (
          <View style={styles.snapshotWrap}>
            <StadtkasseSnapshotCard
              euro={liveKasseEuro ?? proposal.gemeinschaftskasseSnapshot.euro}
              onPress={() => router.push('/treasury' as any)}
            />
          </View>
        )}

        {/* Voting Statistics — self-fetching from on-chain Tally. */}
        <InlineErrorBoundary label="VotingStats">
          <VotingStats proposalId={parseProposalIdSafe(proposal)} />
        </InlineErrorBoundary>

        {/* MACI-aware vote buttons */}
        <InlineErrorBoundary label="VoteButtons">
          <VoteButtons
            proposalId={parseProposalIdSafe(proposal)}
            proposalState={proposal.state}
            hasVoted={userVoteStatus?.hasVoted || false}
            isCitizen={isCitizen}
            onVoteSuccess={handleVoteSuccess}
          />
        </InlineErrorBoundary>

        {/* Voting timeline + countdown — mirrors the web's ProposalTimeline. */}
        <InlineErrorBoundary label="ProposalTimeline">
          <ProposalTimeline
            proposalId={parseProposalIdSafe(proposal)}
            proposalState={proposal.state}
            createdAt={proposal.createdAt}
          />
        </InlineErrorBoundary>

        {/* Discussion */}
        {proposalId && (
          <ProposalCommentSection
            proposalId={proposalId}
            isCitizen={isCitizen}
            highlightCommentId={commentId}
            scrollViewRef={scrollRef}
          />
        )}

        <View style={styles.bottomSpacer} />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
  },
  backButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    justifyContent: 'center',
    alignItems: 'center',
  },
  headerTitle: {
    flex: 1,
    fontSize: 16,
    fontFamily: 'MonaSansSemiCondensed-Medium',
    textAlign: 'center',
    marginHorizontal: 12,
  },
  shareButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    justifyContent: 'center',
    alignItems: 'center',
  },
  shareIcon: {
    fontSize: 20,
  },
  headerSpacer: {
    width: 40,
  },
  content: {
    flex: 1,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 40,
  },
  loadingText: {
    fontSize: 16,
    fontFamily: 'Inter-Regular',
    marginTop: 16,
  },
  statusContainer: {
    paddingHorizontal: 20,
    paddingTop: 20,
  },
  snapshotWrap: {
    paddingHorizontal: 20,
    marginTop: 8,
    marginBottom: 8,
  },
  title: {
    fontSize: 24,
    fontFamily: 'Inter-Medium',
    lineHeight: 32,
    paddingHorizontal: 20,
    marginTop: 16,
  },
  metadataRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    marginTop: 12,
    marginBottom: 8,
    gap: 6,
    flexWrap: 'wrap',
  },
  metadataText: {
    fontSize: 13,
    fontFamily: 'Inter-Regular',
  },
  separator: {
    fontSize: 13,
  },
  bottomSpacer: {
    height: 40,
  },
});
