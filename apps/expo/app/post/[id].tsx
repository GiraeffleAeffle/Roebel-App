import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  FlatList,
  StyleSheet,
  Pressable,
  ActivityIndicator,
  KeyboardAvoidingView,
  Keyboard,
  Platform,
  RefreshControl,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { useGoBack } from '@/hooks/useGoBack';
import MeckyNotFound from '@/components/MeckyNotFound';
import { useTheme } from '@/context/ThemeContext';
import { useUser } from '@/context/UserContext';
import { useAccount } from '@/context/AccountContext';
import { useSnackbar } from '@/context/SnackbarContext';
import { useRequireAuth } from '@/context/AuthGateContext';
import { usePostActions } from '@/hooks/usePostActions';
import {
  fetchPostById,
  fetchPostComments,
  fetchCommentReplies,
  createComment,
  deletePost,
  pinPost,
  deleteComment,
  updateComment,
  toggleCommentLike,
  getUserLikedPostIds,
  getUserRepostedPostIds,
  getPostLikers,
  type PostLiker,
  DuplicateReportError,
} from '@/lib/supabase-posts';
import { isPostPinned, pinErrorMessage } from '@/lib/utils/pin';
import { trackPostViews, setViewTrackerWallet } from '@/lib/viewTracker';
import type { PostRecord, PostCommentRecord } from '@/lib/types/feed';
import { Ionicons } from '@expo/vector-icons';
import LinkifiedText from '@/components/feed/LinkifiedText';
import PostAuthorRow from '@/components/feed/PostAuthorRow';
import CommentThread from '@/components/feed/CommentThread';
import AvatarStack from '@/components/AvatarStack';
import { Image } from 'expo-image';
import PostImageGrid from '@/components/feed/PostImageGrid';
import PostVideoPlayer from '@/components/feed/PostVideoPlayer';
import ImageZoomModal from '@/components/ImageZoomModal';
import PostLinkPreview from '@/components/feed/PostLinkPreview';
import PostYouTubePreview from '@/components/feed/PostYouTubePreview';
import PostPollView from '@/components/feed/PostPollView';
import PostLinkedEventCard from '@/components/feed/PostLinkedEventCard';
import PostLinkedMarketplaceCard from '@/components/feed/PostLinkedMarketplaceCard';
import PostLinkedMiniAppCard from '@/components/feed/PostLinkedMiniAppCard';
import StadtkasseSnapshotCard from '@/components/feed/StadtkasseSnapshotCard';
import PostActions from '@/components/feed/PostActions';
import QuotedPostPreview from '@/components/feed/QuotedPostPreview';
import RepostDrawer from '@/components/feed/RepostDrawer';
import { resolveYouTubeUrl, removeYouTubeUrls } from '@/lib/utils/youtube';
import CommentInput from '@/components/feed/CommentInput';
import CommentScrim from '@/components/feed/CommentScrim';
import FeedPostSkeleton from '@/components/feed/FeedPostSkeleton';
import PostOptionsDrawer from '@/components/feed/PostOptionsDrawer';
import PostComposer from '@/components/feed/PostComposer';
import ReportDrawer from '@/components/feed/ReportDrawer';
import ConfirmationDrawer from '@/components/ConfirmationDrawer';

import ChevronLeftIcon from '@/assets/icons/chevron-left.svg';

