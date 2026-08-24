import React, { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  Pressable,
  StyleSheet,
  ActivityIndicator,
  Image as RNImage,
} from 'react-native';
import { Image } from 'expo-image';
import * as Haptics from 'expo-haptics';

// Standard Röbel Münzen coin used across the Belohnungen screens (balance
// badge, tasks, Schatzkammer). require()'d + rendered with RN's Image so it
// paints on the first frame instead of fading in late like expo-image.
const COIN = require('@/assets/illustration/gamification/single.png');
import { Ionicons } from '@expo/vector-icons';
import ArrowRightIcon from '@/assets/icons/arrow-right.svg';
import EmojiIcon from '@/assets/icons/emoji.svg';
import { useTheme } from '@/context/ThemeContext';
import StickerEmojiPicker from '@/components/pickers/StickerEmojiPicker';
import type { LootboxReward } from '@/lib/supabase-rewards';

type Props = {
  onSend: (text: string, stickerRewardId: string | null) => void;
  isSending: boolean;
  /** When set, shows the Röbel-Münzen button (XMTP-rail chats only). */
  onOpenPayment?: () => void;
};

export default function ChatInput({ onSend, isSending, onOpenPayment }: Props) {
  const { colors } = useTheme();
  const [text, setText] = useState('');
  const [showPicker, setShowPicker] = useState(false);
  const [pendingSticker, setPendingSticker] = useState<LootboxReward | null>(null);

  const canSend = (text.trim().length > 0 || !!pendingSticker) && !isSending;

  const handleSend = () => {
    if (!canSend) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    onSend(text.trim(), pendingSticker?.id ?? null);
    setText('');
    setPendingSticker(null);
    setShowPicker(false);
  };

  const handleEmojiSelect = (emoji: string) => {
    setText((prev) => prev + emoji);
    setShowPicker(false);
  };

  const handleStickerSelect = (reward: LootboxReward) => {
    setPendingSticker(reward);
    setShowPicker(false);
  };

  return (
    <View>
      {showPicker && (
        <StickerEmojiPicker
          onPickEmoji={handleEmojiSelect}
          onPickSticker={handleStickerSelect}
          onClose={() => setShowPicker(false)}
        />
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
      <View style={[styles.container, { borderTopColor: colors.border, backgroundColor: colors.background }]}>
        {onOpenPayment && (
          <Pressable
            style={styles.emojiButton}
            onPress={onOpenPayment}
            accessibilityLabel="Röbel Münzen senden"
          >
            <RNImage source={COIN} style={styles.coinButtonImage} resizeMode="contain" />
          </Pressable>
        )}
        <Pressable
          style={styles.emojiButton}
          onPress={() => setShowPicker((prev) => !prev)}
          accessibilityLabel="Emoji oder Sticker öffnen"
        >
          <EmojiIcon width={24} height={24} color={colors.textSecondary} />
        </Pressable>
        <TextInput
          style={[styles.input, { backgroundColor: colors.surface, color: colors.textPrimary }]}
          value={text}
          onChangeText={(t) => {
            setText(t);
            if (showPicker) setShowPicker(false);
          }}
          placeholder="Nachricht schreiben..."
          placeholderTextColor={colors.textTertiary}
          multiline
          maxLength={5000}
          returnKeyType="default"
        />
        <Pressable
          style={[
            styles.sendButton,
            { backgroundColor: colors.primary },
            !canSend && [styles.sendButtonDisabled, { backgroundColor: colors.disabled }],
          ]}
          onPress={handleSend}
          disabled={!canSend}
        >
          {isSending ? (
            <ActivityIndicator size="small" color={colors.onPrimary} />
          ) : (
            <ArrowRightIcon width={20} height={20} color={colors.onPrimary} />
          )}
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    paddingHorizontal: 12,
    paddingVertical: 12,
    borderTopWidth: 1,
    gap: 8,
    alignItems: 'flex-end',
  },
  emojiButton: {
    width: 40,
    height: 40,
    justifyContent: 'center',
    alignItems: 'center',
  },
  coinButtonImage: {
    width: 28,
    height: 28,
  },
  input: {
    flex: 1,
    borderRadius: 20,
    paddingHorizontal: 16,
    paddingVertical: 10,
    fontFamily: 'Inter-Regular',
    fontSize: 15,
    maxHeight: 100,
  },
  sendButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    justifyContent: 'center',
    alignItems: 'center',
  },
  sendButtonDisabled: {},
  stickerChip: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    marginHorizontal: 12,
    marginTop: 4,
    borderRadius: 12,
    padding: 6,
    gap: 6,
  },
  stickerChipImage: {
    width: 48,
    height: 48,
  },
});
