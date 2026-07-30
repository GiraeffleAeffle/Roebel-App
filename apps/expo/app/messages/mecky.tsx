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
import { useAccount } from '@/context/AccountContext';
import { useUser } from '@/context/UserContext';
import MeckyChatBubble from '@/components/mecky/MeckyChatBubble';
import ChatInput from '@/components/messages/ChatInput';
import { formatRelativeTimestamp } from '@/lib/utils';
import { requestStoryDraft, publishStoryRemote } from '@/lib/story-api';
import type { MeckyMessage, MeckyConversation } from '@/lib/types/mecky';

import ChevronLeftIcon from '@/assets/icons/chevron-left.svg';
import ChevronRightIcon from '@/assets/icons/chevron-right.svg';

// Minimum user turns in a story thread before Mecky has "enough" for an
// article — mirrors the STORY_INTERVIEW_SYSTEM guidance ("wenn du genug für
// einen Artikel hast, sag das").
const MIN_STORY_USER_TURNS = 2;

type StoryDraftPreview = {
  articleId: string;
  slug?: string;
  title: string;
  excerpt: string | null;
};

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
    startStoryThread,
    isStoryThread,
  } = useMecky();
  const { setPreference } = useConsent();
  const { activeAccount } = useAccount();
  const { user } = useUser();
  const wallet = user?.wallet_address;
  const listRef = useRef<FlatList>(null);
  const [showConversations, setShowConversations] = useState(false);

  // Story action-bar state (draft → preview → publish). Reset whenever the
  // thread changes so switching away from a story and back doesn't carry a
  // stale draft/publish result along.
  const [draftLoading, setDraftLoading] = useState(false);
  const [draftError, setDraftError] = useState<string | null>(null);
  const [draftArticle, setDraftArticle] = useState<StoryDraftPreview | null>(null);
  const [publishLoading, setPublishLoading] = useState(false);
  const [publishError, setPublishError] = useState<string | null>(null);

  useEffect(() => {
    setDraftLoading(false);
    setDraftError(null);
    setDraftArticle(null);
    setPublishLoading(false);
    setPublishError(null);
  }, [currentConversationId]);

  const userStoryTurns = messages.filter((m) => m.role === 'user').length;

  const handleStartStory = () => {
    if (isStreaming) return;
    startStoryThread();
  };

  const handleWriteArticle = async () => {
    if (!currentConversationId || draftLoading) return;
    if (!activeAccount?.id || !wallet) {
      setDraftError('Bitte melde dich an, um deinen Artikel zu erstellen.');
      return;
    }
    setDraftLoading(true);
    setDraftError(null);
    const res = await requestStoryDraft({
      conversationId: currentConversationId,
      subject: { kind: 'other', name: activeAccount.name || 'Röbel Bürger:in' },
      accountId: activeAccount.id,
      authorAccountId: activeAccount.id,
      walletAddress: wallet,
    });
    if (!res.success || !res.articleId) {
      setDraftLoading(false);
      setDraftError(res.error || 'Artikel konnte nicht erstellt werden.');
      return;
    }
    setDraftLoading(false);
    // Title/excerpt come straight from the draft route's response — the fresh
    // blog_articles row is status='draft', which anon RLS won't return.
    setDraftArticle({
      articleId: res.articleId,
      slug: res.slug,
      title: res.title ?? 'Deine Geschichte',
      excerpt: res.excerpt ?? null,
    });
  };

  const handlePublish = async () => {
    if (!draftArticle || publishLoading) return;
    if (!activeAccount?.id || !wallet) {
      setPublishError('Bitte melde dich an, um zu veröffentlichen.');
      return;
    }
    setPublishLoading(true);
    setPublishError(null);
    const res = await publishStoryRemote({
      articleId: draftArticle.articleId,
      accountId: activeAccount.id,
      walletAddress: wallet,
    });
    setPublishLoading(false);
    if (!res.success) {
      setPublishError(res.error || 'Veröffentlichen ist fehlgeschlagen.');
      return;
    }
    router.push(`/blog/${draftArticle.articleId}` as any);
  };

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
          <View style={styles.headerTitleGroup}>
            <Text
              style={[styles.headerTitle, { color: colors.textPrimary }]}
              numberOfLines={1}
            >
              {currentTitle}
            </Text>
            {/* AI Act Art. 50(1): the KI disclosure must be permanently visible in the
                chat, not only in the consent gate or the Impressum. */}
            <Text style={[styles.headerAiHint, { color: colors.textTertiary }]}>
              KI-Assistent
            </Text>
          </View>
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
                  Ich bin eine künstliche Intelligenz. Frag mich nach Events, Restaurants, Nachrichten oder was auch immer du über Röbel wissen willst!
                </Text>
                {!isStoryThread && (
                  <Pressable
                    onPress={handleStartStory}
                    disabled={isStreaming}
                    style={[
                      styles.storyStartButton,
                      { borderColor: colors.primary },
                      isStreaming && styles.controlDisabled,
                    ]}
                    accessibilityRole="button"
                  >
                    <Text style={[styles.storyStartLabel, { color: colors.primary }]}>
                      📝 Erzähl deine Geschichte
                    </Text>
                  </Pressable>
                )}
              </View>
            }
          />

          {/* Story action bar: interview → Artikel schreiben → Veröffentlichen */}
          {isStoryThread && (
            <View
              style={[
                styles.storyBar,
                { backgroundColor: colors.surface, borderTopColor: colors.border },
              ]}
            >
              {!draftArticle ? (
                userStoryTurns >= MIN_STORY_USER_TURNS ? (
                  <Pressable
                    onPress={handleWriteArticle}
                    disabled={draftLoading || isStreaming}
                    style={[
                      styles.storyPrimaryButton,
                      { backgroundColor: colors.primary },
                      (draftLoading || isStreaming) && styles.controlDisabled,
                    ]}
                    accessibilityRole="button"
                  >
                    {draftLoading ? (
                      <ActivityIndicator size="small" color={colors.onPrimary} />
                    ) : (
                      <Text style={[styles.storyPrimaryLabel, { color: colors.onPrimary }]}>
                        Artikel schreiben
                      </Text>
                    )}
                  </Pressable>
                ) : (
                  <Text style={[styles.storyHint, { color: colors.textTertiary }]}>
                    Erzähl Mecky noch etwas mehr — dann kann sie deinen Artikel schreiben.
                  </Text>
                )
              ) : (
                <View style={styles.storyPreview}>
                  <Text
                    style={[styles.storyPreviewTitle, { color: colors.textPrimary }]}
                    numberOfLines={2}
                  >
                    {draftArticle.title}
                  </Text>
                  {!!draftArticle.excerpt && (
                    <Text
                      style={[styles.storyPreviewExcerpt, { color: colors.textSecondary }]}
                      numberOfLines={3}
                    >
                      {draftArticle.excerpt}
                    </Text>
                  )}
                  <Pressable
                    onPress={handlePublish}
                    disabled={publishLoading}
                    style={[
                      styles.storyPrimaryButton,
                      { backgroundColor: colors.primary },
                      publishLoading && styles.controlDisabled,
                    ]}
                    accessibilityRole="button"
                  >
                    {publishLoading ? (
                      <ActivityIndicator size="small" color={colors.onPrimary} />
                    ) : (
                      <Text style={[styles.storyPrimaryLabel, { color: colors.onPrimary }]}>
                        Veröffentlichen
                      </Text>
                    )}
                  </Pressable>
                </View>
              )}
              {!!draftError && (
                <Text style={[styles.storyErrorText, { color: colors.error }]}>{draftError}</Text>
              )}
              {!!publishError && (
                <Text style={[styles.storyErrorText, { color: colors.error }]}>{publishError}</Text>
              )}
            </View>
          )}

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
  storyStartButton: {
    marginTop: 8,
    paddingVertical: 12,
    paddingHorizontal: 20,
    borderRadius: 14,
    borderWidth: 1.5,
  },
  storyStartLabel: {
    fontSize: 14,
    fontFamily: 'Inter-SemiBold',
  },
  storyBar: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
    gap: 8,
  },
  storyHint: {
    fontSize: 13,
    fontFamily: 'Inter-Regular',
    textAlign: 'center',
    paddingVertical: 4,
  },
  storyPrimaryButton: {
    paddingVertical: 12,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  storyPrimaryLabel: {
    fontSize: 15,
    fontFamily: 'Inter-SemiBold',
  },
  storyPreview: {
    gap: 8,
  },
  storyPreviewTitle: {
    fontSize: 15,
    fontFamily: 'Inter-SemiBold',
  },
  storyPreviewExcerpt: {
    fontSize: 13,
    fontFamily: 'Inter-Regular',
    lineHeight: 18,
  },
  storyErrorText: {
    fontSize: 12,
    fontFamily: 'Inter-Regular',
    textAlign: 'center',
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
  headerTitleGroup: {
    flexShrink: 1,
    alignItems: 'flex-start',
  },
  headerTitle: {
    flexShrink: 1,
    fontSize: 18,
    fontFamily: 'MonaSansSemiCondensed-SemiBold',
  },
  headerAiHint: {
    fontSize: 11,
    fontFamily: 'MonaSans-Medium',
    marginTop: -1,
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