export default function PostDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const goBack = useGoBack();
  const { colors } = useTheme();
  const { user, isCitizen } = useUser();
  const { activeAccount, isOwnerOf } = useAccount();
  const walletAddress = user?.wallet_address;
  const { showSnackbar } = useSnackbar();
  const requireAuth = useRequireAuth();

  const [post, setPost] = useState<PostRecord | null>(null);
  const [comments, setComments] = useState<PostCommentRecord[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshingComments, setIsRefreshingComments] = useState(false);
  const [isLoadingMoreComments, setIsLoadingMoreComments] = useState(false);
  const [hasMoreComments, setHasMoreComments] = useState(true);
  const [commentPage, setCommentPage] = useState(0);
  const [isSubmittingComment, setIsSubmittingComment] = useState(false);
  const [reportDrawerVisible, setReportDrawerVisible] = useState(false);
  const [optionsDrawerVisible, setOptionsDrawerVisible] = useState(false);
  const [deleteConfirmVisible, setDeleteConfirmVisible] = useState(false);
  const [editComposerVisible, setEditComposerVisible] = useState(false);
  const [editingComment, setEditingComment] = useState<PostCommentRecord | null>(null);
  const [replyingTo, setReplyingTo] = useState<PostCommentRecord | null>(null);
  const [expandedThreads, setExpandedThreads] = useState<Set<string>>(new Set());
  const [loadingReplies, setLoadingReplies] = useState<Set<string>>(new Set());
  const [deletingComment, setDeletingComment] = useState<PostCommentRecord | null>(null);
  const [deleteCommentConfirmVisible, setDeleteCommentConfirmVisible] = useState(false);
  const [zoomImageUrl, setZoomImageUrl] = useState<string | null>(null);
  const [commentFocused, setCommentFocused] = useState(false);
  const [likers, setLikers] = useState<PostLiker[]>([]);
  const [repostDrawerVisible, setRepostDrawerVisible] = useState(false);

  const {
    isLiked,
    getLikeCount,
    toggleLike,
    sharePost,
    reportPost,
    initLikes,
    initReposts,
    isReposted,
    getRepostCount,
    repost,
    unrepost,
  } = usePostActions(walletAddress);

  const isOwnPost = !!walletAddress && !!post && (
    post.wallet_address?.toLowerCase() === walletAddress.toLowerCase() ||
    isOwnerOf(post.account_id ?? null)
  );

  // Load post + initial comments
  useEffect(() => {
    if (!id) return;
    loadPost();
  }, [id]);

  const loadPost = async () => {
    setIsLoading(true);
    const [postData, commentsData, likersData] = await Promise.all([
      fetchPostById(id!),
      fetchPostComments(id!, 0, 20, walletAddress),
      getPostLikers(id!, 5),
    ]);

    if (postData) {
      // A repost row has no content of its own — deep links land on the original.
      if (postData.post_type === 'repost' && postData.quoted_post_id) {
        router.replace(`/post/${postData.quoted_post_id}` as any);
        return;
      }

      setPost(postData);

      // Opening the detail page counts as an impression too.
      setViewTrackerWallet(walletAddress);
      trackPostViews([postData.id]);

      // Init repost state (🔁 only shows on App-feed posts).
      if (walletAddress && postData.feed_type === 'app') {
        const repostedIds = await getUserRepostedPostIds([postData.id], walletAddress);
        initReposts(repostedIds, { [postData.id]: postData.reposts_count ?? 0 });
      }

      // Init like state
      if (walletAddress) {
        const likedIds = await getUserLikedPostIds([postData.id], walletAddress);
        initLikes(likedIds, { [postData.id]: postData.likes_count });
      }
    }

    setLikers(likersData);
    setComments(commentsData.data);
    setHasMoreComments(commentsData.hasMore);
    setIsLoading(false);
  };

  // Refresh the like facepile after the viewer likes/unlikes the post.
  const refreshLikers = useCallback(() => {
    if (!id) return;
    getPostLikers(id, 5).then(setLikers);
  }, [id]);

  const handleConfirmRepost = async () => {
    if (!post) return;
    if (!walletAddress) {
      requireAuth(() => {});
      return;
    }
    try {
      if (isReposted(post.id)) {
        await unrepost(post);
        showSnackbar({ message: 'Repost entfernt' });
      } else {
        await repost(post, activeAccount?.id);
        showSnackbar({ message: 'Repostet — erscheint in „Für Alle“' });
      }
    } catch (e) {
      console.error('[PostDetail.handleConfirmRepost]', e);
      showSnackbar({ message: 'Repost fehlgeschlagen' });
    }
  };

  const handleQuote = () => {
    if (!post) return;
    requireAuth(() => {
      router.push({ pathname: '/create', params: { quotedPostId: post.id } } as any);
    });
  };

  const loadMoreComments = useCallback(async () => {
    if (isLoadingMoreComments || !hasMoreComments) return;
    setIsLoadingMoreComments(true);

    const nextPage = commentPage + 1;
    const result = await fetchPostComments(id!, nextPage, 20, walletAddress);
    setCommentPage(nextPage);
    setComments((prev) => [...prev, ...result.data]);
    setHasMoreComments(result.hasMore);
    setIsLoadingMoreComments(false);
  }, [id, commentPage, isLoadingMoreComments, hasMoreComments, walletAddress]);

  const handleSubmitComment = async (
    content: string,
    stickerRewardId: string | null,
    imageUrl: string | null,
  ) => {
    if (!id) return;
    if (!walletAddress) {
      requireAuth(() => {});
      return;
    }
    setIsSubmittingComment(true);

    try {
      const newComment = await createComment({
        post_id: id,
        wallet_address: walletAddress,
        account_id: activeAccount?.id,
        content,
        sticker_reward_id: stickerRewardId,
        media_urls: imageUrl ? [imageUrl] : undefined,
      });

      if (newComment) {
        setComments((prev) => [...prev, newComment]);
        // Update comment count on post
        setPost((prev) =>
          prev ? { ...prev, comments_count: prev.comments_count + 1 } : prev
        );
        Keyboard.dismiss();
        setCommentFocused(false);
      }
    } catch (err) {
      console.error('Error submitting comment:', err);
    } finally {
      setIsSubmittingComment(false);
    }
  };

  const refreshComments = async () => {
    setIsRefreshingComments(true);
    setCommentPage(0);
    setExpandedThreads(new Set());
    const result = await fetchPostComments(id!, 0, 20, walletAddress);
    setComments(result.data);
    setHasMoreComments(result.hasMore);
    setIsRefreshingComments(false);
  };

  const handleSubmitReport = async (reason: string) => {
    if (!post) return;
    try {
      await reportPost(post.id, reason);
      showSnackbar({ message: 'Beitrag wurde gemeldet' });
    } catch (err) {
      if (err instanceof DuplicateReportError) {
        showSnackbar({ message: 'Du hast diesen Beitrag bereits gemeldet.' });
        return;
      }
      showSnackbar({ message: 'Fehler beim Melden des Beitrags' });
      throw new Error('Report failed');
    }
  };

  const handleEditPost = () => {
    setEditComposerVisible(true);
  };

  const handleDeletePost = () => {
    setDeleteConfirmVisible(true);
  };

  const confirmDeletePost = async () => {
    if (!post || !walletAddress) return;
    if (post.wallet_address?.toLowerCase() !== walletAddress.toLowerCase()) {
      showSnackbar({ message: 'Du kannst diesen Beitrag nicht löschen' });
      return;
    }
    try {
      await deletePost(post.id, walletAddress);
      showSnackbar({ message: 'Beitrag gelöscht' });
      router.back();
    } catch (e) {
      console.error('[post/[id].confirmDeletePost]', e);
      showSnackbar({ message: 'Fehler beim Löschen des Beitrags' });
    }
  };

  const handlePostUpdated = (updatedPost: PostRecord) => {
    setPost(updatedPost);
    setEditComposerVisible(false);
    showSnackbar({ message: 'Beitrag aktualisiert' });
  };

  const handleTogglePin = async () => {
    if (!post || !walletAddress) return;
    const currentlyPinned = isPostPinned(post.pinned_until);
    try {
      const newPinnedUntil = await pinPost(post.id, walletAddress, !currentlyPinned);
      setPost((prev) => (prev ? { ...prev, pinned_until: newPinnedUntil } : prev));
      showSnackbar({
        message: currentlyPinned ? 'Anheftung aufgehoben' : 'Beitrag oben angeheftet',
      });
    } catch (e) {
      console.error('[post/[id].handleTogglePin]', e);
      showSnackbar({ message: pinErrorMessage(e) });
    }
  };

  // Update a single comment (top-level or nested reply) by id.
  const updateCommentInState = (
    commentId: string,
    updater: (c: PostCommentRecord) => PostCommentRecord,
  ) => {
    setComments((prev) =>
      prev.map((c) => {
        if (c.id === commentId) return updater(c);
        if (c.replies?.some((r) => r.id === commentId)) {
          return { ...c, replies: c.replies.map((r) => (r.id === commentId ? updater(r) : r)) };
        }
        return c;
      }),
    );
  };

  const handleToggleCommentLike = async (comment: PostCommentRecord) => {
    if (!walletAddress) {
      requireAuth(() => {});
      return;
    }
    const nowLiked = !(comment.liked_by_me ?? false);
    updateCommentInState(comment.id, (c) => ({
      ...c,
      liked_by_me: nowLiked,
      likes_count: Math.max(0, (c.likes_count ?? 0) + (nowLiked ? 1 : -1)),
    }));
    try {
      await toggleCommentLike(comment.id, walletAddress);
    } catch (err) {
      console.error('Error toggling comment like:', err);
      // Revert on failure.
      updateCommentInState(comment.id, (c) => ({
        ...c,
        liked_by_me: !nowLiked,
        likes_count: Math.max(0, (c.likes_count ?? 0) + (nowLiked ? -1 : 1)),
      }));
    }
  };

  const handleToggleReplies = async (comment: PostCommentRecord) => {
    const cid = comment.id;
    if (expandedThreads.has(cid)) {
      setExpandedThreads((prev) => {
        const next = new Set(prev);
        next.delete(cid);
        return next;
      });
      return;
    }
    setExpandedThreads((prev) => new Set(prev).add(cid));
    if (!comment.replies) {
      setLoadingReplies((prev) => new Set(prev).add(cid));
      const replies = await fetchCommentReplies(cid, walletAddress);
      updateCommentInState(cid, (c) => ({ ...c, replies, reply_count: replies.length }));
      setLoadingReplies((prev) => {
        const next = new Set(prev);
        next.delete(cid);
        return next;
      });
    }
  };

  const handleReply = (comment: PostCommentRecord) => {
    setEditingComment(null);
    setReplyingTo(comment);
  };

  const handleSubmitReply = async (
    content: string,
    stickerRewardId: string | null,
    imageUrl: string | null,
  ) => {
    if (!id || !replyingTo) return;
    if (!walletAddress) {
      requireAuth(() => {});
      return;
    }
    // Always thread under the TOP-LEVEL ancestor (single-level threads).
    const parentId = replyingTo.parent_comment_id ?? replyingTo.id;
    setIsSubmittingComment(true);
    try {
      const newReply = await createComment({
        post_id: id,
        wallet_address: walletAddress,
        account_id: activeAccount?.id,
        content,
        sticker_reward_id: stickerRewardId,
        media_urls: imageUrl ? [imageUrl] : undefined,
        parent_comment_id: parentId,
      });
      if (newReply) {
        // Re-fetch the thread so the list and reply_count stay authoritative.
        const replies = await fetchCommentReplies(parentId, walletAddress);
        setComments((prev) =>
          prev.map((c) =>
            c.id === parentId ? { ...c, replies, reply_count: replies.length } : c,
          ),
        );
        setExpandedThreads((prev) => new Set(prev).add(parentId));
        setReplyingTo(null);
        Keyboard.dismiss();
        setCommentFocused(false);
      }
    } catch (err) {
      console.error('Error submitting reply:', err);
    } finally {
      setIsSubmittingComment(false);
    }
  };

  const handleEditComment = (comment: PostCommentRecord) => {
    setReplyingTo(null);
    setEditingComment(comment);
  };

  // Display name of a comment's author (never a wallet) — used for the reply chip.
  const commentDisplayName = (c: PostCommentRecord) => {
    const isOrg = c.author?.account?.account_type === 'organisation';
    const raw = (isOrg ? c.author?.account?.name : c.author?.username) || '';
    return raw && !/^0x[a-fA-F0-9]{40}$/.test(raw) ? raw : 'Jemand';
  };

  const handleDeleteComment = (comment: PostCommentRecord) => {
    setDeletingComment(comment);
    setDeleteCommentConfirmVisible(true);
  };

  const confirmDeleteComment = async () => {
    if (!deletingComment || !id || !walletAddress) return;
    if (deletingComment.wallet_address?.toLowerCase() !== walletAddress.toLowerCase()) {
      showSnackbar({ message: 'Du kannst diesen Kommentar nicht löschen' });
      setDeleteCommentConfirmVisible(false);
      return;
    }
    const removed = deletingComment;
    const parentId = removed.parent_comment_id;
    try {
      await deleteComment(removed.id, id, walletAddress);
      if (parentId) {
        // A reply: drop it from its thread and decrement that thread's count.
        setComments((prev) =>
          prev.map((c) =>
            c.id === parentId
              ? {
                  ...c,
                  replies: (c.replies ?? []).filter((r) => r.id !== removed.id),
                  reply_count: Math.max(0, (c.reply_count ?? 0) - 1),
                }
              : c,
          ),
        );
      } else {
        // A top-level comment: drop the whole thread (replies cascade in DB).
        setComments((prev) => prev.filter((c) => c.id !== removed.id));
        setPost((prev) =>
          prev ? { ...prev, comments_count: Math.max(0, prev.comments_count - 1) } : prev
        );
      }
      showSnackbar({ message: 'Kommentar gelöscht' });
    } catch (e) {
      console.error('[post/[id].confirmDeleteComment]', e);
      showSnackbar({ message: 'Fehler beim Löschen des Kommentars' });
    } finally {
      setDeleteCommentConfirmVisible(false);
      setDeletingComment(null);
    }
  };

  const handleSubmitEditComment = async (
    content: string,
    _stickerRewardId: string | null,
    _imageUrl: string | null,
  ) => {
    if (!editingComment) return;
    try {
      const updated = await updateComment(editingComment.id, content);
      if (updated) {
        // Merge only the changed fields so loaded replies / like state survive,
        // and so a nested reply is updated in place too.
        updateCommentInState(editingComment.id, (c) => ({
          ...c,
          content: updated.content,
          media_urls: updated.media_urls,
          edited_at: updated.edited_at,
        }));
        showSnackbar({ message: 'Kommentar aktualisiert' });
      }
    } catch {
      showSnackbar({ message: 'Fehler beim Bearbeiten des Kommentars' });
    } finally {
      setEditingComment(null);
    }
  };

  if (isLoading) {
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
        <View style={[styles.header, { borderBottomColor: colors.border }]}>
          <Pressable onPress={goBack} style={styles.backButton}>
            <ChevronLeftIcon width={24} height={24} color={colors.textPrimary} />
          </Pressable>
          <Text style={[styles.headerTitle, { color: colors.textPrimary }]}>Beitrag</Text>
          <View style={styles.backButton} />
        </View>
        <FeedPostSkeleton />
        <FeedPostSkeleton />
      </SafeAreaView>
    );
  }

  if (!post) {
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
        <View style={[styles.header, { borderBottomColor: colors.border }]}>
          <Pressable onPress={goBack} style={styles.backButton}>
            <ChevronLeftIcon width={24} height={24} color={colors.textPrimary} />
          </Pressable>
          <Text style={[styles.headerTitle, { color: colors.textPrimary }]}>Beitrag</Text>
          <View style={styles.backButton} />
        </View>
        <MeckyNotFound title="Beitrag nicht gefunden" />
      </SafeAreaView>
    );
  }

  const mediaUrls = post.media_urls?.filter(Boolean) || [];
  const firstLink = post.links && post.links.length > 0 ? post.links[0] : null;
  const youtubeUrl = resolveYouTubeUrl(post.content, post.links?.map((l) => l.url));
  const displayContent = youtubeUrl ? removeYouTubeUrls(post.content) : post.content;

  const renderHeader = () => {
    const likeCount = getLikeCount(post.id, post.likes_count);
    const likersCountText =
      likeCount === 1 ? '1 Person gefällt das' : `${likeCount} Personen gefällt das`;
    return (
    <View style={[styles.postSection, { borderBottomColor: colors.border }]}>
      {isPostPinned(post.pinned_until) && (
        <View style={styles.pinnedRow}>
          <Ionicons name="pin" size={13} color={colors.textTertiary} />
          <Text style={[styles.pinnedText, { color: colors.textTertiary }]}>Angeheftet</Text>
        </View>
      )}

      <PostAuthorRow
        author={post.author}
        category={post.category}
        createdAt={post.created_at}
        onMore={() => setOptionsDrawerVisible(true)}
      />

      {displayContent ? (
        <LinkifiedText
          content={displayContent}
          style={[styles.postContent, { color: colors.textPrimary }]}
          linkColor={colors.primary}
        />
      ) : null}

      {post.linked_event && <PostLinkedEventCard event={post.linked_event} />}
      {post.linked_marketplace && <PostLinkedMarketplaceCard listing={post.linked_marketplace} />}
      {post.linked_mini_app && <PostLinkedMiniAppCard miniApp={post.linked_mini_app} />}
      {post.stadtkasse_snapshot && (
        <StadtkasseSnapshotCard
          euro={post.stadtkasse_snapshot.euro}
          onPress={() => router.push('/treasury' as any)}
        />
      )}

      {post.post_type === 'quote' && post.quoted_post !== undefined && (
        <QuotedPostPreview
          post={post.quoted_post}
          onPress={
            post.quoted_post
              ? () => router.push(`/post/${post.quoted_post!.id}` as any)
              : undefined
          }
        />
      )}

      {mediaUrls.length > 0 && (
        <PostImageGrid imageUrls={mediaUrls} onPress={(i) => setZoomImageUrl(mediaUrls[i])} />
      )}

      {post.video_url && (
        <PostVideoPlayer videoUrl={post.video_url} isVisible autoPlay startUnmuted />
      )}

      {post.sticker && (
        <Image
          source={{ uri: post.sticker.asset_url }}
          style={styles.postSticker}
          contentFit="contain"
          accessibilityIgnoresInvertColors
        />
      )}

      {youtubeUrl ? (
        <PostYouTubePreview youtubeUrl={youtubeUrl} />
      ) : firstLink ? (
        <PostLinkPreview link={firstLink} />
      ) : null}

      {post.poll && <PostPollView poll={post.poll} walletAddress={walletAddress} />}

      <PostActions
        likesCount={likeCount}
        commentsCount={post.comments_count}
        isLiked={isLiked(post.id)}
        onLike={async () => {
          await toggleLike(post.id, post.likes_count);
          refreshLikers();
        }}
        onComment={() => {}}
        onShare={() => sharePost(post.id, post.content)}
        repostsCount={getRepostCount(post.id, post.reposts_count ?? 0)}
        isReposted={isReposted(post.id)}
        onRepost={post.feed_type === 'app' ? () => setRepostDrawerVisible(true) : undefined}
        viewsCount={post.views_count ?? 0}
      />

      {/* Who liked this — stacked avatars, tappable for the full list */}
      {likeCount > 0 && (
        <Pressable
          onPress={() =>
            router.push({ pathname: '/post/[id]/likes' as any, params: { id: post.id } })
          }
          hitSlop={8}
          style={({ pressed }) => [styles.likersRow, pressed && styles.likersRowPressed]}
          accessibilityRole="button"
          accessibilityLabel="Alle Likes anzeigen"
        >
          {likers.length > 0 && (
            <AvatarStack
              users={likers.map((u) => ({
                avatar_url: u.profile_picture_url,
                username: u.display_name,
              }))}
              maxVisible={4}
              size="large"
              totalCount={likeCount}
            />
          )}
          <Text style={[styles.likersText, { color: colors.textSecondary }]}>
            {likersCountText}
          </Text>
        </Pressable>
      )}

      {/* Comments header */}
      <View style={styles.commentsHeader}>
        <Text style={[styles.commentsTitle, { color: colors.textPrimary }]}>
          Kommentare ({post.comments_count})
        </Text>
      </View>
    </View>
    );
  };

  const renderComment = ({ item }: { item: PostCommentRecord }) => (
    <CommentThread
      comment={item}
      viewerWallet={walletAddress}
      expanded={expandedThreads.has(item.id)}
      loadingReplies={loadingReplies.has(item.id)}
      onToggleReplies={handleToggleReplies}
      onReply={handleReply}
      onEdit={handleEditComment}
      onDelete={handleDeleteComment}
      onToggleLike={handleToggleCommentLike}
    />
  );

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={styles.flex}
        keyboardVerticalOffset={0}
      >
        <View style={styles.flex}>
          {/* Header */}
          <View style={[styles.header, { borderBottomColor: colors.border }]}>
            <Pressable onPress={goBack} style={styles.backButton}>
              <ChevronLeftIcon width={24} height={24} color={colors.textPrimary} />
            </Pressable>
            <Text style={[styles.headerTitle, { color: colors.textPrimary }]}>Beitrag</Text>
            <View style={styles.backButton} />
          </View>

          {/* Comments list with post as header */}
          <FlatList
            data={comments}
            keyExtractor={(item) => item.id}
            renderItem={renderComment}
            ListHeaderComponent={renderHeader}
            onEndReached={hasMoreComments ? loadMoreComments : undefined}
            onEndReachedThreshold={0.3}
            refreshControl={
              <RefreshControl
                refreshing={isRefreshingComments}
                onRefresh={refreshComments}
                tintColor={colors.primary}
              />
            }
            ListFooterComponent={
              isLoadingMoreComments ? (
                <ActivityIndicator style={styles.footerLoader} color={colors.primary} />
              ) : comments.length === 0 ? (
                <View style={styles.noComments}>
                  <Text style={[styles.noCommentsText, { color: colors.textTertiary }]}>
                    Noch keine Kommentare. Sei der Erste!
                  </Text>
                </View>
              ) : (
                <View style={styles.bottomPadding} />
              )
            }
          />
          <CommentScrim visible={commentFocused} />
        </View>

        {/* Comment input */}
        {walletAddress ? (
          <View style={styles.inputContainer}>
            {editingComment ? (
              <CommentInput
                onSubmit={handleSubmitEditComment}
                isSubmitting={false}
                initialValue={editingComment.content}
                onCancel={() => setEditingComment(null)}
                onFocusChange={setCommentFocused}
                walletAddress={walletAddress}
              />
            ) : (
              <CommentInput
                onSubmit={replyingTo ? handleSubmitReply : handleSubmitComment}
                isSubmitting={isSubmittingComment}
                onFocusChange={setCommentFocused}
                walletAddress={walletAddress}
                replyingToName={replyingTo ? commentDisplayName(replyingTo) : null}
                onCancelReply={() => setReplyingTo(null)}
              />
            )}
          </View>
        ) : (
          <Pressable
            onPress={() => router.push('/login')}
            style={[styles.loginPrompt, { backgroundColor: colors.background, borderTopColor: colors.border }]}
          >
            <Text style={[styles.loginPromptText, { color: colors.textTertiary }]}>
              Melde dich an, um zu kommentieren
            </Text>
          </Pressable>
        )}
      </KeyboardAvoidingView>

      <PostOptionsDrawer
        visible={optionsDrawerVisible}
        onClose={() => setOptionsDrawerVisible(false)}
        postId={post.id}
        isOwner={isOwnPost}
        canPin={isOwnPost && isCitizen}
        isPinned={isPostPinned(post.pinned_until)}
        onTogglePin={handleTogglePin}
        onEdit={handleEditPost}
        onDelete={handleDeletePost}
        onReport={() => setReportDrawerVisible(true)}
      />

      <ReportDrawer
        visible={reportDrawerVisible}
        onClose={() => setReportDrawerVisible(false)}
        onReport={handleSubmitReport}
      />

      <RepostDrawer
        visible={repostDrawerVisible}
        onClose={() => setRepostDrawerVisible(false)}
        isReposted={isReposted(post.id)}
        onRepost={handleConfirmRepost}
        onQuote={handleQuote}
      />

      <ConfirmationDrawer
        visible={deleteConfirmVisible}
        title="Beitrag löschen?"
        message="Dieser Beitrag wird dauerhaft entfernt."
        variant="destructive"
        confirmText="Löschen"
        cancelText="Abbrechen"
        onConfirm={confirmDeletePost}
        onCancel={() => setDeleteConfirmVisible(false)}
      />

      <ConfirmationDrawer
        visible={deleteCommentConfirmVisible}
        title="Kommentar löschen?"
        message="Dieser Kommentar wird dauerhaft entfernt."
        variant="destructive"
        confirmText="Löschen"
        cancelText="Abbrechen"
        onConfirm={confirmDeleteComment}
        onCancel={() => { setDeleteCommentConfirmVisible(false); setDeletingComment(null); }}
      />

      {post && (
        <PostComposer
          visible={editComposerVisible}
          onClose={() => setEditComposerVisible(false)}
          onPostCreated={() => {}}
          feedType={post.feed_type}
          walletAddress={walletAddress || ''}
          isCitizen={false}
          user={user}
          editingPost={post}
          onPostUpdated={handlePostUpdated}
        />
      )}

      <ImageZoomModal
        visible={!!zoomImageUrl}
        imageUrl={zoomImageUrl || ''}
        images={mediaUrls}
        onClose={() => setZoomImageUrl(null)}
      />
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
  backButton: {
    width: 40,
    height: 40,
    justifyContent: 'center',
    alignItems: 'flex-start',
  },
  headerTitle: {
    fontSize: 18,
    fontFamily: 'MonaSansSemiCondensed-Medium',
  },
  postSection: {
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: 10,
  },
  postContent: {
    fontSize: 16,
    fontFamily: 'Inter-Regular',
    lineHeight: 24,
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
  postSticker: {
    width: 200,
    height: 200,
    alignSelf: 'flex-start',
  },
  likersRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingTop: 2,
  },
  likersRowPressed: {
    opacity: 0.6,
  },
  likersText: {
    fontSize: 13,
    fontFamily: 'Inter-Regular',
  },
  commentsHeader: {
    paddingTop: 14,
    paddingBottom: 4,
  },
  commentsTitle: {
    fontSize: 15,
    fontFamily: 'Inter-SemiBold',
  },
  noComments: {
    padding: 32,
    alignItems: 'center',
  },
  noCommentsText: {
    fontSize: 14,
    fontFamily: 'Inter-Regular',
    textAlign: 'center',
  },
  footerLoader: {
    padding: 20,
  },
  bottomPadding: {
    height: 20,
  },
  inputContainer: {
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  loginPrompt: {
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderTopWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
  },
  loginPromptText: {
    fontSize: 14,
    fontFamily: 'Inter-Medium',
  },
});
