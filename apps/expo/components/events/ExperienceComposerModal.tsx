import React, { useEffect, useRef, useState } from 'react';
import {
  Modal,
  View,
  Pressable,
  KeyboardAvoidingView,
  Platform,
  Keyboard,
  BackHandler,
  StyleSheet,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as ImagePicker from 'expo-image-picker';
import { useTheme } from '@/context/ThemeContext';
import ExperienceInput, { type ExperienceInputHandle } from './ExperienceInput';
import type { EventExperience } from '@/lib/types/feed';

type Props = {
  visible: boolean;
  eventId: string;
  walletAddress: string;
  onClose: () => void;
  onCreated: (created: EventExperience) => void;
  onError?: (message: string) => void;
};

export default function ExperienceComposerModal({
  visible,
  eventId,
  walletAddress,
  onClose,
  onCreated,
  onError,
}: Props) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const inputRef = useRef<ExperienceInputHandle>(null);
  // iOS cannot present the system photo picker over an open Modal. Hide the
  // Modal for the duration of the pick — its children stay mounted, so the
  // draft text survives — and restore it afterwards.
  const [pickerActive, setPickerActive] = useState(false);
  const pickImageOutsideModal = async (): Promise<ImagePicker.ImagePickerResult | null> => {
    setPickerActive(true);
    await new Promise((r) => setTimeout(r, 350));
    try {
      return await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.8 });
    } finally {
      setPickerActive(false);
    }
  };

  // Keyboard covers the home indicator while open, so only reserve the bottom
  // safe-area inset once it's dismissed and the dock rests on the screen edge.
  const [keyboardVisible, setKeyboardVisible] = useState(false);
  useEffect(() => {
    const showEvt = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvt = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';
    const showSub = Keyboard.addListener(showEvt, () => setKeyboardVisible(true));
    const hideSub = Keyboard.addListener(hideEvt, () => setKeyboardVisible(false));
    return () => {
      showSub.remove();
      hideSub.remove();
    };
  }, []);
  const dockPaddingBottom = keyboardVisible ? 8 : Math.max(8, insets.bottom);

  // Android: single hardware-back press should dismiss the overlay (and any
  // open keyboard) rather than the system's default "first hide keyboard,
  // then close modal on next press".
  useEffect(() => {
    if (!visible || Platform.OS !== 'android') return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      Keyboard.dismiss();
      onClose();
      return true;
    });
    return () => sub.remove();
  }, [visible, onClose]);

  const handleScrimPress = () => {
    Keyboard.dismiss();
    onClose();
  };

  const handleShow = () => {
    if (Platform.OS === 'ios') {
      inputRef.current?.focus();
    } else {
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  };

  return (
    <Modal
      visible={visible && !pickerActive}
      transparent
      animationType="none"
      statusBarTranslucent
      onShow={handleShow}
      onRequestClose={onClose}
    >
      <Pressable style={styles.scrim} onPress={handleScrimPress} />
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={styles.kbWrap}
        pointerEvents="box-none"
      >
        <View style={[styles.inputDock, { backgroundColor: colors.background, paddingBottom: dockPaddingBottom }]}>
          <ExperienceInput
            ref={inputRef}
            eventId={eventId}
            walletAddress={walletAddress}
            pickImage={pickImageOutsideModal}
            onError={onError}
            onCreated={(created) => {
              onCreated(created);
              onClose();
            }}
          />
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  scrim: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.15)',
  },
  kbWrap: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  inputDock: {
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
});
