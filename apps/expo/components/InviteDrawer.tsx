import React, { useState, useCallback, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  TextInput,
  FlatList,
  Image,
  ActivityIndicator,
  Share,
  Alert,
} from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { useActiveAccount } from 'thirdweb/react';
import BottomDrawer from '@/components/BottomDrawer';
import OrgRoleBadge from '@/components/OrgRoleBadge';
import { useTheme } from '@/context/ThemeContext';
import { searchUsersForInvite } from '@/lib/supabase-member-management';
import { createInAppInvite, createLinkInvite } from '@/lib/supabase-invites';
import type { UserRecord, OrgRole } from '@/lib/types';

type Props = {
  visible: boolean;
  onClose: () => void;
  accountId: string;
  existingMemberWallets: string[];
  onInviteSent: () => void;
};

type Tab = 'app' | 'link';
type ExpiryOption = { label: string; days: number };

const EXPIRY_OPTIONS: ExpiryOption[] = [
  { label: '24 Stunden', days: 1 },
  { label: '7 Tage', days: 7 },
  { label: '30 Tage', days: 30 },
];

export default function InviteDrawer({ visible, onClose, accountId, existingMemberWallets, onInviteSent }: Props) {
  const { colors, isDark } = useTheme();
  const account = useActiveAccount();

  const [activeTab, setActiveTab] = useState<Tab>('app');
  const [selectedRole, setSelectedRole] = useState<'admin' | 'member'>('member');
  const [selectedExpiry, setSelectedExpiry] = useState(1); // index into EXPIRY_OPTIONS

  // In-app invite state
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<Pick<UserRecord, 'wallet_address' | 'username' | 'profile_picture_url' | 'tier'>[]>([]);
  const [selectedUser, setSelectedUser] = useState<Pick<UserRecord, 'wallet_address' | 'username' | 'profile_picture_url' | 'tier'> | null>(null);
  const [isSearching, setIsSearching] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Link invite state
  const [generatedLink, setGeneratedLink] = useState<string | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);

  const resetState = () => {
    setSearchQuery('');
    setSearchResults([]);
    setSelectedUser(null);
    setSelectedRole('member');
    setSelectedExpiry(1);
    setGeneratedLink(null);
    setActiveTab('app');
  };

  const handleClose = () => {
    resetState();
    onClose();
  };

  const handleSearch = useCallback(
    (query: string) => {
      setSearchQuery(query);
      setSelectedUser(null);

      if (debounceRef.current) clearTimeout(debounceRef.current);

      if (query.length < 2) {
        setSearchResults([]);
        return;
      }

      debounceRef.current = setTimeout(async () => {
        setIsSearching(true);
        const results = await searchUsersForInvite(query, existingMemberWallets);
        setSearchResults(results);
        setIsSearching(false);
      }, 300);
    },
    [existingMemberWallets]
  );

  const handleSendInAppInvite = async () => {
    if (!selectedUser || !account) return;

    setIsSending(true);
    try {
      // hasPendingInvite now answers only for the calling wallet (the edge
      // function doesn't accept an arbitrary wallet to check — that would
      // leak other wallets' invite status), so there's no client-side
      // precheck for the invitee anymore. Duplicate pending invites for the
      // same person are allowed by the schema; create_invite just proceeds.
      await createInAppInvite(account, accountId, selectedUser.wallet_address, selectedRole);
      onInviteSent();
      handleClose();
    } catch (error: any) {
      Alert.alert('Fehler', error?.message || 'Einladung konnte nicht gesendet werden');
    } finally {
      setIsSending(false);
    }
  };

  const handleCreateLink = async () => {
    if (!account) return;

    setIsGenerating(true);
    try {
      const invite = await createLinkInvite(account, accountId, selectedRole, EXPIRY_OPTIONS[selectedExpiry].days);
      const link = `https://roebel.app/invite/${invite.token}`;
      setGeneratedLink(link);
      onInviteSent();
    } catch (error: any) {
      Alert.alert('Fehler', error?.message || 'Link konnte nicht erstellt werden');
    } finally {
      setIsGenerating(false);
    }
  };

  const handleCopyLink = async () => {
    if (!generatedLink) return;
    await Clipboard.setStringAsync(generatedLink);
    Alert.alert('Kopiert', 'Link wurde in die Zwischenablage kopiert');
  };

  const handleShareLink = async () => {
    if (!generatedLink) return;
    await Share.share({ message: generatedLink });
  };

  return (
    <BottomDrawer visible={visible} onClose={handleClose} snapPoint={0.75}>
      <View style={styles.container}>
        <Text style={[styles.title, { color: colors.textPrimary }]}>Mitglied einladen</Text>

        {/* Tab Selector */}
        <View style={[styles.tabs, { backgroundColor: colors.surfaceSecondary }]}>
          <Pressable
            onPress={() => setActiveTab('app')}
            style={[
              styles.tab,
              activeTab === 'app' && { backgroundColor: colors.surface },
            ]}
          >
            <Text style={[styles.tabText, { color: activeTab === 'app' ? colors.textPrimary : colors.textTertiary }]}>
              In der App
            </Text>
          </Pressable>
          <Pressable
            onPress={() => { setActiveTab('link'); setGeneratedLink(null); }}
            style={[
              styles.tab,
              activeTab === 'link' && { backgroundColor: colors.surface },
            ]}
          >
            <Text style={[styles.tabText, { color: activeTab === 'link' ? colors.textPrimary : colors.textTertiary }]}>
              Per Link
            </Text>
          </Pressable>
        </View>

        {activeTab === 'app' ? (
          /* ── In-App Invite ──────────────────────────────────── */
          <View style={styles.tabContent}>
            {/* Search */}
            <TextInput
              style={[styles.searchInput, { backgroundColor: colors.surfaceSecondary, color: colors.textPrimary, borderColor: colors.border }]}
              placeholder="Name suchen..."
              placeholderTextColor={colors.textTertiary}
              value={searchQuery}
              onChangeText={handleSearch}
              autoCapitalize="none"
            />

            {/* Selected user indicator */}
            {selectedUser && (
              <View style={[styles.selectedUser, { backgroundColor: colors.surfaceSecondary }]}>
                {selectedUser.profile_picture_url ? (
                  <Image source={{ uri: selectedUser.profile_picture_url }} style={styles.smallAvatar} />
                ) : (
                  <View style={[styles.smallAvatarPlaceholder, { backgroundColor: colors.border }]}>
                    <Text style={{ fontSize: 12 }}>{selectedUser.username?.charAt(0).toUpperCase() || '?'}</Text>
                  </View>
                )}
                <Text style={[styles.selectedUserName, { color: colors.textPrimary }]}>{selectedUser.username}</Text>
                <Pressable onPress={() => setSelectedUser(null)}>
                  <Text style={[styles.removeSelected, { color: colors.textTertiary }]}>✕</Text>
                </Pressable>
              </View>
            )}

            {/* Search results */}
            {!selectedUser && searchQuery.length >= 2 && (
              <FlatList
                data={searchResults}
                keyExtractor={(item) => item.wallet_address}
                style={styles.searchResults}
                keyboardShouldPersistTaps="handled"
                ListEmptyComponent={
                  isSearching ? (
                    <ActivityIndicator style={{ padding: 20 }} color={colors.primary} />
                  ) : (
                    <Text style={[styles.noResults, { color: colors.textTertiary }]}>Keine Ergebnisse</Text>
                  )
                }
                renderItem={({ item }) => (
                  <Pressable
                    onPress={() => {
                      setSelectedUser(item);
                      setSearchQuery('');
                      setSearchResults([]);
                    }}
                    style={[styles.searchResultRow, { borderBottomColor: colors.border }]}
                  >
                    {item.profile_picture_url ? (
                      <Image source={{ uri: item.profile_picture_url }} style={styles.smallAvatar} />
                    ) : (
                      <View style={[styles.smallAvatarPlaceholder, { backgroundColor: colors.border }]}>
                        <Text style={{ fontSize: 12 }}>{item.username?.charAt(0).toUpperCase() || '?'}</Text>
                      </View>
                    )}
                    <Text style={[styles.searchResultName, { color: colors.textPrimary }]}>{item.username}</Text>
                  </Pressable>
                )}
              />
            )}

            {/* Role Picker */}
            <Text style={[styles.label, { color: colors.textTertiary }]}>Rolle zuweisen</Text>
            <View style={styles.rolePicker}>
              {(['admin', 'member'] as const).map((role) => (
                <Pressable
                  key={role}
                  onPress={() => setSelectedRole(role)}
                  style={[
                    styles.roleOption,
                    { borderColor: selectedRole === role ? (isDark ? '#7ABBF2' : '#00498B') : colors.border },
                    selectedRole === role && { backgroundColor: isDark ? '#1E3A5F' : '#DBEAFE' },
                  ]}
                >
                  <OrgRoleBadge role={role} size="medium" />
                </Pressable>
              ))}
            </View>

            {/* Send Button */}
            <Pressable
              onPress={handleSendInAppInvite}
              disabled={!selectedUser || isSending}
              style={[
                styles.primaryButton,
                { backgroundColor: colors.primary },
                (!selectedUser || isSending) && styles.disabledButton,
              ]}
            >
              {isSending ? (
                <ActivityIndicator color={colors.onPrimary} />
              ) : (
                <Text style={[styles.primaryButtonText, { color: colors.onPrimary }]}>Einladung senden</Text>
              )}
            </Pressable>
          </View>
        ) : (
          /* ── Link Invite ────────────────────────────────────── */
          <View style={styles.tabContent}>
            {!generatedLink ? (
              <>
                {/* Role Picker */}
                <Text style={[styles.label, { color: colors.textTertiary }]}>Rolle zuweisen</Text>
                <View style={styles.rolePicker}>
                  {(['admin', 'member'] as const).map((role) => (
                    <Pressable
                      key={role}
                      onPress={() => setSelectedRole(role)}
                      style={[
                        styles.roleOption,
                        { borderColor: selectedRole === role ? (isDark ? '#7ABBF2' : '#00498B') : colors.border },
                        selectedRole === role && { backgroundColor: isDark ? '#1E3A5F' : '#DBEAFE' },
                      ]}
                    >
                      <OrgRoleBadge role={role} size="medium" />
                    </Pressable>
                  ))}
                </View>

                {/* Expiry Picker */}
                <Text style={[styles.label, { color: colors.textTertiary }]}>Gültig für</Text>
                <View style={styles.expiryPicker}>
                  {EXPIRY_OPTIONS.map((opt, idx) => (
                    <Pressable
                      key={opt.days}
                      onPress={() => setSelectedExpiry(idx)}
                      style={[
                        styles.expiryOption,
                        { borderColor: selectedExpiry === idx ? (isDark ? '#7ABBF2' : '#00498B') : colors.border },
                        selectedExpiry === idx && { backgroundColor: isDark ? '#1E3A5F' : '#DBEAFE' },
                      ]}
                    >
                      <Text
                        style={[
                          styles.expiryText,
                          { color: selectedExpiry === idx ? (isDark ? '#7ABBF2' : '#00498B') : colors.textTertiary },
                        ]}
                      >
                        {opt.label}
                      </Text>
                    </Pressable>
                  ))}
                </View>

                {/* Generate Button */}
                <Pressable
                  onPress={handleCreateLink}
                  disabled={isGenerating}
                  style={[styles.primaryButton, { backgroundColor: colors.primary }, isGenerating && styles.disabledButton]}
                >
                  {isGenerating ? (
                    <ActivityIndicator color={colors.onPrimary} />
                  ) : (
                    <Text style={[styles.primaryButtonText, { color: colors.onPrimary }]}>Link erstellen</Text>
                  )}
                </Pressable>

                <Text style={[styles.linkNote, { color: colors.textTertiary }]}>
                  Link kann nur einmal verwendet werden
                </Text>
              </>
            ) : (
              /* ── Generated Link View ────────────────────────── */
              <>
                <View style={[styles.linkBox, { backgroundColor: colors.surfaceSecondary, borderColor: colors.border }]}>
                  <Text style={[styles.linkText, { color: colors.textPrimary }]} numberOfLines={2}>
                    {generatedLink}
                  </Text>
                </View>

                <View style={styles.linkActions}>
                  <Pressable
                    onPress={handleCopyLink}
                    style={[styles.secondaryButton, { borderColor: colors.border }]}
                  >
                    <Text style={[styles.secondaryButtonText, { color: colors.textPrimary }]}>Link kopieren</Text>
                  </Pressable>
                  <Pressable
                    onPress={handleShareLink}
                    style={[styles.primaryButton, { backgroundColor: colors.primary, flex: 1 }]}
                  >
                    <Text style={[styles.primaryButtonText, { color: colors.onPrimary }]}>Teilen</Text>
                  </Pressable>
                </View>

                <Text style={[styles.linkNote, { color: colors.textTertiary }]}>
                  Link kann nur einmal verwendet werden
                </Text>
              </>
            )}
          </View>
        )}
      </View>
    </BottomDrawer>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  title: { fontSize: 18, fontFamily: 'Inter-SemiBold', marginBottom: 16 },
  tabs: {
    flexDirection: 'row',
    borderRadius: 10,
    padding: 3,
    marginBottom: 20,
  },
  tab: {
    flex: 1,
    paddingVertical: 8,
    borderRadius: 8,
    alignItems: 'center',
  },
  tabText: { fontSize: 13, fontFamily: 'Inter-Medium' },
  tabContent: { flex: 1 },
  searchInput: {
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
    fontSize: 14,
    fontFamily: 'Inter-Regular',
    marginBottom: 12,
  },
  selectedUser: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderRadius: 8,
    padding: 10,
    marginBottom: 12,
  },
  selectedUserName: { flex: 1, fontSize: 14, fontFamily: 'Inter-Medium' },
  removeSelected: { fontSize: 16, paddingHorizontal: 8 },
  searchResults: { maxHeight: 150, marginBottom: 12 },
  searchResultRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  searchResultName: { fontSize: 14, fontFamily: 'Inter-Medium' },
  smallAvatar: { width: 32, height: 32, borderRadius: 16 },
  smallAvatarPlaceholder: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  noResults: { textAlign: 'center', padding: 16, fontSize: 13, fontFamily: 'Inter-Regular' },
  label: { fontSize: 13, fontFamily: 'Inter-SemiBold', marginBottom: 8 },
  rolePicker: { flexDirection: 'row', gap: 10, marginBottom: 16 },
  roleOption: {
    flex: 1,
    borderWidth: 1,
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  expiryPicker: { flexDirection: 'row', gap: 8, marginBottom: 20 },
  expiryOption: {
    flex: 1,
    borderWidth: 1,
    borderRadius: 8,
    paddingVertical: 10,
    alignItems: 'center',
  },
  expiryText: { fontSize: 12, fontFamily: 'Inter-Medium' },
  primaryButton: {
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 8,
  },
  primaryButtonText: { fontSize: 14, fontFamily: 'MonaSansSemiCondensed-Bold'},
  secondaryButton: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 12,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  secondaryButtonText: { fontSize: 14, fontFamily: 'MonaSansSemiCondensed-Bold'},
  disabledButton: { opacity: 0.5 },
  linkBox: {
    borderWidth: 1,
    borderRadius: 10,
    padding: 14,
    marginBottom: 16,
  },
  linkText: { fontSize: 13, fontFamily: 'Inter-Regular' },
  linkActions: { flexDirection: 'row', gap: 10 },
  linkNote: {
    fontSize: 12,
    fontFamily: 'Inter-Regular',
    textAlign: 'center',
    marginTop: 12,
  },
});
