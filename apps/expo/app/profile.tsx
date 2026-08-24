import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable, RefreshControl, Image, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useActiveAccount, useActiveWallet, useDisconnect } from 'thirdweb/react';
import { openBrowserAsync } from 'expo-web-browser';
import { useIsBusinessOwner } from '@/hooks/useIsBusinessOwner';
import { useAccount } from '@/context/AccountContext';
import { useVerificationContext } from '@/context/VerificationContext';
import { useUser } from '@/context/UserContext';
import { useTheme } from '@/context/ThemeContext';
import { Events, track } from '@/lib/analytics';
import AvatarStack from '@/components/AvatarStack';
import BottomNavigation, { BOTTOM_NAV_HEIGHT } from '@/components/BottomNavigation';
import BottomDrawer from '@/components/BottomDrawer';
import LoginDrawer from '@/components/LoginDrawer';
import LogoutDrawer from '@/components/LogoutDrawer';
import ProfileMenuItem from '@/components/ProfileMenuItem';
import BuergerWerdenBanner from '@/components/profile/BuergerWerdenBanner';
import BusinessStatusBanner from '@/components/BusinessStatusBanner';
import RewardsCTABanner from '@/components/profile/RewardsCTABanner';
import ProfileHeaderCard from '@/components/profile/ProfileHeaderCard';
import CoinsCard from '@/components/profile/CoinsCard';
import ProfileActionGrid from '@/components/profile/ProfileActionGrid';
import CitizenVerificationBanner from '@/components/profile/CitizenVerificationBanner';
import TouristActionRow from '@/components/profile/TouristActionRow';
import OrgActionCards from '@/components/profile/OrgActionCards';
import StoryCollectionsBar from '@/components/feed/StoryCollectionsBar';
import {
  fetchProfileStoryCollections,
  type StoryCollection,
} from '@/lib/supabase-story-collections';

// Import SVG icons
import UploadIcon from '@/assets/icons/profile/upload.svg';
import SentIcon from '@/assets/icons/profile/sent.svg';
import NotificationIcon from '@/assets/icons/profile/notification.svg';
import HelpCircleIcon from '@/assets/icons/profile/help-circle.svg';
import ShieldUserIcon from '@/assets/icons/profile/shield-user.svg';
import SettingsIcon from '@/assets/icons/settings-01.svg';
import PencilIcon from '@/assets/icons/pencil.svg';
import StarIcon from '@/assets/icons/star.svg';
import QrCodeIcon from '@/assets/icons/qr-code.svg';
import CalendarIcon from '@/assets/icons/calendar-02.svg';

const ORG_TYPE_LABELS: Record<string, string> = {
  restaurant: 'Restaurant',
  unternehmen: 'Unternehmen',
  verein: 'Verein',
  stadt: 'Stadt',
  fraktion: 'Fraktion',
};

