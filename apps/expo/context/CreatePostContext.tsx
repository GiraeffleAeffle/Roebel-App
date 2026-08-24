import React, { createContext, useContext, useState, useCallback, useMemo } from 'react';
import * as ImagePicker from 'expo-image-picker';
import { uploadMediaFile } from '@/lib/upload-media';
import { probeStreamConfigured, uploadVideoToStream } from '@/lib/stream-upload';
import type { PostCategory, FeedType, PostType, StadtkasseSnapshot, PostRecord, LinkedMiniAppRef } from '@/lib/types/feed';
import type { EventRecord, MarketplaceListingRecord } from '@/lib/types';
import type { LootboxReward } from '@/lib/supabase-rewards';

const MAX_IMAGES = 4;

type LinkedEventData = Pick<EventRecord, 'id' | 'title' | 'date' | 'time' | 'location' | 'image_url' | 'category'>;
type LinkedMarketplaceData = Pick<MarketplaceListingRecord, 'id' | 'title' | 'price' | 'price_type' | 'category' | 'condition' | 'media_urls' | 'neighborhood'>;

type CreatePostState = {
  content: string;
  images: string[];
  videoUrl: string | null;
  category: PostCategory;
  feedType: FeedType;
  postType: PostType;
  isPoll: boolean;
  pollOptions: string[];
  pollType: 'single' | 'multi';
  isUploading: boolean;
  pendingUploads: number;
  uploadProgress: number | null;
  linkedEventId: string | null;
  linkedEventData: LinkedEventData | null;
  linkedMarketplaceId: string | null;
  linkedMarketplaceData: LinkedMarketplaceData | null;
  linkedMiniAppId: string | null;
  linkedMiniAppData: LinkedMiniAppRef | null;
  sticker: LootboxReward | null;
  stadtkasseSnapshot: StadtkasseSnapshot | null;
  /** Quote mode: id + preview data of the post being quoted. */
  quotedPostId: string | null;
  quotedPostData: PostRecord | null;
};

type CreatePostActions = {
  setContent: (content: string) => void;
  setCategory: (category: PostCategory) => void;
  setFeedType: (feedType: FeedType) => void;
  addImages: (walletAddress: string) => Promise<void>;
  removeImage: (index: number) => void;
  pickVideo: (walletAddress: string) => Promise<void>;
  removeVideo: () => void;
  setIsPoll: (isPoll: boolean) => void;
  setPollOptions: (options: string[]) => void;
  setPollType: (type: 'single' | 'multi') => void;
  setLinkedEvent: (id: string, data: LinkedEventData) => void;
  setLinkedMarketplace: (id: string, data: LinkedMarketplaceData) => void;
  setLinkedMiniApp: (id: string, data: LinkedMiniAppRef) => void;
  clearLinkedItem: () => void;
  setSticker: (reward: LootboxReward | null) => void;
  setStadtkasseSnapshot: (snapshot: StadtkasseSnapshot | null) => void;
  setQuotedPost: (id: string, data: PostRecord | null) => void;
  reset: () => void;
};

type CreatePostContextType = CreatePostState & CreatePostActions;

const CreatePostContext = createContext<CreatePostContextType | null>(null);

const initialState: CreatePostState = {
  content: '',
  images: [],
  videoUrl: null,
  category: 'generell',
  feedType: 'main',
  postType: 'user',
  isPoll: false,
  pollOptions: ['', ''],
  pollType: 'single',
  isUploading: false,
  pendingUploads: 0,
  uploadProgress: null,
  linkedEventId: null,
  linkedEventData: null,
  linkedMarketplaceId: null,
  linkedMarketplaceData: null,
  linkedMiniAppId: null,
  linkedMiniAppData: null,
  sticker: null,
  stadtkasseSnapshot: null,
  quotedPostId: null,
  quotedPostData: null,
};

