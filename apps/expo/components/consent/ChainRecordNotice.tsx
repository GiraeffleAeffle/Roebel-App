/**
 * Pre-mint disclosure for the Citizen verification (Art. 13/14 DSGVO).
 *
 * A successful verification mints a soulbound NFT on the public Gnosis chain —
 * a record that cannot technically be deleted. Consent to that (Art. 6(1)(a))
 * is only informed if the person read this BEFORE submitting the request, so
 * this block renders, unavoidable and un-collapsed, at every place a citizen
 * request can be fired: the manual form and the welcome wizard's auto-submit.
 * There is deliberately no extra dialog — the ONE consent moment stays the
 * submit/accept button, this makes it informed (same philosophy as the
 * public-record consent, see lib/nostr/enroll.ts).
 *
 * The durable proof of consent is the wallet-initiated request itself,
 * submitted from a screen that structurally cannot be reached without this
 * notice (DSGVO_AI_ACT_COMPLIANCE.md §2.2).
 */
import React from 'react';
import { View, Text, StyleSheet, Pressable, Linking } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '@/context/ThemeContext';

const DATENSCHUTZ_URL = 'https://www.roebel.app/datenschutz';

const POINTS = [
  'Mit der Verifizierung entsteht ein dauerhafter, pseudonymer Eintrag auf einer öffentlichen Blockchain. Er zeigt nur eine Wallet-Adresse — nie Name, Adresse oder Geburtsdatum — kann aber technisch nicht gelöscht werden.',
  'Beim Löschen des Kontos entfernen wir alles, was die Wallet mit der Person verbindet. Der Blockchain-Eintrag ist danach niemandem mehr zuordenbar.',
  'Den Antrag bestätigen andere verifizierte Bürger:innen mit ihrer Unterschrift — sie sehen dafür die Antragsdaten.',
];

export default function ChainRecordNotice() {
  const { colors } = useTheme();

  return (
    <View style={[styles.card, { backgroundColor: colors.surface }]}>
      <View style={styles.headerRow}>
        <Ionicons name="cube-outline" size={18} color={colors.textPrimary} />
        <Text style={[styles.title, { color: colors.textPrimary }]}>
          Gut zu wissen: der Blockchain-Eintrag
        </Text>
      </View>
      {POINTS.map((point, i) => (
        <View key={i} style={styles.pointRow}>
          <Text style={[styles.bullet, { color: colors.textSecondary }]}>{'•'}</Text>
          <Text style={[styles.pointText, { color: colors.textSecondary }]}>{point}</Text>
        </View>
      ))}
      <Pressable
        onPress={() => Linking.openURL(DATENSCHUTZ_URL).catch(() => {})}
        accessibilityRole="link"
        hitSlop={8}
      >
        <Text style={[styles.link, { color: colors.primary }]}>
          Mehr dazu in der Datenschutzerklärung
        </Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: 16,
    padding: 16,
    gap: 10,
    marginTop: 8,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  title: {
    fontSize: 14,
    fontFamily: 'Inter-Medium',
    flex: 1,
  },
  pointRow: {
    flexDirection: 'row',
    gap: 8,
    paddingRight: 4,
  },
  bullet: {
    fontSize: 13,
    lineHeight: 19,
  },
  pointText: {
    flex: 1,
    fontSize: 13,
    fontFamily: 'Inter-Regular',
    lineHeight: 19,
  },
  link: {
    fontSize: 13,
    fontFamily: 'Inter-Medium',
    textDecorationLine: 'underline',
  },
});
