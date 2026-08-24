import React, { useState } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useSegments, useRouter } from 'expo-router';
import { TransitionStack } from '@/lib/navigation/TransitionStack';
import { CreateListingWizardProvider, useCreateListingWizard } from '@/context/CreateListingWizardContext';
import { useTheme } from '@/context/ThemeContext';
import ExitWizardSheet from '@/components/ExitWizardSheet';

const STEP_SCREENS = ['type', 'details', 'pricing', 'photos', 'location', 'review'];

function WizardHeader() {
  const { colors } = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const segments = useSegments();
  const lastSegment = segments[segments.length - 1] || '';
  const { dispatch } = useCreateListingWizard();
  const [showExit, setShowExit] = useState(false);

  if (!STEP_SCREENS.includes(lastSegment)) return null;

  return (
    <>
      <View style={[styles.header, { backgroundColor: colors.background, paddingTop: insets.top + 8 }]}>
        <Pressable onPress={() => setShowExit(true)} style={styles.cancelButton}>
          <Text style={[styles.cancelText, { color: colors.textSecondary }]}>Abbrechen</Text>
        </Pressable>
      </View>
      <ExitWizardSheet
        visible={showExit}
        onDelete={() => {
          dispatch({ type: 'RESET' });
          setShowExit(false);
          router.replace('/marketplace');
        }}
        onSaveAndExit={() => {
          setShowExit(false);
          router.replace('/marketplace');
        }}
        onCancel={() => setShowExit(false)}
      />
    </>
  );
}

export default function CreateListingLayout() {
  return (
    <CreateListingWizardProvider>
      <WizardHeader />
      <TransitionStack screenOptions={{ headerShown: false }}>
        <TransitionStack.Screen name="index" />
        <TransitionStack.Screen name="type" />
        <TransitionStack.Screen name="details" />
        <TransitionStack.Screen name="pricing" />
        <TransitionStack.Screen name="photos" />
        <TransitionStack.Screen name="location" />
        <TransitionStack.Screen name="review" />
        <TransitionStack.Screen name="success" />
      </TransitionStack>
    </CreateListingWizardProvider>
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
