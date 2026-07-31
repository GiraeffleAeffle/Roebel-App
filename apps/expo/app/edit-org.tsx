import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  TextInput,
  Alert,
  ActivityIndicator,
  Switch,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { KeyboardAwareScrollView } from 'react-native-keyboard-aware-scroll-view';
import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import { Stack, useRouter } from 'expo-router';
import { useActiveAccount } from 'thirdweb/react';
import { useTheme } from '@/context/ThemeContext';
import { useAccount } from '@/context/AccountContext';
import { updateAccount } from '@/lib/supabase-accounts';
import { uploadMediaFile } from '@/lib/upload-media';
import { subTypeFeatures, type OpeningHours, type OrgSubType } from '@/lib/types';
import ChevronLeftIcon from '@/assets/icons/chevron-left.svg';

const ORG_TYPE_LABELS: Record<OrgSubType, string> = {
  restaurant: 'Restaurant',
  unternehmen: 'Unternehmen',
  verein: 'Verein',
  stadt: 'Stadt',
  fraktion: 'Fraktion',
  journalist: 'Journalist',
};

type DayOfWeek = 'monday' | 'tuesday' | 'wednesday' | 'thursday' | 'friday' | 'saturday' | 'sunday';

const DAY_LABELS: { key: DayOfWeek; label: string }[] = [
  { key: 'monday', label: 'Montag' },
  { key: 'tuesday', label: 'Dienstag' },
  { key: 'wednesday', label: 'Mittwoch' },
  { key: 'thursday', label: 'Donnerstag' },
  { key: 'friday', label: 'Freitag' },
  { key: 'saturday', label: 'Samstag' },
  { key: 'sunday', label: 'Sonntag' },
];

type OpeningHoursState = Record<DayOfWeek, { open: string; close: string; closed: boolean }>;

const DEFAULT_HOURS: OpeningHoursState = {
  monday: { open: '09:00', close: '17:00', closed: false },
  tuesday: { open: '09:00', close: '17:00', closed: false },
  wednesday: { open: '09:00', close: '17:00', closed: false },
  thursday: { open: '09:00', close: '17:00', closed: false },
  friday: { open: '09:00', close: '17:00', closed: false },
  saturday: { open: '09:00', close: '13:00', closed: true },
  sunday: { open: '', close: '', closed: true },
};

function hydrateHours(source: OpeningHours | null | undefined): OpeningHoursState {
  if (!source) return DEFAULT_HOURS;
  const state: OpeningHoursState = { ...DEFAULT_HOURS };
  for (const { key } of DAY_LABELS) {
    const d = source[key];
    if (d) {
      state[key] = { open: d.open || '', close: d.close || '', closed: !!d.closed };
    }
  }
  return state;
}

