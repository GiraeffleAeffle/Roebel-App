import React, { useState } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useSegments, useRouter } from 'expo-router';
import { TransitionStack } from '@/lib/navigation/TransitionStack';
import {
  PartnerRegisterWizardProvider,
  usePartnerRegisterWizard,
} from '@/context/PartnerRegisterWizardContext';
import { useTheme } from '@/context/ThemeContext';
import ExitWizardSheet from '@/components/ExitWizardSheet';

const STEP_SCREENS = ['business', 'info', 'bank', 'agreement', 'review'];

function WizardHeader() {
  const { colors } = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const segments = useSegments();
  const lastSegment = segments[segments.length - 1] || '';
  const { dispatch } = usePartnerRegisterWizard();
  const [showExit, setShowExit] = useState(false);

  // Only show the Abbrechen header on real wizard steps, not on intro or success.
  if (!STEP_SCREENS.includes(lastSegment)) return null;

  return (
    <>
      <View
        style={[
          styles.header,
          { backgroundColor: colors.background, paddingTop: insets.top + 8 },
        ]}
      >
        <Pressable onPress={() => setShowExit(true)} style={styles.cancelButton}>
          <Text style={[styles.cancelText, { color: colors.textSecondary }]}>Abbrechen</Text>
        </Pressable>
      </View>
      <ExitWizardSheet
        visible={showExit}
        onDelete={() => {
          dispatch({ type: 'RESET' });
          setShowExit(false);
          router.replace('/roebel-card' as any);
        }}
        onSaveAndExit={() => {
          setShowExit(false);
          router.replace('/roebel-card' as any);
        }}
        onCancel={() => setShowExit(false)}
      />
    </>
  );
}

export default function PartnerRegisterLayout() {
  return (
    <PartnerRegisterWizardProvider>
      <WizardHeader />
      <TransitionStack screenOptions={{ headerShown: false }}>
        <TransitionStack.Screen name="index" />
        <TransitionStack.Screen name="business" />
        <TransitionStack.Screen name="info" />
        <TransitionStack.Screen name="bank" />
        <TransitionStack.Screen name="agreement" />
        <TransitionStack.Screen name="review" />
        <TransitionStack.Screen name="success" />
      </TransitionStack>
    </PartnerRegisterWizardProvider>
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
