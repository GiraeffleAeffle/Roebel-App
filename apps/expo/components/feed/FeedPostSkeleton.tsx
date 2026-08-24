import React from 'react';
import { View, StyleSheet } from 'react-native';
import { useTheme } from '@/context/ThemeContext';
import { ShimmerGroup, ShimmerBlock } from './Shimmer';

export default function FeedPostSkeleton() {
  const { colors } = useTheme();

  return (
    <ShimmerGroup>
      <View style={[styles.container, { borderBottomColor: colors.border }]}>
        {/* Author row */}
        <View style={styles.authorRow}>
          <ShimmerBlock style={styles.avatar} />
          <View style={styles.authorInfo}>
            <ShimmerBlock style={styles.nameLine} />
            <ShimmerBlock style={styles.metaLine} />
          </View>
        </View>

        {/* Content lines */}
        <ShimmerBlock style={[styles.textLine, { width: '100%' }]} />
        <ShimmerBlock style={[styles.textLine, { width: '80%' }]} />

        {/* Image placeholder */}
        <ShimmerBlock style={styles.imagePlaceholder} />

        {/* Action row */}
        <View style={styles.actionRow}>
          <ShimmerBlock style={styles.actionItem} />
          <ShimmerBlock style={styles.actionItem} />
          <ShimmerBlock style={styles.actionItem} />
        </View>
      </View>
    </ShimmerGroup>
  );
}

/** Compact avatar + text-lines skeleton matching CommentThread geometry. */
export function CommentSkeleton() {
  return (
    <ShimmerGroup>
      <View style={styles.commentContainer}>
        <ShimmerBlock style={styles.commentAvatar} />
        <View style={styles.commentBody}>
          <ShimmerBlock style={[styles.textLine, { width: 110 }]} />
          <ShimmerBlock style={[styles.textLine, { width: '92%' }]} />
          <ShimmerBlock style={[styles.textLine, { width: '60%' }]} />
        </View>
      </View>
    </ShimmerGroup>
  );
}

const styles = StyleSheet.create({
  container: {
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: 10,
    opacity: 0.7,
  },
  authorRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  avatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
  },
  authorInfo: {
    gap: 6,
  },
  nameLine: {
    height: 12,
    width: 120,
    borderRadius: 4,
  },
  metaLine: {
    height: 10,
    width: 80,
    borderRadius: 4,
  },
  textLine: {
    height: 12,
    borderRadius: 4,
  },
  imagePlaceholder: {
    height: 180,
    borderRadius: 12,
  },
  actionRow: {
    flexDirection: 'row',
    gap: 20,
    paddingTop: 6,
  },
  actionItem: {
    height: 16,
    width: 50,
    borderRadius: 4,
  },
  commentContainer: {
    flexDirection: 'row',
    gap: 10,
    paddingHorizontal: 16,
    paddingVertical: 12,
    opacity: 0.7,
  },
  commentAvatar: {
    width: 32,
    height: 32,
    borderRadius: 16,
  },
  commentBody: {
    flex: 1,
    gap: 7,
    paddingTop: 2,
  },
});
