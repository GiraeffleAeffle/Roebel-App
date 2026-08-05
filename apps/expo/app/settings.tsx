import React, { useState } from 'react';
import { View, Text, ScrollView, Pressable, StyleSheet, Linking, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { openBrowserAsync } from 'expo-web-browser';
import { useActiveAccount, useActiveWallet, useDisconnect } from 'thirdweb/react';
import { useTheme, ThemePreference } from '@/context/ThemeContext';
import { useVerificationContext } from '@/context/VerificationContext';
import { useDeveloperMode } from '@/context/DeveloperModeContext';
import { CustomToggle } from '@/components/consent/CustomToggle';
import { deleteUserAccount, DeleteAccountError } from '@/lib/supabase-account-deletion';
import BottomDrawer from '@/components/BottomDrawer';
import InstallAppCard from '@/components/InstallAppCard';
import ChevronLeftIcon from '@/assets/icons/chevron-left.svg';
import CheckIcon from '@/assets/icons/check.svg';

const DATENSCHUTZ_URL = 'https://www.roebel.app/datenschutz';
const REVOKE_MEMBERSHIP_URL = 'https://www.roebel.app/app/verifizierung/widerrufen';

type SectionProps = {
  title: string;
  children: React.ReactNode;
  colors: ReturnType<typeof useTheme>['colors'];
};

function Section({ title, children, colors }: SectionProps) {
  return (
    <View style={styles.sectionContainer}>
      <Text style={[styles.sectionTitle, { color: colors.textSecondary }]}>{title}</Text>
      <View style={[styles.sectionContent, { backgroundColor: colors.surface }]}>
        {children}
      </View>
    </View>
  );
}

type ThemeOptionProps = {
  label: string;
  description?: string;
  isSelected: boolean;
  onPress: () => void;
  isLast?: boolean;
  colors: ReturnType<typeof useTheme>['colors'];
};

function ThemeOption({ label, description, isSelected, onPress, isLast, colors }: ThemeOptionProps) {
  return (
    <Pressable
      style={[
        styles.themeOptionRow,
        !isLast ? { borderBottomWidth: 1, borderBottomColor: colors.borderSecondary } : undefined,
      ]}
      onPress={onPress}
    >
      <View style={styles.themeOptionTextContainer}>
        <Text style={[styles.themeOptionLabel, { color: colors.textPrimary }]}>{label}</Text>
        {description && (
          <Text style={[styles.themeOptionDescription, { color: colors.textSecondary }]}>
            {description}
          </Text>
        )}
      </View>
      {isSelected && <CheckIcon width={20} height={20} color={colors.primary} />}
    </Pressable>
  );
}

const themeOptions: { value: ThemePreference; label: string; description?: string }[] = [
  { value: 'system', label: 'System', description: 'Folgt den Geräteeinstellungen' },
  { value: 'light', label: 'Hell' },
  { value: 'dark', label: 'Dunkel' },
];

export default function SettingsScreen() {
  const router = useRouter();
  const { preference, setPreference, colors } = useTheme();
  const { hasAnyNFT, hasCitizenNFT, hasAttesterNFT } = useVerificationContext();
  const activeAccount = useActiveAccount();
  const activeWallet = useActiveWallet();
  const { disconnect } = useDisconnect();
  const { isDeveloperMode, toggleDeveloperMode } = useDeveloperMode();
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [showMembershipMenu, setShowMembershipMenu] = useState(false);

  const canRequestAttester = hasCitizenNFT && !hasAttesterNFT;

  const handleDeleteAccount = async () => {
    if (!activeAccount || isDeleting) return;
    setIsDeleting(true);
    try {
      await deleteUserAccount(activeAccount);
      if (activeWallet) {
        disconnect(activeWallet);
      }
      setShowDeleteConfirm(false);
      router.replace('/');
    } catch (err) {
      console.error('Account deletion failed', err);
      const message =
        err instanceof DeleteAccountError
          ? err.message
          : 'Dein Konto konnte nicht gelöscht werden. Bitte versuche es erneut.';
      Alert.alert('Fehler beim Löschen', message);
      setIsDeleting(false);
    }
  };

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={[styles.header, { borderBottomColor: colors.border }]}>
        <Pressable onPress={() => router.back()} style={styles.backButton}>
          <ChevronLeftIcon width={24} height={24} color={colors.textPrimary} />
        </Pressable>
        <Text style={[styles.headerTitle, { color: colors.textPrimary }]}>Einstellungen</Text>
        <View style={styles.headerSpacer} />
      </View>

      <ScrollView style={styles.flex1} showsVerticalScrollIndicator={false}>
        <InstallAppCard />
        <Section title="ERSCHEINUNGSBILD" colors={colors}>
          {themeOptions.map((option, index) => (
            <ThemeOption
              key={option.value}
              label={option.label}
              description={option.description}
              isSelected={preference === option.value}
              onPress={() => setPreference(option.value)}
              isLast={index === themeOptions.length - 1}
              colors={colors}
            />
          ))}
        </Section>

        <Section title="BENACHRICHTIGUNGEN" colors={colors}>
          <Pressable
            style={styles.themeOptionRow}
            onPress={() => router.push('/notifications/settings' as any)}
          >
            <View style={styles.themeOptionTextContainer}>
              <Text style={[styles.themeOptionLabel, { color: colors.textPrimary }]}>
                Pushnachrichten
              </Text>
              <Text style={[styles.themeOptionDescription, { color: colors.textSecondary }]}>
                Benachrichtigungen zu Veranstaltungen, Nachrichten und Beiträgen verwalten.
              </Text>
            </View>
            <Text style={[styles.chevron, { color: colors.textTertiary }]}>›</Text>
          </Pressable>
        </Section>

        <Section title="WALLET" colors={colors}>
          <Pressable
            style={[
              styles.themeOptionRow,
              { borderBottomWidth: 1, borderBottomColor: colors.borderSecondary },
            ]}
            onPress={() => router.push('/wallet' as any)}
          >
            <View style={styles.themeOptionTextContainer}>
              <Text style={[styles.themeOptionLabel, { color: colors.textPrimary }]}>
                Wallet anzeigen
              </Text>
              <Text style={[styles.themeOptionDescription, { color: colors.textSecondary }]}>
                Guthaben, Token und Sammlerstücke ansehen, senden und empfangen.
              </Text>
            </View>
            <Text style={[styles.chevron, { color: colors.textTertiary }]}>›</Text>
          </Pressable>
          <Pressable
            style={[
              styles.themeOptionRow,
              { borderBottomWidth: 1, borderBottomColor: colors.borderSecondary },
            ]}
            onPress={() => router.push('/settings/reveal-key' as any)}
          >
            <View style={styles.themeOptionTextContainer}>
              <Text style={[styles.themeOptionLabel, { color: colors.textPrimary }]}>
                Privatschlüssel anzeigen
              </Text>
              <Text style={[styles.themeOptionDescription, { color: colors.textSecondary }]}>
                Nur mit biometrischer Bestätigung sichtbar.
              </Text>
            </View>
            <Text style={[styles.chevron, { color: colors.textTertiary }]}>›</Text>
          </Pressable>
          <Pressable
            style={styles.themeOptionRow}
            onPress={() => router.push('/settings/nostr' as any)}
          >
            <View style={styles.themeOptionTextContainer}>
              <Text style={[styles.themeOptionLabel, { color: colors.textPrimary }]}>
                Nostr-Identität
              </Text>
              <Text style={[styles.themeOptionDescription, { color: colors.textSecondary }]}>
                Deine öffentlichen Beiträge gehören dir — auch außerhalb dieser App.
              </Text>
            </View>
            <Text style={[styles.chevron, { color: colors.textTertiary }]}>›</Text>
          </Pressable>
        </Section>

        {hasAnyNFT ? (
          <Section title="MITGLIEDSCHAFT" colors={colors}>
            <Pressable
              style={styles.themeOptionRow}
              onPress={() => setShowMembershipMenu(true)}
            >
              <View style={styles.themeOptionTextContainer}>
                <Text style={[styles.themeOptionLabel, { color: colors.textPrimary }]}>
                  Mitgliedschaft verwalten
                </Text>
                <Text style={[styles.themeOptionDescription, { color: colors.textSecondary }]}>
                  {canRequestAttester
                    ? 'Bescheiniger beantragen oder Mitgliedschaft entziehen.'
                    : 'Entziehung im Browser beantragen — eigene Rolle oder anderes Mitglied.'}
                </Text>
              </View>
              <Text style={[styles.chevron, { color: colors.textTertiary }]}>›</Text>
            </Pressable>
          </Section>
        ) : null}

        <Section title="DATENSCHUTZ" colors={colors}>
          <Pressable
            style={[
              styles.themeOptionRow,
              { borderBottomWidth: 1, borderBottomColor: colors.borderSecondary },
            ]}
            onPress={() => router.push('/settings/consent' as any)}
          >
            <View style={styles.themeOptionTextContainer}>
              <Text style={[styles.themeOptionLabel, { color: colors.textPrimary }]}>
                Datenschutz anpassen
              </Text>
              <Text style={[styles.themeOptionDescription, { color: colors.textSecondary }]}>
                Statistik, Mecky-KI, Karten und mehr einzeln steuern.
              </Text>
            </View>
            <Text style={[styles.chevron, { color: colors.textTertiary }]}>›</Text>
          </Pressable>
          <Pressable
            style={styles.themeOptionRow}
            onPress={() => {
              Linking.openURL(DATENSCHUTZ_URL).catch(() => {});
            }}
          >
            <View style={styles.themeOptionTextContainer}>
              <Text style={[styles.themeOptionLabel, { color: colors.textPrimary }]}>
                Datenschutzerklärung
              </Text>
              <Text style={[styles.themeOptionDescription, { color: colors.textSecondary }]}>
                Vollständige Erklärung im Browser öffnen.
              </Text>
            </View>
            <Text style={[styles.chevron, { color: colors.textTertiary }]}>↗</Text>
          </Pressable>
        </Section>

        <Section title="ENTWICKLER" colors={colors}>
          <View
            style={[
              styles.themeOptionRow,
              isDeveloperMode
                ? { borderBottomWidth: 1, borderBottomColor: colors.borderSecondary }
                : undefined,
            ]}
          >
            <View style={styles.themeOptionTextContainer}>
              <Text style={[styles.themeOptionLabel, { color: colors.textPrimary }]}>
                Entwicklermodus
              </Text>
              <Text style={[styles.themeOptionDescription, { color: colors.textSecondary }]}>
                Eigene Mini-Apps per URL in der App testen.
              </Text>
            </View>
            <CustomToggle value={isDeveloperMode} onChange={() => toggleDeveloperMode()} />
          </View>
          {isDeveloperMode && (
            <Pressable
              style={styles.themeOptionRow}
              onPress={() => router.push('/settings/dev-mini-app' as any)}
            >
              <View style={styles.themeOptionTextContainer}>
                <Text style={[styles.themeOptionLabel, { color: colors.textPrimary }]}>
                  Mini-App Vorschau
                </Text>
                <Text style={[styles.themeOptionDescription, { color: colors.textSecondary }]}>
                  URL eingeben und im Mini-App-Host öffnen.
                </Text>
              </View>
              <Text style={[styles.chevron, { color: colors.textTertiary }]}>›</Text>
            </Pressable>
          )}
        </Section>

        {activeAccount && (
          <View style={styles.sectionContainer}>
            <Text style={[styles.sectionTitle, { color: colors.textSecondary }]}>KONTO</Text>
            <View style={[styles.sectionContent, { backgroundColor: colors.surface }]}>
              <Pressable style={styles.themeOptionRow} onPress={() => setShowDeleteConfirm(true)}>
                <View style={styles.themeOptionTextContainer}>
                  <Text style={[styles.themeOptionLabel, { color: colors.error }]}>
                    Konto löschen
                  </Text>
                  <Text style={[styles.themeOptionDescription, { color: colors.textSecondary }]}>
                    Dein Konto und alle dazugehörigen Daten werden unwiderruflich gelöscht.
                  </Text>
                </View>
                <Text style={[styles.chevron, { color: colors.textTertiary }]}>›</Text>
              </Pressable>
            </View>
          </View>
        )}

        <View style={styles.footerNote}>
          <Text style={[styles.footerNoteText, { color: colors.textTertiary }]}>
            Im Modus „System" passt sich die App automatisch an die Einstellungen Ihres Geräts an.
          </Text>
        </View>

        <View style={styles.bottomSpacer} />
      </ScrollView>

      <BottomDrawer
        visible={showMembershipMenu}
        onClose={() => setShowMembershipMenu(false)}
      >
        <View style={membershipStyles.body}>
          <Text style={[membershipStyles.title, { color: colors.textPrimary }]}>
            Mitgliedschaft verwalten
          </Text>

          {canRequestAttester && (
            <Pressable
              onPress={() => {
                setShowMembershipMenu(false);
                router.push('/verification/request-attester/form' as any);
              }}
              style={[membershipStyles.option, { borderColor: colors.borderSecondary }]}
            >
              <Text style={[membershipStyles.optionLabel, { color: colors.textPrimary }]}>
                Bescheiniger beantragen
              </Text>
              <Text style={[membershipStyles.optionDesc, { color: colors.textSecondary }]}>
                Werde Bescheiniger und hilf bei der Verifizierung neuer Mitglieder.
              </Text>
            </Pressable>
          )}

          <Pressable
            onPress={() => {
              setShowMembershipMenu(false);
              openBrowserAsync(REVOKE_MEMBERSHIP_URL).catch(() => {});
            }}
            style={[membershipStyles.option, { borderColor: colors.borderSecondary }]}
          >
            <Text style={[membershipStyles.optionLabel, { color: colors.textPrimary }]}>
              Mitgliedschaft entziehen
            </Text>
            <Text style={[membershipStyles.optionDesc, { color: colors.textSecondary }]}>
              Entziehung beantragen — eigene Rolle oder anderes Mitglied.
            </Text>
          </Pressable>

          <Pressable
            onPress={() => setShowMembershipMenu(false)}
            style={[membershipStyles.cancel, { paddingBottom: 12 }]}
          >
            <Text style={[membershipStyles.cancelText, { color: colors.textSecondary }]}>
              Abbrechen
            </Text>
          </Pressable>
        </View>
      </BottomDrawer>

      <BottomDrawer
        visible={showDeleteConfirm}
        onClose={() => !isDeleting && setShowDeleteConfirm(false)}
      >
        <View style={deleteStyles.body}>
          <Text style={[deleteStyles.title, { color: colors.textPrimary }]}>
            Konto wirklich löschen?
          </Text>
          <Text style={[deleteStyles.text, { color: colors.textSecondary }]}>
            Dein Konto, deine Beiträge, Bewertungen und alle alleinigen Organisationskonten werden
            dauerhaft gelöscht. Diese Aktion kann nicht rückgängig gemacht werden.
          </Text>

          <Pressable
            onPress={handleDeleteAccount}
            disabled={isDeleting}
            style={({ pressed }) => [
              deleteStyles.confirmDelete,
              { opacity: isDeleting || pressed ? 0.85 : 1 },
            ]}
          >
            <Text style={deleteStyles.confirmDeleteText}>
              {isDeleting ? 'Wird gelöscht…' : 'Endgültig löschen'}
            </Text>
          </Pressable>

          <Pressable
            onPress={() => !isDeleting && setShowDeleteConfirm(false)}
            style={[deleteStyles.cancel, { paddingBottom: 12 }]}
          >
            <Text style={[deleteStyles.cancelText, { color: colors.textSecondary }]}>
              Abbrechen
            </Text>
          </Pressable>
        </View>
      </BottomDrawer>
    </SafeAreaView>
  );
}

