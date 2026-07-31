/**
 * Citizen Request Form Screen
 *
 * Form for users to create a citizen attestation request
 */

import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, TextInput, Pressable, ActivityIndicator, Image, Platform } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import DateTimePicker from '@react-native-community/datetimepicker';
import { KeyboardAwareScrollView } from 'react-native-keyboard-aware-scroll-view';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useActiveAccount } from 'thirdweb/react';
import { useCreateCitizenRequest, REQUEST_STAGE_LABEL, DEFAULT_CITIZEN_REASON } from '@/hooks/useVerification';
import { loadCitizenDraft, clearCitizenDraft } from '@/lib/onboarding-storage';
import { useVerificationContext } from '@/context/VerificationContext';
import { useTheme } from '@/context/ThemeContext';
import ErrorDrawer from '@/components/ErrorDrawer';
import ChainRecordNotice from '@/components/consent/ChainRecordNotice';
import { InformationCircleIcon } from '@/components/Icons';
const DEFAULT_PICKER_DATE = new Date(1990, 0, 1);
const MIN_BIRTHDATE = new Date(1900, 0, 1);
const pad2 = (n: number) => String(n).padStart(2, '0');
const formatGerman = (d: Date) => `${pad2(d.getDate())}.${pad2(d.getMonth() + 1)}.${d.getFullYear()}`;
const toIsoDate = (d: Date) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;