export function CreatePostProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<CreatePostState>(initialState);

  const setContent = useCallback((content: string) => {
    setState((prev) => ({ ...prev, content }));
  }, []);

  const setCategory = useCallback((category: PostCategory) => {
    setState((prev) => ({ ...prev, category }));
  }, []);

  const setFeedType = useCallback((feedType: FeedType) => {
    setState((prev) => ({ ...prev, feedType }));
  }, []);

  const addImages = useCallback(async (walletAddress: string) => {
    const remaining = MAX_IMAGES - state.images.length;
    if (remaining <= 0) return;

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      quality: 0.8,
      allowsMultipleSelection: true,
      selectionLimit: remaining,
    });

    if (result.canceled) return;

    const assets = result.assets.slice(0, remaining);
    setState((prev) => ({
      ...prev,
      isUploading: true,
      pendingUploads: prev.pendingUploads + assets.length,
    }));

    for (const asset of assets) {
      const url = await uploadMediaFile(asset.uri, walletAddress, 'image', 'posts', asset.mimeType || undefined);
      setState((prev) => {
        const nextImages = url ? [...prev.images, url].slice(0, MAX_IMAGES) : prev.images;
        const nextPending = Math.max(0, prev.pendingUploads - 1);
        return {
          ...prev,
          images: nextImages,
          pendingUploads: nextPending,
          isUploading: nextPending > 0,
        };
      });
    }
  }, [state.images.length]);

  const removeImage = useCallback((index: number) => {
    setState((prev) => ({
      ...prev,
      images: prev.images.filter((_, i) => i !== index),
    }));
  }, []);

  const pickVideo = useCallback(async (walletAddress: string) => {
    // Stream configured → 10-min cap + direct-to-Cloudflare tus upload.
    // Not configured → exactly the legacy behavior (60s, Supabase Storage).
    const useStream = await probeStreamConfigured();

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['videos'],
      quality: 0.8,
      videoMaxDuration: useStream ? 900 : 60,
    });

    if (result.canceled) return;

    setState((prev) => ({ ...prev, isUploading: true, uploadProgress: useStream ? 0 : null }));

    const asset = result.assets[0];
    const url = useStream
      ? await uploadVideoToStream(asset.uri, walletAddress, (fraction) =>
          setState((prev) => ({ ...prev, uploadProgress: fraction })),
        )
      : await uploadMediaFile(asset.uri, walletAddress, 'video', 'posts', asset.mimeType || undefined);

    setState((prev) => ({
      ...prev,
      videoUrl: url,
      isUploading: false,
      uploadProgress: null,
    }));
  }, []);

  const removeVideo = useCallback(() => {
    setState((prev) => ({ ...prev, videoUrl: null }));
  }, []);

  const setIsPoll = useCallback((isPoll: boolean) => {
    setState((prev) => ({ ...prev, isPoll }));
  }, []);

  const setPollOptions = useCallback((pollOptions: string[]) => {
    setState((prev) => ({ ...prev, pollOptions }));
  }, []);

  const setPollType = useCallback((pollType: 'single' | 'multi') => {
    setState((prev) => ({ ...prev, pollType }));
  }, []);

  const setLinkedEvent = useCallback((id: string, data: LinkedEventData) => {
    setState((prev) => ({
      ...prev,
      linkedEventId: id,
      linkedEventData: data,
      postType: 'event_share',
      linkedMarketplaceId: null,
      linkedMarketplaceData: null,
      linkedMiniAppId: null,
      linkedMiniAppData: null,
    }));
  }, []);

  const setLinkedMarketplace = useCallback((id: string, data: LinkedMarketplaceData) => {
    setState((prev) => ({
      ...prev,
      linkedMarketplaceId: id,
      linkedMarketplaceData: data,
      postType: 'marketplace_share',
      linkedEventId: null,
      linkedEventData: null,
      linkedMiniAppId: null,
      linkedMiniAppData: null,
    }));
  }, []);

  const setLinkedMiniApp = useCallback((id: string, data: LinkedMiniAppRef) => {
    setState((prev) => ({
      ...prev,
      linkedMiniAppId: id,
      linkedMiniAppData: data,
      postType: 'mini_app_share',
      linkedEventId: null,
      linkedEventData: null,
      linkedMarketplaceId: null,
      linkedMarketplaceData: null,
    }));
  }, []);

  const clearLinkedItem = useCallback(() => {
    setState((prev) => ({
      ...prev,
      linkedEventId: null,
      linkedEventData: null,
      linkedMarketplaceId: null,
      linkedMarketplaceData: null,
      linkedMiniAppId: null,
      linkedMiniAppData: null,
      postType: 'user',
    }));
  }, []);

  const setSticker = useCallback((reward: LootboxReward | null) => {
    setState((prev) => ({ ...prev, sticker: reward }));
  }, []);

  const setStadtkasseSnapshot = useCallback((snapshot: StadtkasseSnapshot | null) => {
    setState((prev) => ({ ...prev, stadtkasseSnapshot: snapshot }));
  }, []);

  // Quotes always land in the main feed ("Für Alle") — the whole point is
  // promoting an App-feed post into the town-wide timeline.
  const setQuotedPost = useCallback((id: string, data: PostRecord | null) => {
    setState((prev) => ({ ...prev, quotedPostId: id, quotedPostData: data, feedType: 'main' }));
  }, []);

  const reset = useCallback(() => {
    setState(initialState);
  }, []);

  const value = useMemo<CreatePostContextType>(
    () => ({
      ...state,
      setContent,
      setCategory,
      setFeedType,
      addImages,
      removeImage,
      pickVideo,
      removeVideo,
      setIsPoll,
      setPollOptions,
      setPollType,
      setLinkedEvent,
      setLinkedMarketplace,
      setLinkedMiniApp,
      clearLinkedItem,
      setSticker,
      setStadtkasseSnapshot,
      setQuotedPost,
      reset,
    }),
    [
      state,
      setContent,
      setCategory,
      setFeedType,
      addImages,
      removeImage,
      pickVideo,
      removeVideo,
      setIsPoll,
      setPollOptions,
      setPollType,
      setLinkedEvent,
      setLinkedMarketplace,
      setLinkedMiniApp,
      clearLinkedItem,
      setSticker,
      setStadtkasseSnapshot,
      setQuotedPost,
      reset,
    ]
  );

  return (
    <CreatePostContext.Provider value={value}>
      {children}
    </CreatePostContext.Provider>
  );
}

export function useCreatePost() {
  const ctx = useContext(CreatePostContext);
  if (!ctx) throw new Error('useCreatePost must be used within CreatePostProvider');
  return ctx;
}
