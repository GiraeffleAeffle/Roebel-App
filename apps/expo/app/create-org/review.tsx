import React, { useState } from 'react';
import { View, Text, Pressable, ScrollView, Alert, ActivityIndicator, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import { useActiveAccount } from 'thirdweb/react';
import { useTheme } from '@/context/ThemeContext';
import { useCreateOrgWizard } from '@/context/CreateOrgWizardContext';
import { useAccount } from '@/context/AccountContext';
import { createBusiness } from '@/lib/supabase-businesses';
import { updateAccount } from '@/lib/supabase-accounts';
import { createRestaurant } from '@/lib/supabase-restaurants';
import type { OrgSubType } from '@/lib/types';
import WizardFooter from '@/components/WizardFooter';
import StoryProgress from '@/components/StoryProgress';

const ORG_TYPE_LABELS: Record<string, { emoji: string; label: string }> = {
  restaurant: { emoji: '🍽️', label: 'Restaurant' },
  unternehmen: { emoji: '🏪', label: 'Unternehmen' },
  verein: { emoji: '🤝', label: 'Verein' },
  stadt: { emoji: '🏛️', label: 'Stadt' },
  fraktion: { emoji: '⚖️', label: 'Fraktion' },
  journalist: { emoji: '📝', label: 'Journalist:in' },
};

const CATEGORY_LABELS: Record<string, string> = {
  gastronomie: 'Gastronomie', einzelhandel: 'Einzelhandel', handwerk: 'Handwerk',
  dienstleistung: 'Dienstleistung', gesundheit: 'Gesundheit', bildung: 'Bildung',
  kultur: 'Kultur', sport: 'Sport', tourismus: 'Tourismus', immobilien: 'Immobilien',
  sonstiges: 'Sonstiges',
};

export default function CreateOrgReviewScreen() {
  const router = useRouter();
  const { colors } = useTheme();
  const { state, dispatch } = useCreateOrgWizard();
  const { createOrgAccount } = useAccount();
  const account = useActiveAccount();
  const [isSubmitting, setIsSubmitting] = useState(false);

  const orgInfo = state.orgType ? ORG_TYPE_LABELS[state.orgType] : null;

  const handleSubmit = async () => {
    if (!account?.address || !state.orgType || !state.name.trim()) {
      Alert.alert('Fehler', 'Bitte fülle alle Pflichtfelder aus.');
      return;
    }

    setIsSubmitting(true);
    dispatch({ type: 'SET_SUBMITTING', payload: true });

    try {
      // 1. Create account with sub_type (+ extern flag if applicable)
      const orgAccount = await createOrgAccount(
        state.orgType as OrgSubType,
        state.name.trim(),
        {
          isExtern: state.isExtern,
          contactEmail: state.isExtern ? state.contactEmail.trim() || null : null,
          reason: state.isExtern ? state.externReason.trim() || null : null,
          bio: state.description.trim() || null,
        }
      );

      // 2. Store images + opening hours on the account itself
      const accountUpdates: Parameters<typeof updateAccount>[2] = {};
      if (state.logoUrl || state.coverImageUrl) {
        accountUpdates.avatar_url = state.logoUrl || null;
        accountUpdates.cover_url = state.coverImageUrl || null;
      }
      if (state.openingHours) {
        accountUpdates.opening_hours = state.openingHours;
      }
      if (Object.keys(accountUpdates).length > 0) {
        await updateAccount(account, orgAccount.id, accountUpdates);
      }

      // 3. Store new account ID for success screen
      dispatch({ type: 'SET_NEW_ACCOUNT_ID', payload: orgAccount.id });

      // 4. Create business + restaurant records only for storefront-shaped orgs
      const needsBusinessRecord =
        state.orgType === 'restaurant' || state.orgType === 'unternehmen';

      if (needsBusinessRecord) {
        await createBusiness({
          owner_wallet_address: account.address,
          name: state.name.trim(),
          category: state.category || 'sonstiges',
          description: state.description.trim() || undefined,
          phone: state.phone.trim() || undefined,
          email: state.email.trim() || undefined,
          website_url: state.website.trim() || undefined,
          address: state.formattedAddress || state.address.trim() || undefined,
          logo_url: state.logoUrl || undefined,
          cover_image_url: state.coverImageUrl || undefined,
        });

        if (state.orgType === 'restaurant') {
          await createRestaurant({
            name: state.name.trim(),
            account_id: orgAccount.id,
            description: state.description.trim() || null,
            logo_url: state.logoUrl || null,
            cover_image_url: state.coverImageUrl || null,
            address: state.formattedAddress || state.address.trim() || null,
            phone: state.phone.trim() || null,
            website_url: state.website.trim() || null,
            latitude: state.latitude,
            longitude: state.longitude,
          });
        }
      }

      // 5. Navigate to success
      router.replace('/create-org/success');
    } catch (error: any) {
      console.error('Org creation error:', error);
      Alert.alert('Fehler', error?.message || 'Organisation konnte nicht erstellt werden.');
    } finally {
      setIsSubmitting(false);
      dispatch({ type: 'SET_SUBMITTING', payload: false });
    }
  };

  return (
    <SafeAreaView edges={['bottom']} style={[styles.safeArea, { backgroundColor: colors.background }]}>
      <ScrollView style={styles.scrollView} showsVerticalScrollIndicator={false}>
        <StoryProgress step={6} totalSteps={6} />
        <Text style={[styles.title, { color: colors.textPrimary }]}>Alles richtig?</Text>
        <Text style={[styles.subtitle, { color: colors.textSecondary }]}>
          Prüfe deine Angaben bevor du den Antrag einreichst.
        </Text>

        {/* Type */}
        <SectionCard title="Typ" onEdit={() => router.push('/create-org/type')} colors={colors}>
          <View style={styles.typeRow}>
            <Text style={styles.typeEmoji}>{orgInfo?.emoji}</Text>
            <Text style={[styles.typeLabel, { color: colors.textPrimary }]}>{orgInfo?.label}</Text>
          </View>
        </SectionCard>

        {/* Info */}
        <SectionCard title="Informationen" onEdit={() => router.push('/create-org/info')} colors={colors}>
          <Text style={[styles.infoName, { color: colors.textPrimary }]}>{state.name || '—'}</Text>
          {state.description ? (
            <Text style={[styles.infoDescription, { color: colors.textSecondary }]}>{state.description}</Text>
          ) : null}
          {state.category ? (
            <Text style={[styles.infoCategory, { color: colors.textTertiary }]}>
              Kategorie: {CATEGORY_LABELS[state.category] || state.category}
            </Text>
          ) : null}
        </SectionCard>

        {/* Location */}
        <SectionCard title="Adresse" onEdit={() => router.push('/create-org/location')} colors={colors}>
          <Text style={[styles.infoDescription, { color: colors.textPrimary }]}>
            {state.formattedAddress || state.address || 'Keine Adresse angegeben'}
          </Text>
        </SectionCard>

        {/* Contact */}
        <SectionCard title="Kontakt" onEdit={() => router.push('/create-org/contact')} colors={colors}>
          {state.phone ? <Text style={[styles.infoDescription, { color: colors.textPrimary }]}>Tel: {state.phone}</Text> : null}
          {state.email ? <Text style={[styles.infoDescription, { color: colors.textPrimary }]}>E-Mail: {state.email}</Text> : null}
          {state.website ? <Text style={[styles.infoDescription, { color: colors.textPrimary }]}>Web: {state.website}</Text> : null}
          {!state.phone && !state.email && !state.website && (
            <Text style={[styles.infoDescription, { color: colors.textTertiary }]}>Keine Kontaktdaten</Text>
          )}
          {state.openingHours && (
            <Text style={[styles.infoCategory, { color: colors.textTertiary }]}>Öffnungszeiten angegeben</Text>
          )}
        </SectionCard>

        {/* Photos */}
        <SectionCard title="Fotos" onEdit={() => router.push('/create-org/photos')} colors={colors}>
          <View style={styles.photosRow}>
            {state.logoUrl ? (
              <Image source={{ uri: state.logoUrl }} style={styles.photoLogo} contentFit="cover" />
            ) : (
              <View style={[styles.photoLogo, styles.photoPlaceholder, { backgroundColor: colors.border }]}>
                <Text style={[styles.infoCategory, { color: colors.textTertiary }]}>Logo</Text>
              </View>
            )}
            {state.coverImageUrl ? (
              <Image source={{ uri: state.coverImageUrl }} style={styles.photoCover} contentFit="cover" />
            ) : (
              <View style={[styles.photoCover, styles.photoPlaceholder, { backgroundColor: colors.border }]}>
                <Text style={[styles.infoCategory, { color: colors.textTertiary }]}>Titelbild</Text>
              </View>
            )}
          </View>
        </SectionCard>

        <View style={styles.bottomSpacer} />
      </ScrollView>

      <WizardFooter
        onBack={() => router.back()}
        onNext={handleSubmit}
        nextLabel="Antrag einreichen"
        nextDisabled={isSubmitting}
        nextContent={isSubmitting ? <ActivityIndicator color={colors.onPrimary} /> : undefined}
      />
    </SafeAreaView>
  );
}

function SectionCard({
  title,
  children,
  onEdit,
  colors,
}: {
  title: string;
  children: React.ReactNode;
  onEdit: () => void;
  colors: ReturnType<typeof useTheme>['colors'];
}) {
  return (
    <View style={[styles.sectionCard, { backgroundColor: colors.surface }]}>
      <View style={styles.sectionCardHeader}>
        <Text style={[styles.sectionCardTitle, { color: colors.textSecondary }]}>{title}</Text>
        <Pressable onPress={onEdit}>
          <Text style={[styles.sectionCardEdit, { color: colors.primary }]}>Bearbeiten</Text>
        </Pressable>
      </View>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1 },
  scrollView: { flex: 1, paddingHorizontal: 24, paddingTop: 24 },
  title: { fontSize: 26, fontFamily: 'Inter-Bold', marginBottom: 8 },
  subtitle: { fontSize: 15, fontFamily: 'Inter-Regular', marginBottom: 32 },
  sectionCard: {
    borderRadius: 16,
    padding: 16,
    marginBottom: 12,
  },
  sectionCardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  sectionCardTitle: {
    fontSize: 12,
    fontFamily: 'Inter-Medium',
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  sectionCardEdit: { fontSize: 13, fontFamily: 'Inter-Medium' },
  typeRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  typeEmoji: { fontSize: 20 },
  typeLabel: { fontSize: 14, fontFamily: 'Inter-Medium' },
  infoName: { fontSize: 14, fontFamily: 'Inter-Medium' },
  infoDescription: { fontSize: 13, fontFamily: 'Inter-Regular', marginTop: 4 },
  infoCategory: { fontSize: 12, fontFamily: 'Inter-Regular', marginTop: 8 },
  photosRow: { flexDirection: 'row', gap: 16 },
  photoLogo: { width: 64, height: 64, borderRadius: 9999 },
  photoCover: { flex: 1, height: 64, borderRadius: 16 },
  photoPlaceholder: { alignItems: 'center', justifyContent: 'center' },
  bottomSpacer: { height: 96 },
});