export default function RequestCitizenScreen() {
  const router = useRouter();
  const { colors } = useTheme();
  const account = useActiveAccount();
  const { hasCitizenNFT, activePendingRequest, refresh } = useVerificationContext();
  const { createRequest, isLoading, stage } = useCreateCitizenRequest();

  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [birthDate, setBirthDate] = useState<Date | null>(null);
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [address, setAddress] = useState('');

  const [errorDrawer, setErrorDrawer] = useState({ visible: false, message: '' });

  // Prefill from the onboarding draft (saved when the auto-submit at the end of
  // the welcome wizard failed) so the user never types their data twice.
  useEffect(() => {
    loadCitizenDraft().then((draft) => {
      if (!draft) return;
      setFirstName((v) => v || draft.firstName);
      setLastName((v) => v || draft.lastName);
      setAddress((v) => v || draft.address);
      setBirthDate((v) => v ?? (draft.birthdate ? new Date(draft.birthdate) : null));
    });
  }, []);

  const lockIcon = require('@/assets/illustration/small/encryption.png');

  const handleSubmit = async () => {
    if (!firstName.trim() || !lastName.trim()) {
      setErrorDrawer({ visible: true, message: 'Bitte geben Sie Vor- und Nachnamen ein.' });
      return;
    }

    if (!birthDate) {
      setErrorDrawer({ visible: true, message: 'Bitte wählen Sie Ihr Geburtsdatum.' });
      return;
    }
    const iso = toIsoDate(birthDate);

    if (!address.trim()) {
      setErrorDrawer({ visible: true, message: 'Bitte geben Sie Ihre Adresse ein.' });
      return;
    }

    if (!account) {
      setErrorDrawer({ visible: true, message: 'Bitte verbinden Sie Ihre Wallet.' });
      return;
    }

    try {
      const result = await createRequest(
        { firstName: firstName.trim(), lastName: lastName.trim(), birthdate: iso, address: address.trim() },
        DEFAULT_CITIZEN_REASON
      );

      await refresh();

      await clearCitizenDraft();

      router.replace({
        pathname: '/verification/request-citizen/success' as any,
        params: { requestId: String(result.requestId) },
      });
    } catch (error) {
      console.error('Failed to create request:', error);
      setErrorDrawer({
        visible: true,
        message: error instanceof Error ? error.message : 'Der Antrag konnte nicht erstellt werden. Bitte versuchen Sie es erneut.'
      });
    }
  };

  if (hasCitizenNFT) {
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
        <View style={styles.messageContainer}>
          <Text style={[styles.messageTitle, { color: colors.textPrimary }]}>&#x2713; Bereits verifiziert</Text>
          <Text style={[styles.messageText, { color: colors.textSecondary }]}>Sie sind bereits ein verifizierter Bürger.</Text>
          <Pressable style={[styles.button, { backgroundColor: colors.primary }]} onPress={() => router.back()}>
            <Text style={[styles.buttonText, { color: colors.onPrimary }]}>Zurück</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  if (activePendingRequest) {
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
        <View style={styles.messageContainer}>
          <Text style={[styles.messageTitle, { color: colors.textPrimary }]}>&#x23F3; Antrag ausstehend</Text>
          <Text style={[styles.messageText, { color: colors.textSecondary }]}>Sie haben bereits einen ausstehenden Antrag.</Text>
          <Pressable
            style={[styles.button, { backgroundColor: colors.primary }]}
            onPress={() => router.replace('/verification/my-request' as any)}
          >
            <Text style={[styles.buttonText, { color: colors.onPrimary }]}>Meinen Antrag anzeigen</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]} edges={['top', 'left', 'right', 'bottom']}>
      <View style={styles.header}>
        <Pressable
          onPress={() => router.back()}
          style={styles.closeButton}
          hitSlop={12}
          accessibilityRole="button"
          accessibilityLabel="Schließen"
        >
          <Ionicons name="close" size={28} color={colors.textPrimary} />
        </Pressable>
      </View>

      <KeyboardAwareScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        enableOnAndroid={true}
        enableAutomaticScroll={true}
        extraScrollHeight={100}
        extraHeight={150}
      >
        <View style={styles.privacyHeader}>
          <Image source={lockIcon} style={styles.lockIcon} resizeMode="contain" accessibilityIgnoresInvertColors />
          <Text style={[styles.privacyTitle, { color: colors.textPrimary }]}>Antrag stellen</Text>
          <Text style={[styles.privacyBody, { color: colors.textSecondary }]}>
            Ihre Angaben bleiben auf Ihrem Gerät. Gespeichert wird nur ein nicht umkehrbarer Fingerabdruck — niemand kann daraus Ihren Namen lesen.
          </Text>
        </View>

        <View style={styles.formGroup}>
          <Text style={[styles.label, { color: colors.textPrimary }]}>Vorname *</Text>
          <TextInput
            style={[
              styles.input,
              {
                backgroundColor: colors.background,
                borderColor: colors.borderSecondary,
                color: colors.textPrimary,
              },
            ]}
            placeholder="Anna"
            placeholderTextColor={colors.textTertiary}
            value={firstName}
            onChangeText={setFirstName}
            editable={!isLoading}
            autoCapitalize="words"
          />
          <Text style={[styles.fieldHint, { color: colors.textTertiary }]}>Teil Ihres persönlichen Fingerabdrucks.</Text>
        </View>

        <View style={styles.formGroup}>
          <Text style={[styles.label, { color: colors.textPrimary }]}>Nachname *</Text>
          <TextInput
            style={[
              styles.input,
              {
                backgroundColor: colors.background,
                borderColor: colors.borderSecondary,
                color: colors.textPrimary,
              },
            ]}
            placeholder="Müller"
            placeholderTextColor={colors.textTertiary}
            value={lastName}
            onChangeText={setLastName}
            editable={!isLoading}
            autoCapitalize="words"
          />
          <Text style={[styles.fieldHint, { color: colors.textTertiary }]}>Teil Ihres persönlichen Fingerabdrucks.</Text>
        </View>

        <View style={styles.formGroup}>
          <Text style={[styles.label, { color: colors.textPrimary }]}>Geburtsdatum *</Text>
          <Pressable
            onPress={() => { if (!isLoading) setShowDatePicker(true); }}
            style={[
              styles.input,
              styles.dateField,
              { backgroundColor: colors.background, borderColor: colors.borderSecondary },
            ]}
            accessibilityRole="button"
            accessibilityLabel="Geburtsdatum auswählen"
          >
            <Text style={[styles.dateText, { color: birthDate ? colors.textPrimary : colors.textTertiary }]}>
              {birthDate ? formatGerman(birthDate) : 'TT.MM.JJJJ'}
            </Text>
            <Ionicons name="calendar-outline" size={20} color={colors.textTertiary} />
          </Pressable>
          {showDatePicker && (
            <DateTimePicker
              value={birthDate ?? DEFAULT_PICKER_DATE}
              mode="date"
              display="default"
              maximumDate={new Date()}
              minimumDate={MIN_BIRTHDATE}
              onChange={(event, date) => {
                setShowDatePicker(Platform.OS === 'ios');
                if (date) setBirthDate(date);
                if (Platform.OS === 'android') setShowDatePicker(false);
              }}
            />
          )}
          <Text style={[styles.fieldHint, { color: colors.textTertiary }]}>Sichert: eine Person, eine Stimme.</Text>
        </View>

        <View style={styles.formGroup}>
          <Text style={[styles.label, { color: colors.textPrimary }]}>Adresse in Röbel/Müritz *</Text>
          <TextInput
            style={[
              styles.input,
              {
                backgroundColor: colors.background,
                borderColor: colors.borderSecondary,
                color: colors.textPrimary,
              },
            ]}
            placeholder="Musterstraße 123, 17207 Röbel"
            placeholderTextColor={colors.textTertiary}
            value={address}
            onChangeText={setAddress}
            editable={!isLoading}
            autoCapitalize="words"
          />
          <Text style={[styles.fieldHint, { color: colors.textTertiary }]}>Belegt Ihren Wohnsitz in Röbel/Müritz.</Text>
        </View>

        <View style={styles.infoBanner}>
          <View style={[styles.infoIconCircle, { backgroundColor: colors.surface }]}>
            <InformationCircleIcon size={18} color={colors.primary} />
          </View>
          <Text style={[styles.infoText, { color: colors.textPrimary }]}>
            Nach dem Antrag erhalten Sie einen QR-Code um Signaturen einzusammeln.
          </Text>
        </View>

        {/* Art. 13/14: the permanence of the on-chain record must be understood
            BEFORE the request is submitted — submitting is the consent moment. */}
        <ChainRecordNotice />
      </KeyboardAwareScrollView>

      <View style={styles.footer}>
        <Pressable
          style={[styles.submitButton, { backgroundColor: colors.primary }, isLoading && styles.submitButtonDisabled]}
          onPress={handleSubmit}
          disabled={isLoading}
          accessibilityRole="button"
        >
          {isLoading ? (
            <View style={styles.submitButtonContent}>
              <ActivityIndicator color={colors.onPrimary} />
              <Text style={[styles.submitButtonText, { color: colors.onPrimary }]}>
                {REQUEST_STAGE_LABEL[stage === 'idle' ? 'encrypting' : stage]}
              </Text>
            </View>
          ) : (
            <Text style={[styles.submitButtonText, { color: colors.onPrimary }]}>
              {REQUEST_STAGE_LABEL.idle}
            </Text>
          )}
        </Pressable>
      </View>

      <ErrorDrawer
        visible={errorDrawer.visible}
        message={errorDrawer.message}
        onDismiss={() => setErrorDrawer({ visible: false, message: '' })}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    height: 56,
    justifyContent: 'center',
    paddingHorizontal: 16,
  },
  closeButton: {
    width: 44,
    height: 44,
    alignItems: 'flex-start',
    justifyContent: 'center',
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: 24,
    paddingBottom: 24,
  },
  privacyHeader: {
    marginTop: 8,
    marginBottom: 28,
  },
  lockIcon: {
    width: 56,
    height: 56,
    marginBottom: 16,
  },
  privacyTitle: {
    fontFamily: 'Inter-Medium',
    fontSize: 26,
    marginBottom: 10,
  },
  privacyBody: {
    fontFamily: 'Inter-Regular',
    fontSize: 14,
    lineHeight: 20,
  },
  formGroup: {
    marginBottom: 20,
  },
  label: {
    fontFamily: 'Inter-Medium',
    fontSize: 14,
    marginBottom: 8,
  },
  input: {
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
    fontSize: 15,
    fontFamily: 'Inter-Regular',
  },
  dateField: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  dateText: {
    fontSize: 15,
    fontFamily: 'Inter-Regular',
  },
  fieldHint: {
    fontFamily: 'Inter-Regular',
    fontSize: 12,
    lineHeight: 16,
    marginTop: 6,
  },
  infoBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginTop: 12,
    paddingVertical: 12,
  },
  infoIconCircle: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  infoText: {
    flex: 1,
    fontFamily: 'Inter-Regular',
    fontSize: 14,
    lineHeight: 19,
  },
  footer: {
    paddingHorizontal: 24,
    paddingBottom: 16,
    paddingTop: 8,
  },
  submitButton: {
    borderRadius: 16,
    paddingVertical: 18,
    paddingHorizontal: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  submitButtonDisabled: {
    opacity: 0.6,
  },
  submitButtonContent: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  submitButtonText: {
    fontFamily: 'MonaSansSemiCondensed-Bold',
    fontSize: 16,
  },
  messageContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 32,
  },
  messageTitle: {
    fontSize: 24,
    fontFamily: 'Inter-Medium',
    marginBottom: 12,
  },
  messageText: {
    fontSize: 16,
    fontFamily: 'Inter-Regular',
    textAlign: 'center',
    marginBottom: 24,
  },
  button: {
    borderRadius: 12,
    paddingHorizontal: 24,
    paddingVertical: 12,
  },
  buttonText: {
    fontSize: 15,
    fontFamily: 'MonaSansSemiCondensed-Bold',
  },
});
