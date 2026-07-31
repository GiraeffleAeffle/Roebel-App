import React, { useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  TextInput,
  ActivityIndicator,
  Alert,
  Switch,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { KeyboardAwareScrollView } from 'react-native-keyboard-aware-scroll-view';
import { Stack, useRouter } from 'expo-router';
import { useActiveAccount } from 'thirdweb/react';
import { useTheme } from '@/context/ThemeContext';
import { useAccount } from '@/context/AccountContext';
import { useUser } from '@/context/UserContext';
import { updateAccount } from '@/lib/supabase-accounts';
import { fetchMembersWithProfiles } from '@/lib/supabase-member-management';
import type { OpeningHours } from '@/lib/types';
import ChevronLeftIcon from '@/assets/icons/chevron-left.svg';

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

export default function OrgOpeningHoursScreen() {
  const router = useRouter();
  const { colors } = useTheme();
  const { activeAccount, refreshAccounts } = useAccount();
  const { user } = useUser();
  const account = useActiveAccount();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [hours, setHours] = useState<OpeningHoursState>(DEFAULT_HOURS);
  const [canEdit, setCanEdit] = useState(false);

  useEffect(() => {
    if (!activeAccount || activeAccount.account_type !== 'organisation') {
      router.replace('/profile');
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        setLoading(true);
        const members = await fetchMembersWithProfiles(activeAccount.id);
        const myWallet = user?.wallet_address?.toLowerCase() ?? null;
        const myRole = myWallet
          ? members.find((m) => m.wallet_address.toLowerCase() === myWallet)?.role ?? null
          : null;
        const allowed = myRole === 'owner' || myRole === 'admin';
        if (cancelled) return;
        setCanEdit(allowed);
        if (!allowed) {
          Alert.alert(
            'Keine Berechtigung',
            'Nur Inhaber oder Admins können die Öffnungszeiten bearbeiten.'
          );
          router.back();
          return;
        }

        const current = activeAccount.opening_hours ?? null;
        if (current) {
          const state: OpeningHoursState = { ...DEFAULT_HOURS };
          for (const day of DAY_LABELS) {
            const d = (current as OpeningHours)[day.key];
            if (d) {
              state[day.key] = { open: d.open || '', close: d.close || '', closed: !!d.closed };
            }
          }
          setHours(state);
        }
      } catch (err) {
        console.error('Failed to load opening hours:', err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [activeAccount, user?.wallet_address]);

  const updateHour = (day: DayOfWeek, field: 'open' | 'close', value: string) => {
    setHours((prev) => ({ ...prev, [day]: { ...prev[day], [field]: value } }));
  };

  const toggleDayClosed = (day: DayOfWeek) => {
    setHours((prev) => ({ ...prev, [day]: { ...prev[day], closed: !prev[day].closed } }));
  };

  const subtitle = useMemo(() => activeAccount?.name ?? null, [activeAccount?.name]);

  const handleSave = async () => {
    if (!activeAccount || !canEdit) return;
    if (!account) {
      Alert.alert('Fehler', 'Keine Wallet verbunden.');
      return;
    }
    setSaving(true);
    try {
      const payload: OpeningHours = {};
      for (const day of DAY_LABELS) {
        const h = hours[day.key];
        payload[day.key] = { open: h.open, close: h.close, closed: h.closed };
      }
      await updateAccount(account, activeAccount.id, { opening_hours: payload });
      await refreshAccounts();
      router.back();
    } catch (err: any) {
      console.error('Failed to save opening hours:', err);
      Alert.alert('Fehler', err?.message || 'Öffnungszeiten konnten nicht gespeichert werden.');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
        <Stack.Screen options={{ headerShown: false }} />
        <View style={[styles.header, { borderBottomColor: colors.border }]}>
          <Pressable onPress={() => router.back()} style={styles.backButton} hitSlop={8}>
            <ChevronLeftIcon width={24} height={24} color={colors.textPrimary} />
          </Pressable>
          <Text style={[styles.headerTitle, { color: colors.textPrimary }]}>Öffnungszeiten</Text>
          <View style={styles.backButton} />
        </View>
        <View style={styles.center}>
          <ActivityIndicator color={colors.primary} />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={[styles.header, { borderBottomColor: colors.border }]}>
        <Pressable onPress={() => router.back()} style={styles.backButton} hitSlop={8}>
          <ChevronLeftIcon width={24} height={24} color={colors.textPrimary} />
        </Pressable>
        <Text style={[styles.headerTitle, { color: colors.textPrimary }]}>Öffnungszeiten</Text>
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
        {subtitle ? (
          <Text style={[styles.subtitle, { color: colors.textSecondary }]}>{subtitle}</Text>
        ) : null}

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
                    style={[
                      styles.timeInput,
                      { color: colors.textPrimary, backgroundColor: colors.background },
                    ]}
                    value={hours[key].open}
                    onChangeText={(v) => updateHour(key, 'open', v)}
                    placeholder="09:00"
                    placeholderTextColor={colors.textTertiary}
                    maxLength={5}
                  />
                  <Text style={[styles.timeSeparator, { color: colors.textTertiary }]}>–</Text>
                  <TextInput
                    style={[
                      styles.timeInput,
                      { color: colors.textPrimary, backgroundColor: colors.background },
                    ]}
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

        <Pressable
          style={[styles.saveButton, { backgroundColor: colors.primary }, saving && { opacity: 0.6 }]}
          onPress={handleSave}
          disabled={saving}
        >
          {saving ? (
            <ActivityIndicator color="#ffffff" />
          ) : (
            <Text style={styles.saveButtonText}>Speichern</Text>
          )}
        </Pressable>

        <View style={{ height: 40 }} />
      </KeyboardAwareScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
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
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  subtitle: {
    fontSize: 14,
    fontFamily: 'Inter-Medium',
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 8,
  },
  hoursContainer: {
    marginTop: 12,
    marginHorizontal: 16,
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
    marginTop: 24,
  },
  saveButtonText: {
    fontSize: 15,
    fontFamily: 'MonaSansSemiCondensed-Bold',
    color: '#ffffff',
  },
  emptyWrap: {
    paddingHorizontal: 24,
    paddingTop: 48,
    gap: 8,
  },
  emptyTitle: {
    fontSize: 18,
    fontFamily: 'Inter-SemiBold',
  },
  emptyBody: {
    fontSize: 14,
    fontFamily: 'Inter-Regular',
    lineHeight: 20,
  },
});
