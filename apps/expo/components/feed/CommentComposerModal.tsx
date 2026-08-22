import React, { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  Pressable,
  StyleSheet,
  Modal,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { useTheme } from '@/context/ThemeContext';
import StickerEmojiPicker from '@/components/pickers/StickerEmojiPicker';
import { uploadMediaFile } from '@/lib/upload-media';
import type { LootboxReward } from '@/lib/supabase-rewards';

import EmojiIcon from '@/assets/icons/emoji.svg';
import ImageIcon from '@/assets/icons/image-01.svg';

const MAX_COMMENT_LENGTH = 500;

type Props = {
  visible: boolean;
  onClose: () => void;
  onSubmit: (content: string, stickerRewardId: string | null, imageUrl: string | null) => Promise<void>;
  isSubmitting: boolean;
  /** Shared draft — the same state the floating bar edits. */
  value: string;
  onChangeText: (text: string) => void;
  /** Who the reply goes to — the post author, or the comment author on thread replies. */
  replyingToName?: string | null;
  avatarUrl?: string | null;
  avatarFallbackInitial?: string;
  walletAddress?: string;
};

/**
 * Full-screen comment composer, opened from the floating bar's expand
 * button. Shares its draft with the bar, so text survives switching
 * between the two.
 */
export default function CommentComposerModal({
  visible,
  onClose,
  onSubmit,
  isSubmitting,
  value,
  onChangeText,
  replyingToName,
  avatarUrl,
  avatarFallbackInitial,
  walletAddress,
}: Props) {
  const { colors } = useTheme();
  const [showPicker, setShowPicker] = useState(false);
  const [pendingSticker, setPendingSticker] = useState<LootboxReward | null>(null);
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [isUploading, setIsUploading] = useState(false);

  const canSubmit =
    (value.trim().length > 0 || !!pendingSticker || !!imageUrl) && !isSubmitting && !isUploading;

  const handleSubmit = async () => {
    if (!canSubmit) return;
    const content = value.trim();
    const stickerId = pendingSticker?.id ?? null;
    const submittedImage = imageUrl;
    onChangeText('');
    setPendingSticker(null);
    setImageUrl(null);
    setShowPicker(false);
    await onSubmit(content, stickerId, submittedImage);
    onClose();
  };

  const handlePickImage = async () => {
    if (!walletAddress) return;
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      quality: 0.8,
    });
    if (result.canceled || !result.assets[0]) return;

    setIsUploading(true);
    const asset = result.assets[0];
    const url = await uploadMediaFile(
      asset.uri,
      walletAddress,
      'image',
      'comments',
      asset.mimeType || undefined,
    );
    if (url) setImageUrl(url);
    setIsUploading(false);
  };

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          style={styles.flex}
        >
          {/* Header: close left, submit right */}
          <View style={styles.header}>
            <Pressable onPress={onClose} style={styles.closeButton} hitSlop={8} accessibilityLabel="Schließen">
              <Ionicons name="close" size={26} color={colors.textPrimary} />
            </Pressable>
            <Pressable
              onPress={handleSubmit}
              disabled={!canSubmit}
              style={[
                styles.submitButton,
                { backgroundColor: canSubmit ? colors.primary : colors.disabled },
              ]}
            >
              {isSubmitting ? (
                <ActivityIndicator size="small" color={colors.onPrimary} />
              ) : (
                <Text
                  style={[
                    styles.submitLabel,
                    { color: canSubmit ? colors.onPrimary : colors.disabledText },
                  ]}
                >
                  Antworten
                </Text>
              )}
            </Pressable>
          </View>

          {replyingToName ? (
            <Text style={[styles.replyingTo, { color: colors.textTertiary }]}>
              Antwort an <Text style={{ color: colors.primary }}>{replyingToName}</Text>
            </Text>
          ) : null}

          {/* Big input row */}
          <View style={styles.inputRow}>
            <View style={[styles.avatar, { backgroundColor: colors.surfaceSecondary }]}>
              {avatarUrl ? (
                <Image source={{ uri: avatarUrl }} style={styles.avatarImg} contentFit="cover" />
              ) : (
                <Text style={[styles.avatarInitial, { color: colors.textSecondary }]}>
                  {avatarFallbackInitial ?? '?'}
                </Text>
              )}
            </View>
            <TextInput
              style={[styles.input, { color: colors.textPrimary }]}
              placeholder="Antwort schreiben..."
              placeholderTextColor={colors.textTertiary}
              value={value}
              onChangeText={onChangeText}
              maxLength={MAX_COMMENT_LENGTH}
              multiline
              autoFocus
            />
          </View>

          {/* Attachment previews */}
          {pendingSticker && (
            <View style={[styles.chip, { backgroundColor: colors.surfaceSecondary }]}>
              <Image
                source={{ uri: pendingSticker.asset_url }}
                style={styles.stickerImage}
                contentFit="contain"
              />
              <Pressable onPress={() => setPendingSticker(null)} hitSlop={8}>
                <Ionicons name="close-circle" size={22} color={colors.textTertiary} />
              </Pressable>
            </View>
          )}
          {imageUrl && (
            <View style={[styles.chip, { backgroundColor: colors.surfaceSecondary }]}>
              <Image source={{ uri: imageUrl }} style={styles.previewImage} contentFit="cover" />
              <Pressable onPress={() => setImageUrl(null)} hitSlop={8}>
                <Ionicons name="close-circle" size={22} color={colors.textTertiary} />
              </Pressable>
            </View>
          )}

          {showPicker && (
            <StickerEmojiPicker
              onPickEmoji={(emoji) => {
                onChangeText(value + emoji);
                setShowPicker(false);
              }}
              onPickSticker={(reward) => {
                setPendingSticker(reward);
                setShowPicker(false);
              }}
              onClose={() => setShowPicker(false)}
            />
          )}

          {/* Toolbar pinned above the keyboard */}
          <View style={[styles.toolbar, { borderTopColor: colors.border }]}>
            {walletAddress && (
              <Pressable
                onPress={handlePickImage}
                style={styles.toolButton}
                hitSlop={6}
                accessibilityLabel="Bild anhängen"
              >
                {isUploading ? (
                  <ActivityIndicator size="small" color={colors.textSecondary} />
                ) : (
                  <ImageIcon width={22} height={22} color={colors.textSecondary} />
                )}
              </Pressable>
            )}
            <Pressable
              onPress={() => setShowPicker((p) => !p)}
              style={styles.toolButton}
              hitSlop={6}
              accessibilityLabel="Emoji oder Sticker öffnen"
            >
              <EmojiIcon width={22} height={22} color={colors.textSecondary} />
            </Pressable>
            <View style={styles.flex} />
            <Text style={[styles.counter, { color: colors.textTertiary }]}>
              {value.length}/{MAX_COMMENT_LENGTH}
            </Text>
          </View>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  flex: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  closeButton: {
    width: 40,
    height: 40,
    justifyContent: 'center',
    alignItems: 'flex-start',
  },
  submitButton: {
    paddingHorizontal: 18,
    height: 36,
    borderRadius: 18,
    justifyContent: 'center',
    alignItems: 'center',
  },
  submitLabel: {
    fontSize: 14,
    fontFamily: 'Inter-SemiBold',
  },
  replyingTo: {
    fontSize: 13,
    fontFamily: 'Inter-Regular',
    paddingHorizontal: 16,
    paddingBottom: 8,
    marginLeft: 52,
  },
  inputRow: {
    flex: 1,
    flexDirection: 'row',
    paddingHorizontal: 16,
    gap: 12,
  },
  avatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
    overflow: 'hidden',
    justifyContent: 'center',
    alignItems: 'center',
  },
  avatarImg: {
    ...StyleSheet.absoluteFillObject,
    borderRadius: 18,
  },
  avatarInitial: {
    fontSize: 14,
    fontFamily: 'Inter-SemiBold',
  },
  input: {
    flex: 1,
    fontSize: 17,
    fontFamily: 'Inter-Regular',
    lineHeight: 24,
    textAlignVertical: 'top',
    paddingTop: 6,
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    marginHorizontal: 16,
    marginBottom: 8,
    borderRadius: 12,
    padding: 6,
    gap: 6,
  },
  stickerImage: {
    width: 48,
    height: 48,
  },
  previewImage: {
    width: 56,
    height: 56,
    borderRadius: 8,
  },
  toolbar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
    gap: 4,
  },
  toolButton: {
    width: 40,
    height: 40,
    justifyContent: 'center',
    alignItems: 'center',
  },
  counter: {
    fontSize: 12,
    fontFamily: 'Inter-Regular',
    paddingRight: 6,
  },
});
