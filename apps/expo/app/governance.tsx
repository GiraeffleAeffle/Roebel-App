import React, { useState } from 'react';
import { View, Text, StyleSheet, ScrollView, RefreshControl, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import ChevronLeftIcon from '@/assets/icons/chevron-left.svg';
import { useRealtimeProposals } from '@/hooks/useRealtimeProposals';
import ProposalCard from '@/components/ProposalCard';
import ProposalSkeleton from '@/components/ProposalSkeleton';
import BottomNavigation from '@/components/BottomNavigation';
import { useTheme } from '@/context/ThemeContext';

export default function GovernanceScreen() {
  const router = useRouter();
  const { colors } = useTheme();
  const { proposals, loading, refreshing, error, refresh } = useRealtimeProposals();
  const [activeTab, setActiveTab] = useState<'home' | 'explore' | 'map' | 'profile'>('home');

  const handleTabPress = (tab: 'home' | 'explore' | 'map' | 'profile') => {
    setActiveTab(tab);
    if (tab === 'home') {
      router.replace('/');
    } else if (tab === 'explore') {
      router.push('/explore');
    } else if (tab === 'map') {
      router.push('/location');
    } else if (tab === 'profile') {
      router.push('/profile');
    }
  };

  return (
    <SafeAreaView
      style={[styles.container, { backgroundColor: colors.background }]}
      edges={['top', 'left', 'right']}
    >
      {/* Header */}
      <View style={[styles.header, { borderBottomColor: colors.border }]}>
        <Pressable onPress={() => router.back()} style={styles.backButton}>
          <ChevronLeftIcon width={24} height={24} color={colors.textPrimary} />
        </Pressable>
        <Text style={[styles.headerTitle, { color: colors.textPrimary }]}>Bürgerumfragen</Text>
        <View style={{ width: 40 }} />
      </View>

      {/* Content */}
      <ScrollView
        style={styles.content}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={refresh}
            tintColor={colors.primary}
          />
        }
      >
        {loading ? (
          // Loading state - show skeleton loaders
          <View style={styles.proposalsList}>
            <ProposalSkeleton />
            <ProposalSkeleton />
            <ProposalSkeleton />
          </View>
        ) : error ? (
          // Error state
          <View style={styles.emptyState}>
            <Text style={styles.emptyStateIcon}>⚠️</Text>
            <Text style={[styles.emptyStateTitle, { color: colors.textPrimary }]}>Fehler beim Laden</Text>
            <Text style={[styles.emptyStateText, { color: colors.textSecondary }]}>{error}</Text>
          </View>
        ) : proposals.length === 0 ? (
          // Empty state
          <View style={styles.emptyState}>
            <Text style={styles.emptyStateIcon}>📋</Text>
            <Text style={[styles.emptyStateTitle, { color: colors.textPrimary }]}>Keine Vorschläge</Text>
            <Text style={[styles.emptyStateText, { color: colors.textSecondary }]}>
              Es gibt derzeit keine Bürgerabstimmungen.
            </Text>
          </View>
        ) : (
          // Proposals list
          <View style={styles.proposalsList}>
            <Text style={[styles.sectionTitle, { color: colors.textSecondary }]}>
              {proposals.length} {proposals.length === 1 ? 'Vorschlag' : 'Vorschläge'}
            </Text>
            {proposals.map((proposal) => (
              <ProposalCard key={proposal.proposalId.toString()} proposal={proposal} />
            ))}
          </View>
        )}
      </ScrollView>

      {/* Bottom Navigation */}
      <BottomNavigation activeTab={activeTab} onTabPress={handleTabPress} />
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
    paddingVertical: 16,
    borderBottomWidth: 1,
  },
  backButton: {
    width: 40,
    height: 40,
    justifyContent: 'center',
    alignItems: 'flex-start',
  },
  headerTitle: {
    fontSize: 22,
    fontFamily: 'MonaSansSemiCondensed-Medium',
  },
  content: {
    flex: 1,
  },
  proposalsList: {
    padding: 16,
  },
  sectionTitle: {
    fontSize: 16,
    fontFamily: 'MonaSansSemiCondensed-Medium',
    marginBottom: 16,
  },
  emptyState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
    paddingTop: 100,
  },
  emptyStateIcon: {
    fontSize: 64,
    marginBottom: 16,
  },
  emptyStateTitle: {
    fontSize: 22,
    fontFamily: 'Inter-Medium',
    marginBottom: 12,
    textAlign: 'center',
  },
  emptyStateText: {
    fontSize: 16,
    fontFamily: 'Inter-Regular',
    textAlign: 'center',
    lineHeight: 24,
  },
});
