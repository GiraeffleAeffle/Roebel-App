import React, { useState, useEffect, useRef } from 'react';
import { View, Text, TextInput, Pressable, StyleSheet, ActivityIndicator } from 'react-native';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { useTheme } from '@/context/ThemeContext';
import GlassSurface, { glassEdgeColor } from '@/components/GlassSurface';
import StickerEmojiPicker from '@/components/pickers/StickerEmojiPicker';
import { uploadMediaFile } from '@/lib/upload-media';
import type { LootboxReward } from '@/lib/supabase-rewards';

import SendIcon from '@/assets/icons/sent.svg';
import EmojiIcon from '@/assets/icons/emoji.svg';
import ImageIcon from '@/assets/icons/image-01.svg';

const MAX_COMMENT_LENGTH = 500;
// Grow with content from one line up to this height, then scroll inside.
const INPUT_MIN_HEIGHT = 20;
const INPUT_MAX_HEIGHT = 100;

type Props = {
  onSubmit: (content: string, stickerRewardId: string | null, imageUrl: string | null) => Promise<void>;
  isSubmitting: boolean;
  /** Controlled draft text — lives in the screen so the expand modal can share it. */
  value: string;
  onChangeText: (text: string) => void;
  onCancel?: () => void;
  onFocusChange?: (focused: boolean) => void;
  walletAddress?: string;
  /** When set, the input is composing a reply to this person (shows a chip). */
  replyingToName?: string | null;
  onCancelReply?: () => void;
  /** Avatar of the active profile, shown at the left of the pill. */
  avatarUrl?: string | null;
  avatarFallbackInitial?: string;
  /** Opens the full-screen composer, carrying the current draft along. */
  onExpand?: () => void;
};

