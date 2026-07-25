import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  RefreshControl,
  Pressable,
  Share,
} from 'react-native';
import { Image } from 'expo-image';
import { useLocalSearchParams, useRouter, Stack } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '@/context/ThemeContext';
import { ArrowLeftIcon, ShareIcon } from '@/components/Icons';
import {
  getBlogArticleById,
  incrementViewCount,
  type BlogArticleWithAccount,
} from '@/lib/supabase-blog-articles';
import { SUB_TYPE_EMOJI, SUB_TYPE_LABELS } from '@/lib/types';
import RichTextRenderer from '@/components/RichTextRenderer';
import MeckyNotFound from '@/components/MeckyNotFound';
import MuenzenTipButton from '@/components/muenzen/MuenzenTipButton';

export default function BlogArticleScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { colors } = useTheme();
  const [article, setArticle] = useState<BlogArticleWithAccount | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const fetchArticle = async () => {
    if (!id) return;
    const data = await getBlogArticleById(id);
    if (data && data.status === 'published') {
      // Hide pending/rejected externs
      if (data.account?.is_extern && data.account.extern_status !== 'approved') {
        setArticle(null);
      } else {
        setArticle(data);
        incrementViewCount(data.id);
      }
    } else {
      setArticle(null);
    }
    setLoading(false);
  };

  useEffect(() => {
    fetchArticle();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const onRefresh = async () => {
    setRefreshing(true);
    await fetchArticle();
    setRefreshing(false);
  };

  const handleShare = async () => {
    if (!article) return;
    try {
      await Share.share({
        message: `${article.title}\n\nhttps://www.roebel.app/blog/${article.id}`,
        title: article.title,
      });
    } catch (e) {
      console.error('share error', e);
    }
  };

  if (loading) {
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
        <Stack.Screen options={{ headerShown: false }} />
        <View style={styles.loadingWrap}>
          <Text style={{ color: colors.textTertiary }}>Lade Artikel…</Text>
        </View>
      </SafeAreaView>
    );
  }

  if (!article) {
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
        <Stack.Screen options={{ headerShown: false }} />
        <View style={[styles.header, { borderBottomColor: colors.border }]}>
          <Pressable
            onPress={() => router.back()}
            style={[styles.backButton, { backgroundColor: colors.surfaceSecondary }]}
          >
            <ArrowLeftIcon size={24} color={colors.tabIconActive} />
          </Pressable>
          <Text style={[styles.headerTitle, { color: colors.textPrimary }]}>
            Artikel
          </Text>
          <View style={styles.headerSpacer} />
        </View>
        <MeckyNotFound title="Artikel nicht gefunden" />
      </SafeAreaView>
    );
  }

  const subLabel = article.account?.sub_type
    ? SUB_TYPE_LABELS[article.account.sub_type]
    : 'Organisation';
  const publishDate = article.published_at
    ? new Date(article.published_at).toLocaleDateString('de-DE', {
        day: '2-digit',
        month: 'long',
        year: 'numeric',
      })
    : '';

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
      <Stack.Screen options={{ headerShown: false }} />
      <View
        style={[
          styles.header,
          { borderBottomColor: colors.border, backgroundColor: colors.background },
        ]}
      >
        <Pressable
          onPress={() => router.back()}
          style={[styles.backButton, { backgroundColor: colors.surfaceSecondary }]}
        >
          <ArrowLeftIcon size={24} color={colors.tabIconActive} />
        </Pressable>
        <View style={styles.headerSpacer} />
        <Pressable onPress={handleShare} style={styles.backButton}>
          <ShareIcon size={20} color={colors.textPrimary} />
        </Pressable>
      </View>

      <ScrollView
        contentContainerStyle={styles.scrollContent}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
      >
        {article.cover_image_url ? (
          <Image
            source={{ uri: article.cover_image_url }}
            style={styles.coverImage}
            contentFit="cover"
          />
        ) : (
          <View style={[styles.coverPlaceholder, { backgroundColor: colors.surface }]}>
            <Ionicons name="document-text" size={64} color={colors.textTertiary} />
          </View>
        )}

        <View style={styles.contentContainer}>
          <Text style={[styles.title, { color: colors.textPrimary }]}>{article.title}</Text>

          {article.account ? (
            <Pressable
              onPress={() => {
                if (article.account?.slug) {
                  router.push(`/orgs/${article.account.slug}/blog` as any);
                }
              }}
              style={[styles.authorPill, { backgroundColor: colors.surfaceSecondary }]}
            >
              {article.account.avatar_url ? (
                <Image
                  source={{ uri: article.account.avatar_url }}
                  style={styles.authorAvatar}
                  contentFit="cover"
                />
              ) : (
                <Text style={styles.authorEmoji}>
                  {article.account.sub_type
                    ? SUB_TYPE_EMOJI[article.account.sub_type]
                    : '🏢'}
                </Text>
              )}
              <View style={{ flex: 1 }}>
                <Text style={[styles.authorName, { color: colors.textPrimary }]}>
                  {article.account.name}
                </Text>
                <Text style={[styles.authorRole, { color: colors.textTertiary }]}>
                  {subLabel}
                </Text>
              </View>
            </Pressable>
          ) : null}

          <View style={styles.metaRow}>
            <Ionicons name="calendar-outline" size={14} color={colors.textTertiary} />
            <Text style={[styles.metaText, { color: colors.textTertiary }]}>
              {publishDate}
            </Text>
            <Ionicons
              name="eye-outline"
              size={14}
              color={colors.textTertiary}
              style={{ marginLeft: 12 }}
            />
            <Text style={[styles.metaText, { color: colors.textTertiary }]}>
              {article.view_count}
            </Text>
          </View>

          {article.excerpt ? (
            <Text style={[styles.excerpt, { color: colors.textSecondary }]}>
              {article.excerpt}
            </Text>
          ) : null}

          <View style={styles.richTextWrap}>
            <RichTextRenderer content={article.content} />
          </View>

          <MuenzenTipButton
            contextType="blog_article"
            contextId={id}
            authorAccountId={article.author_account_id ?? article.account_id}
            recipientName={article.account?.name}
          />
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  loadingWrap: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
  },
  backButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: { fontSize: 18, fontFamily: 'MonaSansSemiCondensed-Medium'},
  headerSpacer: { width: 44, height: 44, flex: 1 },
  scrollContent: { paddingBottom: 32 },
  coverImage: { width: '100%', aspectRatio: 16 / 9 },
  coverPlaceholder: {
    width: '100%',
    aspectRatio: 16 / 9,
    alignItems: 'center',
    justifyContent: 'center',
  },
  contentContainer: { padding: 16 },
  title: { fontSize: 26, lineHeight: 34, fontFamily: 'Inter-Medium', marginBottom: 16 },
  authorPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 10,
    borderRadius: 12,
    marginBottom: 16,
  },
  authorAvatar: { width: 36, height: 36, borderRadius: 18 },
  authorEmoji: { fontSize: 28 },
  authorName: { fontSize: 14, fontFamily: 'Inter-Medium' },
  authorRole: { fontSize: 12, fontFamily: 'Inter-Regular', marginTop: 2 },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 16 },
  metaText: { fontSize: 13 },
  excerpt: {
    fontSize: 17,
    lineHeight: 26,
    fontStyle: 'italic',
    marginBottom: 24,
  },
  richTextWrap: { marginBottom: 32 },
});
