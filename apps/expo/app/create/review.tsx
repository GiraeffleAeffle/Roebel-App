import React, { useState } from 'react';
import {
  View,
  Text,
  Pressable,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
} from 'react-native';
import { Image } from 'expo-image';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '@/context/ThemeContext';
import { useUser } from '@/context/UserContext';
import { useAccount } from '@/context/AccountContext';
import { useSnackbar } from '@/context/SnackbarContext';
import { useCreatePost } from '@/context/CreatePostContext';
import { usePendingPostFeedback } from '@/context/PendingPostFeedbackContext';
import { useActiveProfileImage } from '@/hooks/useActiveProfileImage';
import { createPost, createPoll, PostingDeniedError } from '@/lib/supabase-posts';
import PostLinkedEventCard from '@/components/feed/PostLinkedEventCard';
import QuotedPostPreview from '@/components/feed/QuotedPostPreview';
import PostLinkedMarketplaceCard from '@/components/feed/PostLinkedMarketplaceCard';
import PostLinkedMiniAppCard from '@/components/feed/PostLinkedMiniAppCard';
import StadtkasseSnapshotCard from '@/components/feed/StadtkasseSnapshotCard';
import PostVideoPlayer from '@/components/feed/PostVideoPlayer';
import PostImageGrid from '@/components/feed/PostImageGrid';
import ImageZoomModal from '@/components/ImageZoomModal';

const GUIDELINES = [
  'Sei respektvoll und freundlich zu deinen Nachbarn',
  'Keine Beleidigungen, Hassrede oder Diskriminierung',
  'Teile nur wahrheitsgemäße Informationen',
  'Keine Werbung oder Spam ohne Genehmigung',
  'Respektiere die Privatsphäre anderer',
  'Keine illegalen oder gefährlichen Inhalte',
  'Dein Beitrag wird Teil des öffentlichen Datenbestands',
];