export default function CommentInput({
  onSubmit,
  isSubmitting,
  value,
  onChangeText,
  onCancel,
  onFocusChange,
  walletAddress,
  replyingToName,
  onCancelReply,
  avatarUrl,
  avatarFallbackInitial,
  onExpand,
}: Props) {
  const { colors, isDark } = useTheme();
  const inputRef = useRef<TextInput>(null);
  const [showPicker, setShowPicker] = useState(false);
  const [pendingSticker, setPendingSticker] = useState<LootboxReward | null>(null);
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [isFocused, setIsFocused] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [contentHeight, setContentHeight] = useState(0);

  // Focus the field when a reply is started.
  useEffect(() => {
    if (replyingToName) {
      inputRef.current?.focus();
    }
  }, [replyingToName]);

  const inputHeight = Math.min(Math.max(INPUT_MIN_HEIGHT, contentHeight), INPUT_MAX_HEIGHT);

  const canSubmit =
    (value.trim().length > 0 || !!pendingSticker || !!imageUrl) && !isSubmitting && !isUploading;

  const handleSubmit = async () => {
    if (!canSubmit) return;
    const content = value.trim();
    const stickerId = pendingSticker?.id ?? null;
    const submittedImage = imageUrl;
    onChangeText('');
    setContentHeight(0);
    setPendingSticker(null);
    setImageUrl(null);
    setShowPicker(false);
    await onSubmit(content, stickerId, submittedImage);
  };

  const handleFocus = () => {
    setIsFocused(true);
    onFocusChange?.(true);
  };

  const handleBlur = () => {
    setIsFocused(false);
    onFocusChange?.(false);
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

  const isEditMode = !!onCancel;
  const engaged = isFocused || value.length > 0 || !!pendingSticker || !!imageUrl;
  const showImageIcon = (engaged || !!imageUrl) && !isEditMode && !!walletAddress;
  const placeholder = isEditMode
    ? 'Kommentar bearbeiten...'
    : replyingToName
      ? `Antwort an ${replyingToName}...`
      : 'Antwort schreiben...';

  return (
    <View>
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
      {replyingToName && (
        <View style={[styles.replyChip, { backgroundColor: colors.surfaceSecondary }]}>
          <Text style={[styles.replyChipText, { color: colors.textSecondary }]} numberOfLines={1}>
            Antwort an <Text style={{ color: colors.textPrimary }}>{replyingToName}</Text>
          </Text>
          <Pressable onPress={onCancelReply} hitSlop={8}>
            <Ionicons name="close-circle" size={18} color={colors.textTertiary} />
          </Pressable>
        </View>
      )}
      {pendingSticker && (
        <View style={[styles.stickerChip, { backgroundColor: colors.surfaceSecondary }]}>
          <Image
            source={{ uri: pendingSticker.asset_url }}
            style={styles.stickerChipImage}
            contentFit="contain"
          />
          <Pressable onPress={() => setPendingSticker(null)} hitSlop={8}>
            <Ionicons name="close-circle" size={22} color={colors.textTertiary} />
          </Pressable>
        </View>
      )}
      {imageUrl && (
        <View style={[styles.stickerChip, { backgroundColor: colors.surfaceSecondary }]}>
          <Image source={{ uri: imageUrl }} style={styles.previewImage} contentFit="cover" />
          <Pressable onPress={() => setImageUrl(null)} hitSlop={8}>
            <Ionicons name="close-circle" size={22} color={colors.textTertiary} />
          </Pressable>
        </View>
      )}

      {/* Floating fully-rounded pill. Glass background, hairline border,
          content scrolls beneath it in the screen. */}
      <View style={[styles.pill, { borderColor: glassEdgeColor(isDark) }]}>
        <GlassSurface />
        <View style={styles.pillRow}>
          {isEditMode ? (
            <Pressable onPress={onCancel} style={styles.cancelButton} hitSlop={8}>
              <Ionicons name="close" size={20} color={colors.textTertiary} />
            </Pressable>
          ) : (
            <View style={[styles.avatar, { backgroundColor: colors.surfaceSecondary }]}>
              {avatarUrl ? (
                <Image source={{ uri: avatarUrl }} style={styles.avatarImg} contentFit="cover" />
              ) : (
                <Text style={[styles.avatarInitial, { color: colors.textSecondary }]}>
                  {avatarFallbackInitial ?? '?'}
                </Text>
              )}
            </View>
          )}

          <TextInput
            ref={inputRef}
            style={[styles.input, { color: colors.textPrimary, height: inputHeight }]}
            placeholder={placeholder}
            placeholderTextColor={colors.textTertiary}
            value={value}
            onChangeText={onChangeText}
            onFocus={handleFocus}
            onBlur={handleBlur}
            onContentSizeChange={(e) => setContentHeight(e.nativeEvent.contentSize.height)}
            maxLength={MAX_COMMENT_LENGTH}
            multiline
            scrollEnabled
            autoFocus={isEditMode}
          />

          {!isEditMode && (
            <Pressable
              onPress={() => setShowPicker((p) => !p)}
              style={styles.iconButton}
              accessibilityLabel="Emoji oder Sticker öffnen"
              hitSlop={6}
            >
              <EmojiIcon width={21} height={21} color={colors.textSecondary} />
            </Pressable>
          )}
          {showImageIcon && (
            <Pressable
              onPress={handlePickImage}
              style={styles.iconButton}
              hitSlop={6}
              accessibilityLabel="Bild anhängen"
            >
              {isUploading ? (
                <ActivityIndicator size="small" color={colors.textSecondary} />
              ) : (
                <ImageIcon width={21} height={21} color={colors.textSecondary} />
              )}
            </Pressable>
          )}

          {engaged || isEditMode ? (
            <Pressable
              onPress={handleSubmit}
              disabled={!canSubmit}
              style={[
                styles.sendButton,
                { backgroundColor: canSubmit ? colors.primary : colors.disabled },
              ]}
              accessibilityLabel="Antwort senden"
            >
              {isSubmitting ? (
                <ActivityIndicator size="small" color={colors.onPrimary} />
              ) : (
                <SendIcon
                  width={16}
                  height={16}
                  color={canSubmit ? colors.onPrimary : colors.disabledText}
                />
              )}
            </Pressable>
          ) : (
            onExpand && (
              <Pressable
                onPress={onExpand}
                style={styles.iconButton}
                hitSlop={6}
                accessibilityLabel="Kommentar im Vollbild schreiben"
              >
                <Ionicons name="expand-outline" size={20} color={colors.textSecondary} />
              </Pressable>
            )
          )}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  pill: {
    borderRadius: 26,
    // A visible 1px light rim — the glass edge — instead of a hairline.
    borderWidth: 1,
    overflow: 'hidden',
  },
  pillRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
    minHeight: 52,
  },
  avatar: {
    width: 30,
    height: 30,
    borderRadius: 15,
    overflow: 'hidden',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 3,
  },
  avatarImg: {
    ...StyleSheet.absoluteFillObject,
    borderRadius: 15,
  },
  avatarInitial: {
    fontSize: 13,
    fontFamily: 'Inter-SemiBold',
  },
  input: {
    flex: 1,
    paddingTop: 8,
    paddingBottom: 8,
    fontSize: 15,
    fontFamily: 'Inter-Regular',
  },
  iconButton: {
    width: 34,
    height: 36,
    justifyContent: 'center',
    alignItems: 'center',
  },
  cancelButton: {
    width: 30,
    height: 36,
    justifyContent: 'center',
    alignItems: 'center',
  },
  sendButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    justifyContent: 'center',
    alignItems: 'center',
  },
  replyChip: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    alignSelf: 'stretch',
    marginBottom: 6,
    borderRadius: 10,
    paddingVertical: 6,
    paddingHorizontal: 10,
    gap: 8,
  },
  replyChipText: {
    flex: 1,
    fontSize: 13,
    fontFamily: 'Inter-Regular',
  },
  stickerChip: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    marginBottom: 6,
    borderRadius: 12,
    padding: 6,
    gap: 6,
  },
  stickerChipImage: {
    width: 48,
    height: 48,
  },
  previewImage: {
    width: 56,
    height: 56,
    borderRadius: 8,
  },
});