const membershipStyles = StyleSheet.create({
  body: { gap: 12, paddingTop: 4 },
  title: { fontSize: 18, fontFamily: 'Inter-Bold', marginBottom: 4 },
  option: {
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  optionLabel: { fontSize: 15, fontFamily: 'Inter-SemiBold' },
  optionDesc: { fontSize: 13, fontFamily: 'Inter-Regular', lineHeight: 18, marginTop: 2 },
  cancel: { alignItems: 'center', paddingTop: 6 },
  cancelText: { fontSize: 15, fontFamily: 'Inter-Medium' },
});

const deleteStyles = StyleSheet.create({
  body: { gap: 12, paddingTop: 4 },
  title: { fontSize: 18, fontFamily: 'Inter-Bold' },
  text: { fontSize: 14, fontFamily: 'Inter-Regular', lineHeight: 20, marginBottom: 4 },
  confirmDelete: {
    backgroundColor: '#EF4444',
    height: 52,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
  },
  confirmDeleteText: { color: '#FFFFFF', fontSize: 15, fontFamily: 'Inter-SemiBold' },
  cancel: { alignItems: 'center', paddingTop: 6 },
  cancelText: { fontSize: 15, fontFamily: 'Inter-Medium' },
});

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  flex1: {
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
    fontSize: 18,
    fontFamily: 'MonaSansSemiCondensed-Medium',
  },
  headerSpacer: {
    width: 40,
  },
  sectionContainer: {
    paddingHorizontal: 16,
    paddingTop: 24,
  },
  sectionTitle: {
    fontSize: 13,
    fontFamily: 'MonaSansSemiCondensed-Medium',
    marginBottom: 12,
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  sectionContent: {
    borderRadius: 12,
    overflow: 'hidden',
  },
  themeOptionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  themeOptionTextContainer: {
    flex: 1,
    marginRight: 12,
  },
  themeOptionLabel: {
    fontSize: 15,
    fontFamily: 'Inter-Medium',
  },
  themeOptionDescription: {
    fontSize: 13,
    fontFamily: 'Inter-Regular',
    marginTop: 2,
  },
  footerNote: {
    paddingHorizontal: 16,
    paddingTop: 24,
  },
  footerNoteText: {
    fontSize: 13,
    fontFamily: 'Inter-Regular',
    lineHeight: 18,
  },
  bottomSpacer: {
    height: 40,
  },
  chevron: {
    fontSize: 18,
    fontFamily: 'Inter-Regular',
  },
});