export default function EditOrgScreen() {
  const router = useRouter();
  const { colors } = useTheme();
  const { activeAccount, isOwnerOf, refreshAccounts } = useAccount();
  const account = useActiveAccount();

  const [name, setName] = useState(activeAccount?.name ?? '');
  const [bio, setBio] = useState(activeAccount?.bio ?? '');
  const [contactEmail, setContactEmail] = useState(activeAccount?.contact_email ?? '');
  const [avatarUrl, setAvatarUrl] = useState<string | null>(activeAccount?.avatar_url ?? null);
  const [coverUrl, setCoverUrl] = useState<string | null>(activeAccount?.cover_url ?? null);
  const [hours, setHours] = useState<OpeningHoursState>(() => hydrateHours(activeAccount?.opening_hours));

  const [uploadingLogo, setUploadingLogo] = useState(false);
  const [uploadingCover, setUploadingCover] = useState(false);
  const [saving, setSaving] = useState(false);

  // Permission guard: only owners of the active org can edit
  useEffect(() => {
    if (!activeAccount) return;
    if (activeAccount.account_type !== 'organisation' || !isOwnerOf(activeAccount.id)) {
      router.back();
    }
  }, [activeAccount?.id, activeAccount?.account_type]);

  if (!activeAccount || activeAccount.account_type !== 'organisation') {
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
        <Stack.Screen options={{ headerShown: false }} />
        <View style={styles.center}>
          <ActivityIndicator color={colors.primary} />
        </View>
      </SafeAreaView>
    );
  }

  const showOpeningHours = subTypeFeatures(activeAccount.sub_type).openingHours;

  const pickImage = async (type: 'logo' | 'cover') => {
    const aspect: [number, number] = type === 'logo' ? [1, 1] : [16, 9];
    const setUploading = type === 'logo' ? setUploadingLogo : setUploadingCover;
    const folder = type === 'logo' ? 'org-logos' : 'org-covers';

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsEditing: true,
      aspect,
      quality: 0.8,
    });
    if (result.canceled || !result.assets[0]?.uri) return;

    setUploading(true);
    const url = await uploadMediaFile(
      result.assets[0].uri,
      '',
      'image',
      folder,
      result.assets[0].mimeType,
    );
    setUploading(false);

    if (url) {
      if (type === 'logo') setAvatarUrl(url);
      else setCoverUrl(url);
    } else {
      Alert.alert('Fehler', 'Bild konnte nicht hochgeladen werden.');
    }
  };

  const updateHour = (day: DayOfWeek, field: 'open' | 'close', value: string) => {
    setHours((prev) => ({ ...prev, [day]: { ...prev[day], [field]: value } }));
  };

  const toggleDayClosed = (day: DayOfWeek) => {
    setHours((prev) => ({ ...prev, [day]: { ...prev[day], closed: !prev[day].closed } }));
  };

  const handleSave = async () => {
    if (!name.trim()) {
      Alert.alert('Fehler', 'Name darf nicht leer sein.');
      return;
    }
    if (!account) {
      Alert.alert('Fehler', 'Keine Wallet verbunden.');
      return;
    }

    setSaving(true);
    try {
      const openingHoursPayload: OpeningHours = {};
      for (const { key } of DAY_LABELS) {
        const h = hours[key];
        openingHoursPayload[key] = { open: h.open, close: h.close, closed: h.closed };
      }

      await updateAccount(account, activeAccount.id, {
        name: name.trim(),
        bio: bio.trim() || null,
        avatar_url: avatarUrl,
        cover_url: coverUrl,
        contact_email: contactEmail.trim() || null,
        ...(showOpeningHours ? { opening_hours: openingHoursPayload } : {}),
      });
      await refreshAccounts();
      router.back();
    } catch (err: any) {
      console.error('Failed to save org profile:', err);
      Alert.alert('Fehler', err?.message || 'Profil konnte nicht gespeichert werden.');
    } finally {
      setSaving(false);
    }
  };

  const orgTypeLabel = activeAccount.sub_type ? ORG_TYPE_LABELS[activeAccount.sub_type] : null;

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={[styles.header, { borderBottomColor: colors.border }]}>
        <Pressable onPress={() => router.back()} style={styles.backButton} hitSlop={8}>
          <ChevronLeftIcon width={24} height={24} color={colors.textPrimary} />
        </Pressable>
        <Text style={[styles.headerTitle, { color: colors.textPrimary }]}>Profil bearbeiten</Text>
        <View style={styles.backButton} />
      </View>

      <KeyboardAwareScrollView
        style={styles.content}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        enableOnAndroid
        extraScrollHeight={100}
        extraHeight={150}
      >
        {/* Cover (Titelbild) */}
        <View style={styles.coverSection}>
          <Pressable onPress={() => pickImage('cover')} disabled={uploadingCover} style={styles.coverPressable}>
            {coverUrl ? (
              <Image source={{ uri: coverUrl }} style={styles.coverImage} contentFit="cover" />
            ) : (
              <View
                style={[
                  styles.coverPlaceholder,
                  { backgroundColor: colors.surface, borderColor: colors.border },
                ]}
              >
                <Text style={styles.placeholderIcon}>🖼️</Text>
                <Text style={[styles.placeholderText, { color: colors.textTertiary }]}>Titelbild wählen</Text>
              </View>
            )}
            {uploadingCover && (
              <View style={styles.coverOverlay}>
                <ActivityIndicator color="#ffffff" />
              </View>
            )}
          </Pressable>
        </View>

        {/* Logo */}
        <View style={styles.logoSection}>
          <Pressable onPress={() => pickImage('logo')} disabled={uploadingLogo}>
            {avatarUrl ? (
              <Image source={{ uri: avatarUrl }} style={styles.logoImage} contentFit="cover" />
            ) : (
              <View
                style={[
                  styles.logoPlaceholder,
                  { backgroundColor: colors.surface, borderColor: colors.border },
                ]}
              >
                <Text style={styles.placeholderIcon}>📷</Text>
              </View>
            )}
            {uploadingLogo && (
              <View style={styles.logoOverlay}>
                <ActivityIndicator color="#ffffff" />
              </View>
            )}
          </Pressable>
          <Pressable onPress={() => pickImage('logo')} disabled={uploadingLogo}>
            <Text style={[styles.changePhotoText, { color: colors.primary }]}>Logo ändern</Text>
          </Pressable>
        </View>

        {/* Org-Typ (read-only) */}
        {orgTypeLabel && (
          <View style={styles.fieldSection}>
            <Text style={[styles.fieldLabel, { color: colors.textSecondary }]}>ORG-TYP</Text>
            <View style={[styles.readOnlyPill, { backgroundColor: colors.surface }]}>
              <Text style={[styles.readOnlyText, { color: colors.textPrimary }]}>{orgTypeLabel}</Text>
            </View>
          </View>
        )}

        {/* Name */}
        <View style={styles.fieldSection}>
          <Text style={[styles.fieldLabel, { color: colors.textSecondary }]}>NAME</Text>
          <View style={[styles.inputContainer, { backgroundColor: colors.surface }]}>
            <TextInput
              style={[styles.input, { color: colors.textPrimary }]}
              value={name}
              onChangeText={setName}
              placeholder="Name der Organisation"
              placeholderTextColor={colors.textTertiary}
              maxLength={100}
            />
          </View>
          <Text style={[styles.fieldHint, { color: colors.textTertiary }]}>{name.length}/100 Zeichen</Text>
        </View>

        {/* Beschreibung */}
        <View style={styles.fieldSection}>
          <Text style={[styles.fieldLabel, { color: colors.textSecondary }]}>BESCHREIBUNG</Text>
          <View style={[styles.inputContainer, { backgroundColor: colors.surface }]}>
            <TextInput
              style={[styles.input, styles.textArea, { color: colors.textPrimary }]}
              value={bio}
              onChangeText={setBio}
              placeholder="Was macht eure Organisation aus?"
              placeholderTextColor={colors.textTertiary}
              multiline
              numberOfLines={4}
              maxLength={500}
              textAlignVertical="top"
            />
          </View>
          <Text style={[styles.fieldHint, { color: colors.textTertiary }]}>{bio.length}/500 Zeichen</Text>
        </View>

        {/* Contact email */}
        <View style={styles.fieldSection}>
          <Text style={[styles.fieldLabel, { color: colors.textSecondary }]}>KONTAKT-E-MAIL</Text>
          <View style={[styles.inputContainer, { backgroundColor: colors.surface }]}>
            <TextInput
              style={[styles.input, { color: colors.textPrimary }]}
              value={contactEmail}
              onChangeText={setContactEmail}
              placeholder="kontakt@beispiel.de"
              placeholderTextColor={colors.textTertiary}
              keyboardType="email-address"
              autoCapitalize="none"
              autoCorrect={false}
            />
          </View>
        </View>

        {/* Opening hours */}
        {showOpeningHours && (
          <View style={styles.fieldSection}>
            <Text style={[styles.fieldLabel, { color: colors.textSecondary }]}>ÖFFNUNGSZEITEN</Text>
            <View style={[styles.hoursContainer, { backgroundColor: colors.surface }]}>
              {DAY_LABELS.map(({ key, label }, index) => (
                <View
                  key={key}
                  style={[
                    styles.hoursRow,
                    index < DAY_LABELS.length - 1 && styles.hoursRowBorder,
                    index < DAY_LABELS.length - 1 && { borderBottomColor: colors.borderSecondary },
                  ]}
                >
                  <View style={styles.hoursLeft}>
                    <Text style={[styles.dayLabel, { color: colors.textPrimary }]}>{label}</Text>
                    <Switch
                      value={!hours[key].closed}
                      onValueChange={() => toggleDayClosed(key)}
                      trackColor={{ false: colors.borderSecondary, true: `${colors.primary}60` }}
                      thumbColor={!hours[key].closed ? colors.primary : colors.textTertiary}
                      style={styles.daySwitch}
                    />
                  </View>
                  {!hours[key].closed ? (
                    <View style={styles.hoursRight}>
                      <TextInput
                        style={[styles.timeInput, { color: colors.textPrimary, backgroundColor: colors.background }]}
                        value={hours[key].open}
                        onChangeText={(v) => updateHour(key, 'open', v)}
                        placeholder="09:00"
                        placeholderTextColor={colors.textTertiary}
                        maxLength={5}
                      />
                      <Text style={[styles.timeSeparator, { color: colors.textTertiary }]}>–</Text>
                      <TextInput
                        style={[styles.timeInput, { color: colors.textPrimary, backgroundColor: colors.background }]}
                        value={hours[key].close}
                        onChangeText={(v) => updateHour(key, 'close', v)}
                        placeholder="17:00"
                        placeholderTextColor={colors.textTertiary}
                        maxLength={5}
                      />
                    </View>
                  ) : (
                    <Text style={[styles.closedText, { color: colors.textTertiary }]}>Geschlossen</Text>
                  )}
                </View>
              ))}
            </View>
          </View>
        )}

        <Pressable
          style={[styles.saveButton, { backgroundColor: colors.primary }, saving && { opacity: 0.6 }]}
          onPress={handleSave}
          disabled={saving}
        >
          {saving ? (
            <ActivityIndicator color={colors.onPrimary} />
          ) : (
            <Text style={[styles.saveButtonText, { color: colors.onPrimary }]}>Speichern</Text>
          )}
        </Pressable>

        <View style={styles.bottomPadding} />
      </KeyboardAwareScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
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
  content: { flex: 1 },
  coverSection: {
    paddingHorizontal: 16,
    paddingTop: 16,
  },
  coverPressable: {
    width: '100%',
    height: 176,
    borderRadius: 16,
    overflow: 'hidden',
  },
  coverImage: { width: '100%', height: 176, borderRadius: 16 },
  coverPlaceholder: {
    width: '100%',
    height: 176,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderStyle: 'dashed',
  },
  coverOverlay: {
    ...StyleSheet.absoluteFillObject,
    borderRadius: 16,
    backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  logoSection: {
    alignItems: 'center',
    marginTop: -48,
    paddingBottom: 8,
  },
  logoImage: {
    width: 96,
    height: 96,
    borderRadius: 48,
    borderWidth: 3,
    borderColor: '#ffffff',
  },
  logoPlaceholder: {
    width: 96,
    height: 96,
    borderRadius: 48,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderStyle: 'dashed',
  },
  logoOverlay: {
    ...StyleSheet.absoluteFillObject,
    borderRadius: 48,
    backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  placeholderIcon: { fontSize: 22 },
  placeholderText: { fontSize: 12, fontFamily: 'Inter-Regular', marginTop: 4 },
  changePhotoText: {
    fontSize: 14,
    fontFamily: 'Inter-Medium',
    marginTop: 12,
  },
  fieldSection: {
    paddingHorizontal: 16,
    paddingTop: 16,
  },
  fieldLabel: {
    fontSize: 13,
    fontFamily: 'Inter-Medium',
    marginBottom: 8,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  readOnlyPill: {
    alignSelf: 'flex-start',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 12,
  },
  readOnlyText: {
    fontSize: 14,
    fontFamily: 'Inter-Medium',
  },
  inputContainer: {
    borderRadius: 12,
    overflow: 'hidden',
  },
  input: {
    fontSize: 15,
    fontFamily: 'Inter-Regular',
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  textArea: {
    minHeight: 100,
  },
  fieldHint: {
    fontSize: 12,
    fontFamily: 'Inter-Regular',
    marginTop: 6,
  },
  hoursContainer: {
    borderRadius: 12,
    overflow: 'hidden',
  },
  hoursRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  hoursRowBorder: { borderBottomWidth: 1 },
  hoursLeft: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  dayLabel: {
    fontSize: 14,
    fontFamily: 'Inter-Medium',
    width: 100,
  },
  daySwitch: { transform: [{ scaleX: 0.8 }, { scaleY: 0.8 }] },
  hoursRight: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  timeInput: {
    width: 60,
    fontSize: 14,
    fontFamily: 'Inter-Regular',
    textAlign: 'center',
    paddingVertical: 6,
    paddingHorizontal: 8,
    borderRadius: 8,
  },
  timeSeparator: { fontSize: 14 },
  closedText: {
    fontSize: 14,
    fontFamily: 'Inter-Regular',
  },
  saveButton: {
    height: 48,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
    marginHorizontal: 16,
    marginTop: 32,
  },
  saveButtonText: {
    fontSize: 15,
    fontFamily: 'MonaSansSemiCondensed-Bold',
  },
  bottomPadding: {
    height: 40,
  },
});
