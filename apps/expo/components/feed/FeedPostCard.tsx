import React, { useState } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import { useTheme } from '@/context/ThemeContext';
import type { PostRecord } from '@/lib/types/feed';
import { isPostPinned } from '@/lib/utils/pin';
import LinkifiedText from './LinkifiedText';
import PostAuthorRow from './PostAuthorRow';
import PostImageGrid from './PostImageGrid';
import PostVideoPlayer from './PostVideoPlayer';
import PostLinkPreview from './PostLinkPreview';
import PostYouTubePreview from './PostYouTubePreview';
import PostPollView from './PostPollView';
import PostLinkedEventCard from './PostLinkedEventCard';
import PostLinkedMarketplaceCard from './PostLinkedMarketplaceCard';
import PostLinkedMiniAppCard from './PostLinkedMiniAppCard';
import StadtkasseSnapshotCard from './StadtkasseSnapshotCard';
import PostActions from './PostActions';
import QuotedPostPreview from './QuotedPostPreview';
import ImageZoomModal from '@/components/ImageZoomModal';
import RepostIcon from '@/assets/icons/repost.svg';
import { resolveYouTubeUrl, removeYouTubeUrls } from '@/lib/utils/youtube';

// Posts can hold up to 500 chars; in the feed we preview the first 250 and
// reveal the rest inline via "Mehr anzeigen". The detail screen shows it all.
const FEED_PREVIEW_LIMIT = 250;

type Props = {
  post: PostRecord;
  isLiked: boolean;
  displayLikeCount: number;
  walletAddress: string | undefined;
  isVisible?: boolean;
  onLike: () => void;
  onShare: () => void;
  onMore?: () => void;
  isReposted?: boolean;
  displayRepostCount?: number;
  /** Called with the repost TARGET (original for repost rows). Button hidden when undefined. */
  onRepost?: (target: PostRecord) => void;
};