export default function ReviewScreen() {
  const { colors } = useTheme();
  const router = useRouter();
  const { user } = useUser();
  const { activeAccount } = useAccount();
  const { showSnackbar } = useSnackbar();
  const draft = useCreatePost();
  const activeProfileImage = useActiveProfileImage();
  const { signal: signalPostFeedback } = usePendingPostFeedback();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [zoomImageUrl, setZoomImageUrl] = useState<string | null>(null);

  const walletAddress = user?.wallet_address || '';

  const handlePost = async () => {
    const hasLinkedItem =
      !!draft.linkedEventId || !!draft.linkedMarketplaceId || !!draft.linkedMiniAppId;
    const hasSticker = !!draft.sticker;
    const hasStadtkasse = !!draft.stadtkasseSnapshot;
    const hasQuote = !!draft.quotedPostId;
    if (!walletAddress || (!draft.content.trim() && !hasLinkedItem && !hasSticker && !hasStadtkasse && !hasQuote)) return;
    setIsSubmitting(true);

    try {
      const content = draft.content.trim() || (draft.linkedEventId ? 'Schaut euch dieses Event an!' : draft.linkedMarketplaceId ? 'Schaut euch diese Anzeige an!' : draft.linkedMiniAppId ? 'Schaut euch diese Mini-App an!' : '');
      // Enrollment lives in the full-screen consent (PublicRecordConsent);
      // here we only nudge the backfill along. No-ops when not enrolled.
      void import('@/lib/nostr/publish')
        .then(({ retryPendingPublications }) => retryPendingPublications(walletAddress))
        .catch(() => {});
      const post = await createPost({
        wallet_address: walletAddress,
        account_id: activeAccount?.id,
        content,
        category: draft.category,
        feed_type: draft.feedType,
        post_type: draft.quotedPostId ? 'quote' : draft.postType,
        quoted_post_id: draft.quotedPostId || undefined,
        media_urls: draft.images.length > 0 ? draft.images : undefined,
        video_url: draft.videoUrl || undefined,
        linked_event_id: draft.linkedEventId || undefined,
        linked_marketplace_id: draft.linkedMarketplaceId || undefined,
        linked_mini_app_id: draft.linkedMiniAppId || undefined,
        sticker_reward_id: draft.sticker?.id ?? null,
        stadtkasse_snapshot: draft.stadtkasseSnapshot ?? undefined,
      });

      if (!post) {
        showSnackbar({ message: 'Beitrag konnte nicht erstellt werden' });
        return;
      }

      // Create poll if this is a poll post
      if (draft.isPoll) {
        const validOptions = draft.pollOptions.filter((o) => o.trim().length > 0);
        if (validOptions.length >= 2) {
          const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
          await createPoll({
            post_id: post.id,
            poll_type: draft.pollType,
            options: validOptions,
            expires_at: expiresAt,
          });
        }
      }

      draft.reset();
      signalPostFeedback({ message: 'Beitrag veröffentlicht!' });

      // Navigate back to feed — the home screen consumes the pending
      // feedback on focus, refreshes the lists, and shows the snackbar.
      router.dismissAll();
    } catch (err) {
      if (err instanceof PostingDeniedError) {
        // The gate state changed between opening the composer and submitting
        // (e.g. just hit the daily limit). Route back to /create so the
        // PostingGate can render the appropriate UI.
        showSnackbar({ message: denialMessage(err) });
        router.replace('/create' as any);
        return;
      }
      console.error('Error creating post:', err);
      showSnackbar({ message: 'Fehler beim Erstellen des Beitrags' });
    } finally {
      setIsSubmitting(false);
    }
  };

  function denialMessage(err: PostingDeniedError): string {
    switch (err.code) {
      case 'LOCATION_REQUIRED':
        return 'Bitte bestätige kurz, dass du gerade in Röbel/Müritz bist.';
      case 'ACCOUNT_TOO_YOUNG':
        return 'Posten ist erst 24 Stunden nach Account-Erstellung möglich.';
      case 'RATE_LIMIT_DAY':
        return 'Du hast dein Tageslimit erreicht.';
      case 'RATE_LIMIT_WEEK':
        return 'Du hast dein Wochenlimit erreicht.';
      default:
        return 'Beitrag konnte nicht erstellt werden.';
    }
  }

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
      {/* Header */}
      <View style={[styles.header, { borderBottomColor: colors.border }]}>
        <Pressable onPress={() => router.back()} hitSlop={8}>
          <Ionicons name="arrow-back" size={24} color={colors.textPrimary} />
        </Pressable>
        <Text style={[styles.headerTitle, { color: colors.textPrimary }]}>
          Beitrag überprüfen
        </Text>
        <View style={styles.headerSpacer} />
      </View>

      <ScrollView
        style={styles.flex}
        contentContainerStyle={styles.scrollContent}
      >
        {/* Post preview */}
        <View style={[styles.previewCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <View style={styles.previewAuthor}>
            {activeProfileImage.url ? (
              <Image source={{ uri: activeProfileImage.url }} style={styles.avatar} contentFit="cover" />
            ) : (
              <View style={[styles.avatar, { backgroundColor: colors.primaryLight }]}>
                <Text style={[styles.avatarText, { color: colors.primary }]}>
                  {activeProfileImage.fallbackInitial}
                </Text>
              </View>
            )}
            <Text style={[styles.authorName, { color: colors.textPrimary }]}>
              {activeProfileImage.displayName}
            </Text>
          </View>

          <Text style={[styles.previewContent, { color: colors.textPrimary }]}>
            {draft.content}
          </Text>

          {draft.linkedEventData && (
            <PostLinkedEventCard event={draft.linkedEventData} />
          )}

          {draft.linkedMarketplaceData && (
            <PostLinkedMarketplaceCard listing={draft.linkedMarketplaceData} />
          )}

          {draft.linkedMiniAppData && (
            <PostLinkedMiniAppCard miniApp={draft.linkedMiniAppData} />
          )}

          {draft.stadtkasseSnapshot && (
            <StadtkasseSnapshotCard euro={draft.stadtkasseSnapshot.euro} />
          )}

          {draft.quotedPostId && <QuotedPostPreview post={draft.quotedPostData} />}

          {draft.images.length > 0 && (
            <PostImageGrid
              imageUrls={draft.images}
              onPress={(i) => setZoomImageUrl(draft.images[i])}
            />
          )}

          {draft.videoUrl && (
            <PostVideoPlayer videoUrl={draft.videoUrl} isVisible autoPlay startUnmuted />
          )}

          {draft.isPoll && (
            <View style={styles.previewPoll}>
              <Text style={[styles.pollLabel, { color: colors.textSecondary }]}>Umfrage:</Text>
              {draft.pollOptions
                .filter((o) => o.trim())
                .map((opt, i) => (
                  <View
                    key={i}
                    style={[styles.pollOptionPreview, { backgroundColor: colors.surfaceSecondary }]}
                  >
                    <Text style={[styles.pollOptionText, { color: colors.textPrimary }]}>{opt}</Text>
                  </View>
                ))}
            </View>
          )}
        </View>

        {/* Guidelines */}
        <View style={styles.guidelinesSection}>
          <Text style={[styles.guidelinesTitle, { color: colors.textPrimary }]}>
            Community-Richtlinien
          </Text>
          {GUIDELINES.map((rule, i) => (
            <View key={i} style={styles.guidelineRow}>
              <Ionicons name="checkmark-circle" size={18} color={colors.primary} />
              <Text style={[styles.guidelineText, { color: colors.textSecondary }]}>{rule}</Text>
            </View>
          ))}
        </View>

        {/* Disclaimer */}
        <Text style={[styles.disclaimer, { color: colors.textTertiary }]}>
          Mit dem Posten stimmst du unseren Community-Richtlinien und der Datenschutzerklärung zu.
        </Text>
      </ScrollView>

      <ImageZoomModal
        visible={!!zoomImageUrl}
        imageUrl={zoomImageUrl ?? ''}
        images={draft.images}
        onClose={() => setZoomImageUrl(null)}
      />

      {/* Post CTA */}
      <View style={[styles.ctaContainer, { borderTopColor: colors.border, backgroundColor: colors.background }]}>
        <Pressable
          onPress={handlePost}
          disabled={isSubmitting}
          style={[
            styles.ctaButton,
            { backgroundColor: isSubmitting ? colors.disabled : colors.primary },
          ]}
        >
          {isSubmitting ? (
            <ActivityIndicator size="small" color={colors.onPrimary} />
          ) : (
            <Text style={[styles.ctaText, { color: colors.onPrimary }]}>Posten</Text>
          )}
        </Pressable>
      </View>
    </SafeAreaView>
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
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  headerTitle: {
    fontSize: 17,
    fontFamily: 'MonaSansSemiCondensed-SemiBold',
  },
  headerSpacer: {
    width: 24,
  },
  scrollContent: {
    padding: 16,
    gap: 24,
  },
  previewCard: {
    borderRadius: 12,
    padding: 16,
    borderWidth: 1,
    gap: 12,
  },
  previewAuthor: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  avatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
    justifyContent: 'center',
    alignItems: 'center',
  },
  avatarText: {
    fontSize: 15,
    fontFamily: 'Inter-SemiBold',
  },
  authorName: {
    fontSize: 15,
    fontFamily: 'Inter-Medium',
  },
  previewContent: {
    fontSize: 15,
    fontFamily: 'Inter-Regular',
    lineHeight: 22,
  },
  previewPoll: {
    gap: 6,
    marginTop: 4,
  },
  pollLabel: {
    fontSize: 13,
    fontFamily: 'Inter-Medium',
    marginBottom: 2,
  },
  pollOptionPreview: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 8,
  },
  pollOptionText: {
    fontSize: 14,
    fontFamily: 'Inter-Regular',
  },
  guidelinesSection: {
    gap: 10,
  },
  guidelinesTitle: {
    fontSize: 17,
    fontFamily: 'Inter-SemiBold',
    marginBottom: 2,
  },
  guidelineRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
  },
  guidelineText: {
    flex: 1,
    fontSize: 14,
    fontFamily: 'Inter-Regular',
    lineHeight: 20,
  },
  disclaimer: {
    fontSize: 12,
    fontFamily: 'Inter-Regular',
    lineHeight: 18,
    textAlign: 'center',
  },
  ctaContainer: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  ctaButton: {
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 48,
  },
  ctaText: {
    fontSize: 16,
    fontFamily: 'MonaSansSemiCondensed-Bold',
  },
});