export default function ProfileScreen() {
  const router = useRouter();
  const account = useActiveAccount();
  const wallet = useActiveWallet();
  const { disconnect } = useDisconnect();
  const { hasCitizenNFT, hasAttesterNFT, hasAnyNFT, activePendingRequest, userRequests, refresh } = useVerificationContext();
  const { user, tier, tierLabel, isCitizen, refreshUser } = useUser();
  const { activeAccount, ownedAccounts, recentOtherAccounts, switchAccount, refreshAccounts } = useAccount();
  const { isBusinessOwner, businesses } = useIsBusinessOwner();
  const businessRecord = businesses.find(b => b.status === 'published') || businesses[0] || null;
  const userBusiness = businessRecord;
  const { colors } = useTheme();

  const [activeTab, setActiveTab] = useState<'home' | 'explore' | 'profile'>('profile');
  const [showLoginDrawer, setShowLoginDrawer] = useState(false);
  const [showLogoutDrawer, setShowLogoutDrawer] = useState(false);
  const [showAccountSheet, setShowAccountSheet] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const isConnected = !!account;

  // Auto-close login drawer when user successfully logs in
  useEffect(() => {
    if (isConnected && showLoginDrawer) {
      setShowLoginDrawer(false);
    }
  }, [isConnected]);

  const handleDisconnect = async () => {
    if (wallet) {
      track(Events.LOGOUT, { tier: user?.tier });
      disconnect(wallet);
      setShowLogoutDrawer(false);
    }
  };

  const shortenAddress = (addr: string | undefined) => {
    if (!addr) return '';
    return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
  };

  const handleTabPress = (tab: 'home' | 'explore' | 'profile') => {
    setActiveTab(tab);
    if (tab === 'home') {
      router.replace('/');
    } else if (tab === 'explore') {
      router.push('/explore');
    }
  };

const handleRefresh = async () => {
    setRefreshing(true);
    await Promise.all([refresh(), refreshUser(), refreshAccounts()]);
    setRefreshing(false);
  };

  const displayName = user?.display_name || user?.username || shortenAddress(account?.address);
  const citizenRequest = userRequests.find((r: any) => r.nft_type === 'citizen') || null;
  const orgAccount = ownedAccounts.find(a => a.account_type === 'organisation');
  const showBusinessRegister = isCitizen && !isBusinessOwner && !orgAccount;
  const wantsToBeCitizen = user?.preferred_role === 'buerger';

  const [profileStoryCollections, setProfileStoryCollections] = useState<
    StoryCollection[]
  >([]);
  useEffect(() => {
    fetchProfileStoryCollections().then(setProfileStoryCollections);
  }, []);

  return (
    <SafeAreaView
      style={[styles.container, { backgroundColor: colors.background }]}
      edges={['top', 'left', 'right']}
    >
      {/* Header */}
      <View style={[styles.header, { borderBottomColor: colors.border }]}>
        <Text style={[styles.headerTitle, { color: colors.textPrimary }]}>Mein Röbel</Text>
        {ownedAccounts.length > 1 && (
          <Pressable onPress={() => setShowAccountSheet(true)} style={[styles.switchButton, { borderColor: colors.border }]}>
            {recentOtherAccounts.length > 0 && (
              <AvatarStack
                users={recentOtherAccounts.map((a) => ({
                  avatar_url: a.avatar_url,
                  username: a.name,
                }))}
                maxVisible={2}
                size="small"
              />
            )}
            <Text style={[styles.switchButtonText, { color: colors.textPrimary }]}>Account wechseln</Text>
          </Pressable>
        )}
      </View>

      <ScrollView
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
        {!isConnected ? (
          // ============= NOT LOGGED IN STATE =============
          <View style={styles.notConnectedContainer}>
            {/* Show "Noch keinen Account" section */}
            <View style={[styles.emptyStateContainer, { backgroundColor: colors.surface, borderColor: colors.borderSecondary }]}>
              <Text style={[styles.emptyTitle, { color: colors.textPrimary }]}>Noch keinen Account</Text>
              <Text style={[styles.emptySubtitle, { color: colors.textSecondary }]}>
                Sie sind noch nicht angemeldet.
              </Text>

              <Pressable
                style={[styles.primaryButton, { backgroundColor: colors.primary }]}
                onPress={() => setShowLoginDrawer(true)}
              >
                <Text style={[styles.primaryButtonText, { color: colors.onPrimary }]}>
                  Jetzt Anmelden
                </Text>
              </Pressable>
            </View>

            {/* Belohnungen teaser for guests — placed below the empty-state card */}
            <RewardsCTABanner variant="guest" />

            {/* Menu Items */}
            <View style={styles.menuSection}>
              <View style={styles.menuGroup}>
                {isConnected && isCitizen && (
                  <ProfileMenuItem
                    icon={<StarIcon width={20} height={20} color={colors.primary} />}
                    label="Münzen"
                    onPress={() => router.push('/rewards' as any)}
                  />
                )}
                {/* Citizen-only: create a Circles invitation in the mini-app (the invite
                    creator needs the Circles host-injected wallet, which only the mini-app
                    has). Opens it with this citizen pre-filled as the inviter. */}
                {isConnected && isCitizen && (
                  <ProfileMenuItem
                    icon={<QrCodeIcon width={20} height={20} color={colors.primary} />}
                    label="Bürger:in einladen"
                    onPress={() =>
                      openBrowserAsync(
                        `${process.env.EXPO_PUBLIC_CIRCLES_INVITER_URL || 'https://circles-inviter.vercel.app'}?inviter=${user?.wallet_address ?? ''}`
                      )
                    }
                  />
                )}
                <ProfileMenuItem
                  icon={<UploadIcon width={20} height={20} color={colors.textPrimary} />}
                  label="Veranstaltung einsenden"
                  onPress={() => router.push('/submit-event')}
                />
                <ProfileMenuItem
                  icon={<CalendarIcon width={20} height={20} color={colors.textPrimary} />}
                  label="Meine Veranstaltungen"
                  onPress={() => router.push('/my-events')}
                />
                <ProfileMenuItem
                  icon={<SentIcon width={20} height={20} color={colors.textPrimary} />}
                  label="Feedback geben"
                  onPress={() => router.push('/feedback')}
                />
              </View>

              <View style={[styles.menuDivider, { backgroundColor: colors.border }]} />

              <View style={styles.menuGroup}>
                <ProfileMenuItem
                  icon={<NotificationIcon width={20} height={20} color={colors.textPrimary} />}
                  label="Benachrichtigungen"
                  onPress={() => router.push('/notifications' as any)}
                />
                <ProfileMenuItem
                  icon={<SettingsIcon width={20} height={20} color={colors.textPrimary} />}
                  label="Einstellungen"
                  onPress={() => router.push('/settings' as any)}
                />
                <ProfileMenuItem
                  icon={<HelpCircleIcon width={20} height={20} color={colors.textPrimary} />}
                  label="Hilfe & Tipps"
                  onPress={() => router.push('/help')}
                />
                <ProfileMenuItem
                  icon={<HelpCircleIcon width={20} height={20} color={colors.textPrimary} />}
                  label="Über die App"
                  onPress={() => openBrowserAsync('https://www.roebel.app/about')}
                />
                <ProfileMenuItem
                  icon={<ShieldUserIcon width={20} height={20} color={colors.textPrimary} />}
                  label="Datenschutz"
                  onPress={() => openBrowserAsync('https://www.roebel.app/datenschutz')}
                />
              </View>
            </View>
          </View>
        ) : (
          // ============= LOGGED IN STATE =============
          (() => {
            const isOrg = activeAccount?.account_type === 'organisation';
            // Aspiring citizen = logged-in non-citizen non-org with a citizen
            // verification request in flight (or a previously submitted one).
            // Tourists never enter this branch — onboarding choice wins.
            const isAspiringCitizen =
              !isOrg && !isCitizen && !!citizenRequest && user?.preferred_role !== 'tourist';
            const orgPillLabel = isOrg
              ? ORG_TYPE_LABELS[activeAccount?.sub_type || ''] || 'Organisation'
              : 'Besucher:in';

            const profileHref = user?.username
              ? ({ pathname: '/user/[username]', params: { username: user.username } } as const)
              : ('/edit-profile' as const);

            return (
              <View style={styles.connectedContainer}>
                {isOrg ? (
                  <>
                    <ProfileHeaderCard
                      name={activeAccount?.name || 'Organisation'}
                      avatarUrl={activeAccount?.avatar_url || activeAccount?.cover_url}
                      variant="org"
                      pillLabel={orgPillLabel}
                      onPress={() => router.push('/org/manage' as any)}
                    />
                    {isBusinessOwner && userBusiness && userBusiness.status !== 'published' && (
                      <View style={styles.orgStatusWrap}>
                        <BusinessStatusBanner
                          business={userBusiness}
                          onPress={() => router.push({ pathname: '/org-status', params: { businessId: userBusiness.id } } as any)}
                        />
                      </View>
                    )}
                    <OrgActionCards />
                  </>
                ) : isCitizen ? (
                  <>
                    <ProfileHeaderCard
                      name={displayName || 'Bürger'}
                      avatarUrl={user?.profile_picture_url ?? null}
                      variant="citizen"
                      pillLabel="Bürger"
                      onPress={() => router.push('/citizen-verification' as any)}
                    />
                    <CoinsCard />
                    <ProfileActionGrid />
                  </>
                ) : isAspiringCitizen ? (
                  <>
                    <CitizenVerificationBanner pending={!!activePendingRequest} />
                    <ProfileHeaderCard
                      name={displayName || 'Gast'}
                      avatarUrl={user?.profile_picture_url ?? null}
                      variant="guest"
                      pillLabel="Antrag läuft"
                      onPress={() => router.push(profileHref as any)}
                    />
                    <CoinsCard />
                    <ProfileActionGrid />
                  </>
                ) : wantsToBeCitizen ? (
                  <>
                    {/* Selected "Bürger" during onboarding but no citizen NFT yet */}
                    <BuergerWerdenBanner />
                    <ProfileHeaderCard
                      name={displayName || 'Bürger'}
                      avatarUrl={user?.profile_picture_url ?? null}
                      variant="unverified"
                      pillLabel="Nicht verifiziert"
                      onPress={() => router.push(profileHref as any)}
                    />
                    <TouristActionRow />
                  </>
                ) : (
                  <>
                    {/* Tourist: header + 2-up coins/Röbel Card row */}
                    <ProfileHeaderCard
                      name={displayName || (user?.preferred_role === 'organisation' ? 'Organisation' : 'Besucher')}
                      avatarUrl={user?.profile_picture_url ?? null}
                      variant="tourist"
                      pillLabel={user?.preferred_role === 'organisation' ? 'Organisation' : 'Besucher:in'}
                      onPress={() => router.push(profileHref as any)}
                    />
                    <TouristActionRow />
                  </>
                )}

                {/* "Lerne mehr über die Röbel App" — citizens (incl. aspiring) only */}
                {!isOrg && (isCitizen || isAspiringCitizen || wantsToBeCitizen) && (
                  <StoryCollectionsBar
                    collections={profileStoryCollections}
                    heading="Lerne mehr über die Röbel App"
                  />
                )}

                {/* Menu Items */}
                <View style={styles.menuSection}>
                  {!isOrg && showBusinessRegister && (
                    <>
                      <View style={styles.menuGroup}>
                        <ProfileMenuItem
                          icon={<StarIcon width={20} height={20} color={colors.textPrimary} />}
                          label="Organisation erstellen"
                          onPress={() => router.push('/create-org' as any)}
                        />
                      </View>
                      <View style={[styles.menuDivider, { backgroundColor: colors.border }]} />
                    </>
                  )}

                  {isOrg ? (
                    <View style={styles.menuGroup}>
                      <ProfileMenuItem
                        icon={<PencilIcon width={20} height={20} color={colors.textPrimary} />}
                        label="Mein Profil"
                        onPress={() => router.push('/edit-org' as any)}
                      />
                      <ProfileMenuItem
                        icon={<CalendarIcon width={20} height={20} color={colors.textPrimary} />}
                        label="Meine Veranstaltungen"
                        onPress={() => router.push('/my-events')}
                      />
                      <ProfileMenuItem
                        icon={<SentIcon width={20} height={20} color={colors.textPrimary} />}
                        label="Feedback geben"
                        onPress={() => router.push('/feedback')}
                      />
                      <ProfileMenuItem
                        icon={<NotificationIcon width={20} height={20} color={colors.textPrimary} />}
                        label="Benachrichtigungen"
                        onPress={() => router.push('/notifications' as any)}
                      />
                      <ProfileMenuItem
                        icon={<SettingsIcon width={20} height={20} color={colors.textPrimary} />}
                        label="Einstellungen"
                        onPress={() => router.push('/org/settings' as any)}
                      />
                      <ProfileMenuItem
                        icon={<HelpCircleIcon width={20} height={20} color={colors.textPrimary} />}
                        label="Hilfe"
                        onPress={() => router.push('/help')}
                      />
                      <ProfileMenuItem
                        icon={<ShieldUserIcon width={20} height={20} color={colors.textPrimary} />}
                        label="Datenschutz"
                        onPress={() => openBrowserAsync('https://www.roebel.app/datenschutz')}
                      />
                    </View>
                  ) : (
                    <>
                      <View style={styles.menuGroup}>
                        {/* "Veranstaltung einsenden" lives in the action grid for
                            citizen / aspiring-citizen modes; tourists still see it
                            here since their layout has no grid. */}
                        {!isCitizen && !isAspiringCitizen && (
                          <ProfileMenuItem
                            icon={<UploadIcon width={20} height={20} color={colors.textPrimary} />}
                            label="Veranstaltung einsenden"
                            onPress={() => router.push('/submit-event')}
                          />
                        )}
                        <ProfileMenuItem
                          icon={<CalendarIcon width={20} height={20} color={colors.textPrimary} />}
                          label="Meine Veranstaltungen"
                          onPress={() => router.push('/my-events')}
                        />
                        <ProfileMenuItem
                          icon={<SentIcon width={20} height={20} color={colors.textPrimary} />}
                          label="Feedback geben"
                          onPress={() => router.push('/feedback')}
                        />
                      </View>

                      <View style={[styles.menuDivider, { backgroundColor: colors.border }]} />

                      <View style={styles.menuGroup}>
                        <ProfileMenuItem
                          icon={<PencilIcon width={20} height={20} color={colors.textPrimary} />}
                          label="Mein Profil"
                          onPress={() => router.push(profileHref as any)}
                        />
                        <ProfileMenuItem
                          icon={<SettingsIcon width={20} height={20} color={colors.textPrimary} />}
                          label="Einstellungen"
                          onPress={() => router.push('/settings' as any)}
                        />
                        <ProfileMenuItem
                          icon={<HelpCircleIcon width={20} height={20} color={colors.textPrimary} />}
                          label="Hilfe & Tipps"
                          onPress={() => router.push('/help')}
                        />
                        <ProfileMenuItem
                          icon={<HelpCircleIcon width={20} height={20} color={colors.textPrimary} />}
                          label="Über die App"
                          onPress={() => openBrowserAsync('https://www.roebel.app/about')}
                        />
                        <ProfileMenuItem
                          icon={<ShieldUserIcon width={20} height={20} color={colors.textPrimary} />}
                          label="Datenschutz"
                          onPress={() => openBrowserAsync('https://www.roebel.app/datenschutz')}
                        />
                      </View>
                    </>
                  )}
                </View>
              </View>
            );
          })()
        )}

      </ScrollView>

      {/* QR Code Scanner FAB - only for verified users */}
      {hasAnyNFT && (
        <Pressable
          onPress={() => router.push('/verification/scan' as any)}
          style={[styles.qrFab, { backgroundColor: colors.primary }]}
          accessibilityRole="button"
          accessibilityLabel="QR-Code scannen"
        >
          <QrCodeIcon width={24} height={24} color={colors.onPrimary} />
        </Pressable>
      )}

      {/* Bottom Navigation */}
      <BottomNavigation
        activeTab={activeTab}
        onTabPress={handleTabPress}
      />

      {/* Drawers */}
      <LoginDrawer
        visible={showLoginDrawer}
        onClose={() => setShowLoginDrawer(false)}
      />

      <LogoutDrawer
        visible={showLogoutDrawer}
        onClose={() => setShowLogoutDrawer(false)}
        onLogout={handleDisconnect}
      />

      {/* Account Switcher Sheet */}
      <BottomDrawer
        visible={showAccountSheet}
        onClose={() => setShowAccountSheet(false)}
        snapPoint={0.7}
      >
        <Text style={[accountSheetStyles.title, { color: colors.textPrimary }]}>Account wechseln</Text>

        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={{ paddingBottom: 12 }}
          showsVerticalScrollIndicator={false}
        >
          {ownedAccounts.map((acc) => {
            const isActive = activeAccount?.id === acc.id;
            const SUB_TYPE_EMOJI: Record<string, string> = { restaurant: '🍽️', unternehmen: '🏢', verein: '🤝', stadt: '🏛️', fraktion: '⚖️' };
            const SUB_TYPE_LABEL: Record<string, string> = { restaurant: 'Restaurant', unternehmen: 'Unternehmen', verein: 'Verein', stadt: 'Stadt', fraktion: 'Fraktion' };
            const emoji = acc.account_type === 'personal' ? '👤' : (acc.sub_type ? SUB_TYPE_EMOJI[acc.sub_type] || '🏢' : '🏢');
            const typeLabel = acc.account_type === 'personal' ? 'Persönlich' : (acc.sub_type ? SUB_TYPE_LABEL[acc.sub_type] || 'Organisation' : 'Organisation');
            const avatarSource = acc.account_type === 'personal' ? user?.profile_picture_url : (acc.avatar_url || acc.cover_url);
            const accDisplayName = acc.account_type === 'personal' ? (user?.username || acc.name) : acc.name;
            const accIsPending = acc.account_type === 'organisation' && !acc.is_verified;

            return (
              <Pressable
                key={acc.id}
                onPress={() => { switchAccount(acc.id); setShowAccountSheet(false); }}
                style={[
                  accountSheetStyles.accountRow,
                  { borderColor: isActive ? colors.primary : colors.border },
                  isActive && { backgroundColor: colors.primaryLight },
                ]}
              >
                {avatarSource ? (
                  <Image source={{ uri: avatarSource }} style={accountSheetStyles.accountAvatar} />
                ) : (
                  <View style={[accountSheetStyles.accountIcon, { backgroundColor: colors.surfaceSecondary }]}>
                    <Text style={accountSheetStyles.accountEmoji}>{emoji}</Text>
                  </View>
                )}
                <View style={accountSheetStyles.accountInfo}>
                  <Text style={[accountSheetStyles.accountName, { color: colors.textPrimary }]}>{accDisplayName}</Text>
                  <Text style={[accountSheetStyles.accountType, { color: colors.textSecondary }]}>{typeLabel}</Text>
                </View>
                {accIsPending && (
                  <View style={[accountSheetStyles.statusPill, { backgroundColor: colors.warningBackground }]}>
                    <Text style={[accountSheetStyles.statusPillText, { color: colors.warning }]}>In Prüfung</Text>
                  </View>
                )}
                {isActive && <Text style={[accountSheetStyles.checkmark, { color: colors.primary }]}>✓</Text>}
              </Pressable>
            );
          })}
        </ScrollView>

        <View style={[accountSheetStyles.divider, { backgroundColor: colors.border }]} />
        <Pressable
          onPress={() => {
            setShowAccountSheet(false);
            if (wallet) disconnect(wallet);
          }}
          style={accountSheetStyles.logoutButton}
        >
          <Text style={accountSheetStyles.logoutText}>Ausloggen</Text>
        </Pressable>
      </BottomDrawer>
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
  headerTitle: {
    fontSize: 22,
    fontFamily: 'MonaSansSemiCondensed-Medium',
  },
  content: {
    flex: 1,
  },
  notConnectedContainer: {
    flex: 1,
  },
  emptyStateContainer: {
    borderWidth: 1,
    borderRadius: 12,
    padding: 20,
    marginHorizontal: 16,
    marginTop: 24,
    marginBottom: 32,
  },
  emptyTitle: {
    fontSize: 16,
    fontFamily: 'Inter-Medium',
    marginBottom: 4,
    textAlign: 'left',
  },
  emptySubtitle: {
    fontSize: 14,
    fontFamily: 'Inter-Regular',
    marginBottom: 12,
    textAlign: 'left',
  },
  primaryButton: {
    height: 48,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
  },
  primaryButtonText: {
    fontSize: 14,
    fontFamily: 'MonaSansSemiCondensed-Bold',
  },
  connectedContainer: {
    paddingTop: 0,
  },
  menuSection: {
    paddingHorizontal: 16,
    marginTop: 24,
  },
  orgStatusWrap: {
    marginHorizontal: 16,
    marginTop: 12,
  },
  promoSection: {
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 8,
    gap: 12,
  },
  menuGroup: {
    gap: 8,
  },
  menuDivider: {
    height: 1,
    marginVertical: 16,
  },
  qrFab: {
    position: 'absolute',
    bottom: BOTTOM_NAV_HEIGHT + 40,
    right: 16,
    width: 56,
    height: 56,
    borderRadius: 28,
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 10,
    ...Platform.select({
      ios: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.15,
        shadowRadius: 8,
      },
      android: {
        elevation: 6,
      },
    }),
  },
  switchButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 6,
    paddingHorizontal: 14,
    borderRadius: 20,
    borderWidth: 1,
  },
  switchButtonText: {
    fontSize: 13,
    fontFamily: 'MonaSansSemiCondensed-Bold',
  },
});

const accountSheetStyles = StyleSheet.create({
  title: {
    fontSize: 20,
    fontFamily: 'Inter-Bold',
    marginBottom: 16,
  },
  accountRow: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 14,
    borderRadius: 16,
    borderWidth: 1,
    marginBottom: 8,
    gap: 12,
  },
  accountAvatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
  },
  accountIcon: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
  },
  accountEmoji: {
    fontSize: 20,
  },
  statusPill: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 8,
  },
  statusPillText: {
    fontSize: 11,
    fontFamily: 'Inter-Medium',
  },
  accountInfo: {
    flex: 1,
  },
  accountName: {
    fontSize: 15,
    fontFamily: 'Inter-SemiBold',
  },
  accountType: {
    fontSize: 12,
    fontFamily: 'Inter-Regular',
    marginTop: 2,
  },
  checkmark: {
    fontSize: 18,
    fontFamily: 'Inter-Bold',
  },
  divider: {
    height: 1,
    marginTop: 8,
    marginBottom: 16,
  },
  logoutButton: {
    alignItems: 'center',
    paddingVertical: 14,
    borderRadius: 12,
  },
  logoutText: {
    fontSize: 15,
    fontFamily: 'Inter-Medium',
    color: '#EF4444',
  },
});
