import React, { useState } from 'react';
import { View, Text, Pressable, ScrollView, StyleSheet, Image, ActivityIndicator, Linking } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useTheme } from '@/context/ThemeContext';
import { useUser } from '@/context/UserContext';
import { useConsent } from '@/context/ConsentContext';
import { useWelcomeWizard } from '@/context/WelcomeWizardContext';
import { updateUserOnboarding } from '@/lib/supabase-users';
import { slugifyDisplayName, ensureUniqueUsernameSlug } from '@/lib/username-slug';
import { setNotificationPromptPending, saveCitizenDraft } from '@/lib/onboarding-storage';
import StoryProgress from '@/components/StoryProgress';
import ChainRecordNotice from '@/components/consent/ChainRecordNotice';
import { useCreateCitizenRequest, REQUEST_STAGE_LABEL, DEFAULT_CITIZEN_REASON } from '@/hooks/useVerification';
import { useVerificationContext } from '@/context/VerificationContext';
import { useSnackbar } from '@/context/SnackbarContext';

const AGB_URL = 'https://www.roebel.app/agb';
const DATENSCHUTZ_URL = 'https://www.roebel.app/datenschutz';

export default function WelcomeConsentScreen() {
  const router = useRouter();
  const { colors } = useTheme();
  const { user, refreshUser } = useUser();
  const { acceptAll, acceptEssential } = useConsent();
  const { state, dispatch } = useWelcomeWizard();
  const [submitting, setSubmitting] = useState(false);
  const { createRequest, stage } = useCreateCitizenRequest();
  const { hasCitizenNFT, activePendingRequest, refresh: refreshVerification } = useVerificationContext();
  const { showSnackbar } = useSnackbar();

  const dismissToProfile = () => {
    dispatch({ type: 'RESET' });
    router.replace('/profile');
  };

  const handleAccept = async () => {
    const roleAtSubmit = state.preferredRole;
    const citizenDataAtSubmit = state.citizenData;
    if (!user?.wallet_address) {
      await acceptAll('welcome_terms');
      await setNotificationPromptPending();
      router.replace('/');
      return;
    }
    setSubmitting(true);
    try {
      // Save the DSGVO consent FIRST and unconditionally. This is the actual
      // data-permission, it only writes local SecureStore, and it does a full
      // overwrite of stored preferences — so accepting here always supersedes
      // an earlier "Nur Notwendige"/decline choice on the standalone screen.
      await acceptAll('welcome_terms');

      // The remaining profile/onboarding writes hit Supabase and must NEVER
      // block the user (consent is already saved). A transient DB hiccup here
      // used to surface a scary "Zustimmung konnte nicht gespeichert werden"
      // modal even though consent succeeded.
      const trimmedName = state.displayName?.replace(/\s+/g, ' ').trim() ?? '';
      let username: string | undefined;
      let displayName: string | undefined;
      if (trimmedName.length >= 2) {
        try {
          const slug = await ensureUniqueUsernameSlug(
            slugifyDisplayName(trimmedName),
            user.wallet_address,
          );
          // users.username_length CHECK requires 3-30 chars.
          if (slug.length >= 3) username = slug;
          displayName = trimmedName;
        } catch (err) {
          console.error('username slug lookup failed (non-fatal):', err);
          displayName = trimmedName;
        }
      }

      // Persist onboarding with one retry; on final failure proceed anyway.
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          await updateUserOnboarding(user.wallet_address, {
            username,
            displayName,
            preferredRole: state.preferredRole ?? undefined,
            termsAccepted: true,
            markCompleted: true,
          });
          break;
        } catch (err) {
          if (attempt === 0) {
            await new Promise((resolve) => setTimeout(resolve, 600));
            continue;
          }
          console.error('Failed to persist onboarding (non-fatal):', err);
        }
      }

      await refreshUser();

      // Bürger path: fire the verification request automatically so the data
      // from the citizen-data step is never typed twice. Never blocks onboarding.
      if (roleAtSubmit === 'buerger' && citizenDataAtSubmit && !hasCitizenNFT && !activePendingRequest) {
        try {
          await createRequest(citizenDataAtSubmit, DEFAULT_CITIZEN_REASON);
          // Post-success refresh is best-effort — the verification context
          // self-corrects on its next natural refresh; a failure here must
          // not read as "request failed" (no draft, no error snackbar).
          await refreshVerification().catch((err) =>
            console.warn('verification refresh failed (non-fatal):', err),
          );
        } catch (err) {
          console.error('Auto citizen request failed (non-fatal):', err);
          await saveCitizenDraft(citizenDataAtSubmit);
          showSnackbar({
            message: 'Dein Bürger-Antrag konnte nicht gesendet werden — starte ihn später im Profil, deine Angaben sind vorausgefüllt.',
          });
        }
      }
    } finally {
      await setNotificationPromptPending();
      dispatch({ type: 'RESET' });
      setSubmitting(false);
      router.replace((roleAtSubmit === 'organisation' ? '/create-org' : '/') as any);
    }
  };

  const handleDecline = async () => {
    if (user?.wallet_address) {
      try {
        const trimmedName = state.displayName?.replace(/\s+/g, ' ').trim() ?? '';
        let username: string | undefined;
        let displayName: string | undefined;
        if (trimmedName.length >= 2) {
          const slug = await ensureUniqueUsernameSlug(
            slugifyDisplayName(trimmedName),
            user.wallet_address,
          );
          // users.username_length CHECK requires 3-30 chars.
          if (slug.length >= 3) username = slug;
          displayName = trimmedName;
        }
        await updateUserOnboarding(user.wallet_address, {
          username,
          displayName,
          preferredRole: state.preferredRole ?? undefined,
          markCompleted: true,
        });
        await refreshUser();
      } catch (err) {
        console.error('Failed to persist declined onboarding:', err);
      }
    }
    await acceptEssential('welcome_terms');
    dismissToProfile();
  };

  const openUrl = (url: string) => {
    Linking.openURL(url).catch((err) => {
      console.error('Failed to open URL:', err);
    });
  };

  return (
    <SafeAreaView edges={['bottom']} style={[styles.safeArea, { backgroundColor: colors.background }]}>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        <StoryProgress
          step={state.preferredRole === 'buerger' ? 4 : 3}
          totalSteps={state.preferredRole === 'buerger' ? 4 : 3}
        />
        <Image
          source={require('../../assets/icons/Heart.png')}
          style={styles.illustration}
          resizeMode="contain"
          accessibilityIgnoresInvertColors
        />

        <Text style={[styles.eyebrow, { color: colors.textSecondary }]}>Unsere Gemeinschaft</Text>
        <Text style={[styles.heading, { color: colors.textPrimary }]}>
          Röbel ist eine Gemeinschaft, in der alle willkommen sind.
        </Text>

        <Text style={[styles.body, { color: colors.textSecondary }]}>
          Um diese App zu nutzen, bitten wir dich um dein Einverständnis zu folgendem:
        </Text>

        <Text style={[styles.body, { color: colors.textSecondary }]}>
          Ich trage zu Röbel als Gemeinschaft bei — durch den Schutz der Privatsphäre, demokratische
          Mitwirkung, Anerkennung von Leistung, kommunale Souveränität und nachhaltiges Handeln.
        </Text>

        <Text style={[styles.body, { color: colors.textSecondary }]}>
          Mit „Akzeptieren" stimme ich den folgenden Dokumenten zu:
        </Text>

        <View style={styles.linksRow}>
          <Pressable onPress={() => openUrl(AGB_URL)} accessibilityRole="link">
            <Text style={[styles.link, { color: colors.primary }]}>AGB</Text>
          </Pressable>
          <Text style={[styles.linkSep, { color: colors.textTertiary }]}>·</Text>
          <Pressable onPress={() => openUrl(DATENSCHUTZ_URL)} accessibilityRole="link">
            <Text style={[styles.link, { color: colors.primary }]}>Datenschutz</Text>
          </Pressable>
        </View>

        {/* Accepting on the Bürger path auto-fires the citizen request (the
            on-chain mint), so the Art.-13/14 permanence notice must be read
            HERE, before that accept — not only on the manual form. */}
        {state.preferredRole === 'buerger' &&
          !!state.citizenData &&
          !hasCitizenNFT &&
          !activePendingRequest && <ChainRecordNotice />}
      </ScrollView>

      <View style={[styles.footer, { borderTopColor: colors.border }]}>
        <Pressable
          onPress={handleAccept}
          disabled={submitting}
          style={[styles.acceptButton, { backgroundColor: colors.primary }, submitting && { opacity: 0.6 }]}
        >
          {submitting ? (
            <View style={styles.acceptProgressRow}>
              <ActivityIndicator color={colors.onPrimary} />
              {stage !== 'idle' && (
                <Text style={[styles.acceptText, { color: colors.onPrimary }]}>
                  {REQUEST_STAGE_LABEL[stage]}
                </Text>
              )}
            </View>
          ) : (
            <Text style={[styles.acceptText, { color: colors.onPrimary }]}>Akzeptieren</Text>
          )}
        </Pressable>
        <Pressable onPress={handleDecline} disabled={submitting} style={styles.declineButton}>
          <Text style={[styles.declineText, { color: colors.textSecondary }]}>Ablehnen</Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: 24,
    paddingTop: 24,
    paddingBottom: 24,
  },
  illustration: {
    width: 56,
    height: 56,
    marginBottom: 24,
  },
  eyebrow: {
    fontSize: 13,
    fontFamily: 'Inter-Medium',
    marginBottom: 8,
  },
  heading: {
    fontSize: 26,
    fontFamily: 'Inter-Bold',
    lineHeight: 32,
    marginBottom: 24,
  },
  body: {
    fontSize: 15,
    fontFamily: 'Inter-Regular',
    lineHeight: 22,
    marginBottom: 16,
  },
  linksRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 4,
  },
  link: {
    fontSize: 15,
    fontFamily: 'Inter-Medium',
    textDecorationLine: 'underline',
  },
  linkSep: {
    fontSize: 15,
    fontFamily: 'Inter-Medium',
  },
  footer: {
    paddingHorizontal: 24,
    paddingTop: 16,
    paddingBottom: 24,
    borderTopWidth: 1,
    gap: 8,
  },
  acceptButton: {
    borderRadius: 16,
    paddingVertical: 16,
    alignItems: 'center',
  },
  acceptText: {
    fontSize: 15,
    fontFamily: 'Inter-Medium',
  },
  acceptProgressRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  declineButton: {
    paddingVertical: 14,
    alignItems: 'center',
  },
  declineText: {
    fontSize: 14,
    fontFamily: 'Inter-Medium',
  },
});
