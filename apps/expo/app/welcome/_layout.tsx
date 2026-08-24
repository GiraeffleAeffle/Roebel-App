import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useSegments } from 'expo-router';
import { TransitionStack } from '@/lib/navigation/TransitionStack';
import { WelcomeWizardProvider, useWelcomeWizard } from '@/context/WelcomeWizardContext';
import { useTheme } from '@/context/ThemeContext';

const STEP_SCREENS = ['name', 'role', 'citizen-data', 'consent'];

function WizardHeader() {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const segments = useSegments();
  const lastSegment = segments[segments.length - 1] || '';
  const { openExit } = useWelcomeWizard();

  if (!STEP_SCREENS.includes(lastSegment)) return null;

  return (
    <View style={[styles.header, { backgroundColor: colors.background, paddingTop: insets.top + 8 }]}>
      <Pressable onPress={openExit} style={styles.cancelButton}>
        <Text style={[styles.cancelText, { color: colors.textSecondary }]}>Abbrechen</Text>
      </Pressable>
    </View>
  );
}

export default function WelcomeLayout() {
  return (
    <WelcomeWizardProvider>
      <WizardHeader />
      <TransitionStack screenOptions={{ headerShown: false }}>
        <TransitionStack.Screen name="index" />
        <TransitionStack.Screen name="name" />
        <TransitionStack.Screen name="role" />
        <TransitionStack.Screen name="citizen-data" />
        <TransitionStack.Screen name="consent" />
      </TransitionStack>
    </WelcomeWizardProvider>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    justifyContent: 'flex-start',
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  cancelButton: {
    paddingVertical: 8,
    paddingHorizontal: 8,
  },
  cancelText: {
    fontSize: 15,
    fontFamily: 'Inter-Medium',
  },
});
