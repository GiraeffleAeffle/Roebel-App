import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { useTheme } from '@/context/ThemeContext';
import { useInstallPrompt } from '@/hooks/useInstallPrompt';

export default function InstallAppCard() {
  const { colors } = useTheme();
  const { canPrompt, isStandalone, isIosSafari, promptInstall } = useInstallPrompt();

  if (isStandalone || (!canPrompt && !isIosSafari)) return null;

  return (
    <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
      <Text style={[styles.title, { color: colors.textPrimary }]}>App installieren</Text>
      {canPrompt ? (
        <>
          <Text style={[styles.body, { color: colors.textSecondary }]}>
            Installiere die Röbel App auf deinem Startbildschirm — ohne App Store.
          </Text>
          <Pressable
            onPress={promptInstall}
            style={[styles.button, { backgroundColor: colors.primary }]}
            accessibilityRole="button"
          >
            <Text style={styles.buttonLabel}>Jetzt installieren</Text>
          </Pressable>
        </>
      ) : (
        <Text style={[styles.body, { color: colors.textSecondary }]}>
          Tippe in Safari auf das Teilen-Symbol und wähle „Zum Home-Bildschirm", um die Röbel App zu installieren.
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderWidth: 1, borderRadius: 12, padding: 16, marginHorizontal: 16, marginBottom: 16 },
  title: { fontFamily: 'MonaSans-SemiBold', fontSize: 16, marginBottom: 4 },
  body: { fontFamily: 'MonaSans-Regular', fontSize: 14, lineHeight: 20 },
  button: { marginTop: 12, borderRadius: 8, paddingVertical: 10, alignItems: 'center' },
  buttonLabel: { fontFamily: 'MonaSans-SemiBold', fontSize: 14, color: '#fff' },
});
