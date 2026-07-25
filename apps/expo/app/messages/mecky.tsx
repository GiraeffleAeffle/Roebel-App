import React, { useRef, useEffect, useState } from 'react';
import {
  View,
  Text,
  FlatList,
  StyleSheet,
  Pressable,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Modal,
} from 'react-native';
import { Image } from 'expo-image';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useTheme } from '@/context/ThemeContext';
import { useMecky } from '@/context/MeckyContext';
import { useConsent } from '@/context/ConsentContext';
import MeckyChatBubble from '@/components/mecky/MeckyChatBubble';
import ChatInput from '@/components/messages/ChatInput';
import { formatRelativeTimestamp } from '@/lib/utils';
import type { MeckyMessage, MeckyConversation } from '@/lib/types/mecky';

import ChevronLeftIcon from '@/assets/icons/chevron-left.svg';
import ChevronRightIcon from '@/assets/icons/chevron-right.svg';

export default function MeckyScreen() {
  const router = useRouter();
  const { colors } = useTheme();
  const {
    messages,
    isStreaming,
    streamingText,
    isEnabled,
    sendMessage,
    conversations,
    currentConversationId,
    selectConversation,
    newConversation,
  } = useMecky();
  const { setPreference } = useConsent();
  const listRef = useRef<FlatList>(null);
  const [showConversations, setShowConversations] = useState(false);

  const currentTitle =
    conversations.find((c) => c.id === currentConversationId)?.title ?? 'Mecky';

  // In-flight guard: switching threads mid-stream would let the current
  // turn's onComplete append onto the wrong conversation, so both the
  // "Neuer Chat" action and thread selection are disabled while streaming.
  const handleNewChat = () => {
    if (isStreaming) return;
    newConversation();
  };

  const handleOpenConversations = () => {
    if (isStreaming) return;
    setShowConversations(true);
  };

  const handleSelectConversation = async (id: string) => {
    if (isStreaming) return;
    setShowConversations(false);
    await selectConversation(id);
  };

  const renderConversationRow = ({ item }: { item: MeckyConversation }) => (
    <Pressable
      onPress={() => handleSelectConversation(item.id)}
      disabled={isStreaming}
      style={[
        styles.conversationRow,
        { borderBottomColor: colors.borderSecondary },
        item.id === currentConversationId && { backgroundColor: colors.primaryLight },
        isStreaming && styles.controlDisabled,
      ]}
    >
      <Text
        style={[styles.conversationTitle, { color: colors.textPrimary }]}
        numberOfLines={1}
      >
        {item.title}
      </Text>
      <Text style={[styles.conversationTime, { color: colors.textTertiary }]}>
        {formatRelativeTimestamp(item.last_message_at)}
      </Text>
    </Pressable>
  );

  // Build display list: messages + streaming indicator
  const displayData: (MeckyMessage | { id: string; type: 'streaming' })[] = [
    ...(isStreaming
      ? [
          {
            id: 'streaming',
            type: 'streaming' as const,
          },
        ]
      : []),
    ...([...messages].reverse()),
  ];

  const renderItem = ({ item }: { item: any }) => {
    if (item.type === 'streaming') {
      return (
        <View style={[styles.streamingRow]}>
          <Image
            source={require('@/assets/illustration/mecky/welcome.png')}
            style={styles.streamingAvatar}
            contentFit="cover"
          />
          <View style={[styles.streamingBubble, { backgroundColor: colors.surface }]}>
            {streamingText ? (
              <Text style={[styles.streamingText, { color: colors.textPrimary }]}>
                {streamingText}
              </Text>
            ) : (
              <View style={styles.dots}>
                <ActivityIndicator size="small" color={colors.textTertiary} />
              </View>
            )}
          </View>
        </View>
      );
    }

    return <MeckyChatBubble message={item as MeckyMessage} />;
  };

  return (
    <SafeAreaView
      style={[styles.container, { backgroundColor: colors.background }]}
      edges={['top']}
    >
      {/* Header */}
      <View style={[styles.header, { borderBottomColor: colors.border }]}>
        <Pressable onPress={() => router.back()} style={styles.backButton}>
          <ChevronLeftIcon width={24} height={24} color={colors.textPrimary} />
        </Pressable>
        <Pressable
          onPress={handleOpenConversations}
          disabled={isStreaming}
          style={[styles.headerCenter, isStreaming && styles.controlDisabled]}
        >
          <Image
            source={require('@/assets/illustration/mecky/welcome.png')}
            style={styles.headerAvatar}
            contentFit="cover"
          />
          <Text
            style={[styles.headerTitle, { color: colors.textPrimary }]}
            numberOfLines={1}
          >
            {currentTitle}
          </Text>
          <ChevronRightIcon
            width={14}
            height={14}
            color={colors.textTertiary}
            style={styles.headerChevron}
          />
        </Pressable>
        <Pressable
          onPress={handleNewChat}
          disabled={isStreaming}
          style={[styles.clearButton, isStreaming && styles.controlDisabled]}
        >
          <Text style={[styles.clearText, { color: colors.primary }]}>Neuer Chat</Text>
        </Pressable>
      </View>

      {!isEnabled ? (
        <View style={styles.consentEmpty}>
          <Image
            source={require('@/assets/illustration/mecky/welcome.png')}
            style={styles.emptyHero}
            contentFit="contain"
          />
          <Text style={[styles.emptyTitle, { color: colors.textPrimary }]}>
            Mecky braucht deine Zustimmung
          </Text>
          <Text style={[styles.emptySubtitle, { color: colors.textSecondary }]}>
            Mecky ist ein KI-Assistent von Anthropic (USA). Aktiviere ihn, um auf Deutsch zu chatten —
            jederzeit widerrufbar.
          </Text>
          <Pressable
            onPress={async () => {
              await setPreference('ai_assistant', true, 'banner');
            }}
            style={[styles.consentPrimary, { backgroundColor: colors.primary }]}
            accessibilityRole="button"
          >
            <Text style={[styles.consentPrimaryLabel, { color: colors.onPrimary }]}>
              Mecky aktivieren
            </Text>
          </Pressable>
          <Pressable
            onPress={() => router.push('/settings/consent' as any)}
            style={styles.consentSecondary}
            accessibilityRole="link"
          >
            <Text style={[styles.consentSecondaryLabel, { color: colors.textSecondary }]}>
              Datenschutz-Einstellungen öffnen
            </Text>
          </Pressable>
        </View>
      ) : (
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          style={styles.flex}
        >
          {/* Messages */}
          <FlatList
            ref={listRef}
            data={displayData}
            keyExtractor={(item) => item.id}
            renderItem={renderItem}
            inverted
            contentContainerStyle={styles.messageList}
            ListEmptyComponent={
              <View style={styles.emptyChat}>
                <Image
                  source={require('@/assets/illustration/mecky/welcome.png')}
                  style={styles.emptyHero}
                  contentFit="contain"
                />
                <Text style={[styles.emptyTitle, { color: colors.textPrimary }]}>
                  Hallo! Ich bin Mecky 👋
                </Text>
                <Text style={[styles.emptySubtitle, { color: colors.textSecondary }]}>
                  Frag mich nach Events, Restaurants, Nachrichten oder was auch immer du über Röbel wissen willst!
                </Text>
              </View>
            }
          />

          {/* Input */}
          <SafeAreaView
            edges={['bottom']}
            style={[styles.inputSafe, { backgroundColor: colors.background }]}
          >
            <ChatInput onSend={sendMessage} isSending={isStreaming} />
          </SafeAreaView>
        </KeyboardAvoidingView>
      )}

      {/* Conversations list */}
      <Modal
        visible={showConversations}
        transparent
        animationType="fade"
        onRequestClose={() => setShowConversations(false)}
      >
        <Pressable style={styles.menuBackdrop} onPress={() => setShowConversations(false)}>
          <View
            style={[styles.menuCard, { backgroundColor: colors.surface, borderColor: colors.border }]}
          >
            <Text style={[styles.menuHeading, { color: colors.textPrimary }]}>Chats</Text>
            {conversations.length === 0 ? (
              <Text style={[styles.menuEmptyText, { color: colors.textSecondary }]}>
                Noch keine Chats
              </Text>
            ) : (
              <FlatList
                data={conversations}
                keyExtractor={(item) => item.id}
                renderItem={renderConversationRow}
                style={styles.menuList}
              />
            )}
          </View>
        </Pressable>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderBottomWidth: 1,
  },
  backButton: {
    width: 40,
    height: 40,
    justifyContent: 'center',
    alignItems: 'flex-start',
  },
  headerCenter: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingHorizontal: 4,
  },
  headerAvatar: {
    width: 32,
    height: 32,
    borderRadius: 16,
  },
  headerTitle: {
    flexShrink: 1,
    fontSize: 18,
    fontFamily: 'MonaSansSemiCondensed-SemiBold',
  },
  headerChevron: {
    transform: [{ rotate: '90deg' }],
  },
  controlDisabled: {
    opacity: 0.4,
  },
  clearButton: {
    minHeight: 40,
    justifyContent: 'center',
    alignItems: 'flex-end',
    paddingLeft: 8,
  },
  clearText: {
    fontSize: 14,
    fontFamily: 'Inter-Medium',
  },
  messageList: {
    paddingVertical: 8,
    flexGrow: 1,
  },
  emptyChat: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: 60,
    paddingHorizontal: 32,
    gap: 12,
  },
  emptyAvatar: {
    width: 64,
    height: 64,
    borderRadius: 32,
    marginBottom: 8,
  },
  emptyHero: {
    width: 220,
    height: 220,
    marginBottom: 4,
  },
  emptyTitle: {
    fontSize: 20,
    fontFamily: 'Inter-SemiBold',
    textAlign: 'center',
  },
  emptySubtitle: {
    fontSize: 14,
    fontFamily: 'Inter-Regular',
    textAlign: 'center',
    lineHeight: 20,
  },
  streamingRow: {
    flexDirection: 'row',
    marginVertical: 4,
    paddingHorizontal: 8,
    justifyContent: 'flex-start',
  },
  streamingAvatar: {
    width: 28,
    height: 28,
    borderRadius: 14,
    marginRight: 6,
    alignSelf: 'flex-end',
  },
  streamingBubble: {
    maxWidth: '80%',
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 16,
    borderBottomLeftRadius: 4,
  },
  streamingText: {
    fontSize: 15,
    fontFamily: 'Inter-Regular',
    lineHeight: 21,
  },
  dots: {
    paddingVertical: 4,
  },
  flex: {
    flex: 1,
  },
  inputSafe: {},
  consentEmpty: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 32,
    gap: 12,
  },
  consentPrimary: {
    marginTop: 16,
    paddingVertical: 14,
    paddingHorizontal: 24,
    borderRadius: 14,
    alignSelf: 'stretch',
    alignItems: 'center',
  },
  consentPrimaryLabel: {
    fontSize: 15,
    fontFamily: 'Inter-SemiBold',
  },
  consentSecondary: {
    paddingVertical: 12,
  },
  consentSecondaryLabel: {
    fontSize: 13,
    fontFamily: 'Inter-Medium',
    textDecorationLine: 'underline',
  },
  menuBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.35)',
    justifyContent: 'flex-end',
  },
  menuCard: {
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    paddingTop: 16,
    paddingBottom: 24,
    maxHeight: '70%',
  },
  menuHeading: {
    fontSize: 16,
    fontFamily: 'Inter-SemiBold',
    paddingHorizontal: 20,
    paddingBottom: 12,
  },
  menuList: {
    flexShrink: 1,
  },
  menuEmptyText: {
    fontSize: 14,
    fontFamily: 'Inter-Regular',
    textAlign: 'center',
    paddingVertical: 24,
    paddingHorizontal: 20,
  },
  conversationRow: {
    paddingHorizontal: 20,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  conversationTitle: {
    fontSize: 15,
    fontFamily: 'Inter-Medium',
    marginBottom: 2,
  },
  conversationTime: {
    fontSize: 12,
    fontFamily: 'Inter-Regular',
  },
});