function FeedPostCard({
  post,
  isLiked,
  displayLikeCount,
  walletAddress,
  isVisible = false,
  onLike,
  onShare,
  onMore,
  isReposted = false,
  displayRepostCount,
  onRepost,
}: Props) {
  const { colors } = useTheme();
  const router = useRouter();
  const [zoomImageUrl, setZoomImageUrl] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);

  // Repost rows render the ORIGINAL post's body; every interaction
  // (like/comment/share/views/repost) binds to that original too. Only the
  // ⋯ options menu keeps targeting the row itself so a reposter can remove it.
  const isRepostRow = post.post_type === 'repost' && !!post.quoted_post;
  const display = isRepostRow ? post.quoted_post! : post;
  const canRepost = !!onRepost && display.feed_type === 'app';

  const reposterName =
    (post.author?.account?.account_type === 'organisation'
      ? post.author?.account?.name
      : post.author?.username) || 'Jemand';

  const handlePress = () => {
    router.push(`/post/${display.id}` as any);
  };

  const handleComment = () => {
    router.push(`/post/${display.id}` as any);
  };

  const mediaUrls = display.media_urls?.filter(Boolean) || [];
  const firstLink = display.links && display.links.length > 0 ? display.links[0] : null;
  const youtubeUrl = resolveYouTubeUrl(display.content, display.links?.map((l) => l.url));
  const displayContent = youtubeUrl ? removeYouTubeUrls(display.content) : display.content;
  const isMarketplacePost = !!display.linked_marketplace;
  const pinned = isPostPinned(post.pinned_until);

  const showMoreToggle = !expanded && (displayContent?.length || 0) > FEED_PREVIEW_LIMIT;
  const previewContent = showMoreToggle
    ? displayContent.slice(0, FEED_PREVIEW_LIMIT).trimEnd() + '… '
    : displayContent;

  return (
    <View
      style={[
        styles.container,
        isMarketplacePost && styles.containerMarketplace,
        { backgroundColor: colors.background },
      ]}
    >
      {/* Tappable region — opens the post. The YouTube player is kept OUT of
          this Pressable so tapping it plays inline instead of navigating. */}
      <Pressable
        onPress={handlePress}
        style={({ pressed }) => [
          styles.tappable,
          isMarketplacePost && styles.tappableMarketplace,
          pressed && { backgroundColor: colors.pressedOverlay },
        ]}
      >
        {pinned && (
          <View style={styles.pinnedRow}>
            <Ionicons name="pin" size={13} color={colors.textTertiary} />
            <Text style={[styles.pinnedText, { color: colors.textTertiary }]}>Angeheftet</Text>
          </View>
        )}

        {isRepostRow && (
          <View style={styles.pinnedRow}>
            <RepostIcon width={14} height={14} color={colors.textTertiary} />
            <Text style={[styles.pinnedText, { color: colors.textTertiary }]}>
              {reposterName} hat repostet
            </Text>
          </View>
        )}

        <PostAuthorRow
          author={display.author}
          category={isMarketplacePost ? undefined : display.category}
          createdAt={display.created_at}
          onMore={onMore}
        />

        {displayContent ? (
          <LinkifiedText
            content={previewContent}
            style={[styles.content, { color: colors.textPrimary }]}
            linkColor={colors.primary}
          >
            {showMoreToggle && (
              <Text
                style={[styles.moreToggle, { color: colors.primary }]}
                onPress={() => setExpanded(true)}
              >
                Mehr anzeigen
              </Text>
            )}
          </LinkifiedText>
        ) : null}

        {display.linked_event && (
          <PostLinkedEventCard event={display.linked_event} />
        )}

        {display.linked_marketplace && (
          <PostLinkedMarketplaceCard listing={display.linked_marketplace} />
        )}

        {display.linked_mini_app && (
          <PostLinkedMiniAppCard miniApp={display.linked_mini_app} />
        )}

        {display.stadtkasse_snapshot && (
          <StadtkasseSnapshotCard
            euro={display.stadtkasse_snapshot.euro}
            onPress={() => router.push('/treasury' as any)}
          />
        )}

        {mediaUrls.length > 0 && (
          <PostImageGrid imageUrls={mediaUrls} onPress={(i) => setZoomImageUrl(mediaUrls[i])} />
        )}

        {display.video_url && (
          <PostVideoPlayer videoUrl={display.video_url} isVisible={isVisible} />
        )}

        {display.sticker && (
          <Image
            source={{ uri: display.sticker.asset_url }}
            style={styles.sticker}
            contentFit="contain"
            accessibilityIgnoresInvertColors
          />
        )}

        {/* Quote rows embed a mini preview of the original. `undefined` means
            not hydrated (nested quote-of-quote — one level deep by design),
            `null` means the original was deleted. */}
        {display.post_type === 'quote' && display.quoted_post !== undefined && (
          <QuotedPostPreview
            post={display.quoted_post}
            onPress={
              display.quoted_post
                ? () => router.push(`/post/${display.quoted_post!.id}` as any)
                : undefined
            }
          />
        )}

        {!youtubeUrl && firstLink ? (
          <PostLinkPreview link={firstLink} />
        ) : null}
      </Pressable>

      {youtubeUrl ? <PostYouTubePreview youtubeUrl={youtubeUrl} /> : null}

      {display.poll && (
        <PostPollView poll={display.poll} walletAddress={walletAddress} />
      )}

      <PostActions
        likesCount={displayLikeCount}
        commentsCount={display.comments_count}
        isLiked={isLiked}
        onLike={onLike}
        onComment={handleComment}
        onShare={onShare}
        iconOnly={isMarketplacePost}
        repostsCount={displayRepostCount ?? display.reposts_count ?? 0}
        isReposted={isReposted}
        onRepost={canRepost ? () => onRepost!(display) : undefined}
        viewsCount={display.views_count ?? 0}
      />

      <ImageZoomModal
        visible={!!zoomImageUrl}
        imageUrl={zoomImageUrl || ''}
        images={mediaUrls}
        onClose={() => setZoomImageUrl(null)}
      />
    </View>
  );
}

// The feed is a long virtualized list of these; memoizing keeps a like/repost
// or scroll-driven visibility change elsewhere in the list from re-rendering
// every mounted card. Default shallow prop compare is intentional — `isVisible`
// is a plain boolean, so a real visibility flip always passes through.
export default React.memo(FeedPostCard);

const styles = StyleSheet.create({
  container: {
    paddingHorizontal: 16,
    paddingVertical: 14,
    overflow: 'hidden' as const,
    gap: 10,
  },
  containerMarketplace: {
    paddingVertical: 16,
    gap: 14,
  },
  tappable: {
    gap: 10,
  },
  tappableMarketplace: {
    gap: 14,
  },
  pinnedRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginBottom: -2,
  },
  pinnedText: {
    fontSize: 12,
    fontFamily: 'Inter-Medium',
  },
  content: {
    fontSize: 16,
    fontFamily: 'Inter-Regular',
    lineHeight: 24,
  },
  moreToggle: {
    fontSize: 16,
    fontFamily: 'Inter-Medium',
    lineHeight: 24,
  },
  sticker: {
    width: 200,
    height: 200,
    alignSelf: 'flex-start',
  },
});
