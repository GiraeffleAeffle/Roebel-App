import { useState, useCallback } from 'react';
import { Share } from 'react-native';
import * as Haptics from 'expo-haptics';
import {
  togglePostLike,
  reportPost as reportPostApi,
  createRepost,
  undoRepost,
} from '@/lib/supabase-posts';
import type { PostRecord } from '@/lib/types/feed';
import { useRequireAuth } from '@/context/AuthGateContext';

/**
 * Hook for post interactions: like, repost, share, report
 */
export function usePostActions(walletAddress: string | undefined) {
  const requireAuth = useRequireAuth();
  const [likedPosts, setLikedPosts] = useState<Set<string>>(new Set());
  const [likeCounts, setLikeCounts] = useState<Record<string, number>>({});
  const [repostedPosts, setRepostedPosts] = useState<Set<string>>(new Set());
  const [repostCounts, setRepostCounts] = useState<Record<string, number>>({});

  /**
   * Initialize like state from batch-checked data
   */
  const initLikes = useCallback(
    (likedIds: Set<string>, counts: Record<string, number>) => {
      setLikedPosts(likedIds);
      setLikeCounts(counts);
    },
    []
  );

  /**
   * Toggle like with optimistic update
   */
  const toggleLike = useCallback(
    async (postId: string, currentCount: number) => {
      if (!walletAddress) {
        requireAuth(() => {});
        return;
      }

      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});

      const wasLiked = likedPosts.has(postId);
      const newCount = wasLiked ? Math.max(0, currentCount - 1) : currentCount + 1;

      // Optimistic update
      setLikedPosts((prev) => {
        const next = new Set(prev);
        if (wasLiked) {
          next.delete(postId);
        } else {
          next.add(postId);
        }
        return next;
      });
      setLikeCounts((prev) => ({ ...prev, [postId]: newCount }));

      try {
        await togglePostLike(postId, walletAddress);
      } catch (err) {
        // Revert on error
        console.error('Error toggling like:', err);
        setLikedPosts((prev) => {
          const next = new Set(prev);
          if (wasLiked) {
            next.add(postId);
          } else {
            next.delete(postId);
          }
          return next;
        });
        setLikeCounts((prev) => ({ ...prev, [postId]: currentCount }));
      }
    },
    [walletAddress, likedPosts, requireAuth]
  );

  /**
   * Check if a post is liked
   */
  const isLiked = useCallback(
    (postId: string) => likedPosts.has(postId),
    [likedPosts]
  );

  /**
   * Get current like count (with optimistic updates applied)
   */
  const getLikeCount = useCallback(
    (postId: string, originalCount: number) => {
      return likeCounts[postId] ?? originalCount;
    },
    [likeCounts]
  );

  /**
   * Initialize repost state from batch-checked data (ORIGINAL post ids)
   */
  const initReposts = useCallback(
    (ids: Set<string>, counts: Record<string, number>) => {
      setRepostedPosts(ids);
      setRepostCounts(counts);
    },
    []
  );

  const isReposted = useCallback(
    (postId: string) => repostedPosts.has(postId),
    [repostedPosts]
  );

  const getRepostCount = useCallback(
    (postId: string, originalCount: number) => repostCounts[postId] ?? originalCount,
    [repostCounts]
  );

  /**
   * Plain repost with optimistic update. Throws on failure (caller shows UI).
   */
  const repost = useCallback(
    async (post: PostRecord, accountId?: string) => {
      if (!walletAddress) {
        requireAuth(() => {});
        return;
      }
      if (repostedPosts.has(post.id)) return;
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
      setRepostedPosts((prev) => new Set(prev).add(post.id));
      setRepostCounts((prev) => ({
        ...prev,
        [post.id]: (prev[post.id] ?? post.reposts_count ?? 0) + 1,
      }));
      try {
        const created = await createRepost(post.id, walletAddress, accountId);
        if (!created) throw new Error('repost failed');
      } catch (err) {
        setRepostedPosts((prev) => {
          const next = new Set(prev);
          next.delete(post.id);
          return next;
        });
        setRepostCounts((prev) => ({ ...prev, [post.id]: post.reposts_count ?? 0 }));
        throw err;
      }
    },
    [walletAddress, repostedPosts, requireAuth]
  );

  /**
   * Undo the caller's repost with optimistic update. Throws on failure.
   */
  const unrepost = useCallback(
    async (post: PostRecord) => {
      if (!walletAddress) {
        requireAuth(() => {});
        return;
      }
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
      setRepostedPosts((prev) => {
        const next = new Set(prev);
        next.delete(post.id);
        return next;
      });
      setRepostCounts((prev) => ({
        ...prev,
        [post.id]: Math.max(0, (prev[post.id] ?? post.reposts_count ?? 0) - 1),
      }));
      try {
        await undoRepost(post.id, walletAddress);
      } catch (err) {
        setRepostedPosts((prev) => new Set(prev).add(post.id));
        setRepostCounts((prev) => ({ ...prev, [post.id]: post.reposts_count ?? 0 }));
        throw err;
      }
    },
    [walletAddress, requireAuth]
  );

  /**
   * Share a post via native share sheet
   */
  const sharePost = useCallback(async (postId: string, content: string) => {
    try {
      await Share.share({
        message: `${content}\nhttps://www.roebel.app/app/posts/${postId}`,
      });
    } catch (err) {
      console.error('Error sharing post:', err);
    }
  }, []);

  /**
   * Report a post
   */
  const reportPost = useCallback(
    async (postId: string, reason: string) => {
      if (!walletAddress) {
        requireAuth(() => {});
        return;
      }
      try {
        await reportPostApi(postId, walletAddress, reason);
      } catch (err) {
        console.error('Error reporting post:', err);
        throw err;
      }
    },
    [walletAddress, requireAuth]
  );

  return {
    likedPosts,
    initLikes,
    toggleLike,
    isLiked,
    getLikeCount,
    initReposts,
    isReposted,
    getRepostCount,
    repost,
    unrepost,
    sharePost,
    reportPost,
  };
}
