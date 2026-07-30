import React, { useEffect, useState } from 'react';
import { View, Text, Pressable, StyleSheet, Linking } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import BottomDrawer from '@/components/BottomDrawer';
import { useTheme } from '@/context/ThemeContext';
import { supabase } from '@/lib/supabase';

/** The node's public index — where anyone can verify a signed post. */
const INDEX_BASE = 'https://index.roebel.app';

type Props = {
  visible: boolean;
  onClose: () => void;
  isOwner: boolean;
  onEdit: () => void;
  onDelete: () => void;
  onReport: () => void;
  /** Show the pin row (owner AND Verified Citizen). */
  canPin?: boolean;
  /** Whether the post is currently pinned — toggles the pin row's label/icon. */
  isPinned?: boolean;
  onTogglePin?: () => void;
  /** Enables the "Digitaler Nachweis" row when this post is on the public record. */
  postId?: string;
};

export default function PostOptionsDrawer({
  visible,
  onClose,
  isOwner,
  onEdit,
  onDelete,
  onReport,
  canPin = false,
  isPinned = false,
  onTogglePin,
  postId,
}: Props) {
  const { colors } = useTheme();

  // Looked up lazily when the drawer opens: a post that reached the relay has
  // a published event id in the ledger, and that id IS the proof — the hash of
  // the signed content, resolvable by anyone on the public index.
  const [proofEventId, setProofEventId] = useState<string | null>(null);
  useEffect(() => {
    if (!visible || !postId) return;
    let cancelled = false;
    void (async () => {
      try {
        const { data } = await supabase
          .from('nostr_publications')
          .select('event_id')
          .eq('source_type', 'post')
          .eq('source_id', postId)
          .eq('status', 'published')
          .maybeSingle();
        if (!cancelled) setProofEventId((data?.event_id as string | null) ?? null);
      } catch {
        if (!cancelled) setProofEventId(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [visible, postId]);

  return (
    <BottomDrawer visible={visible} onClose={onClose}>
      <View style={styles.container}>
        {proofEventId && (
          <Pressable
            onPress={() => {
              onClose();
              void Linking.openURL(`${INDEX_BASE}/events?ids=${proofEventId}`);
            }}
            style={({ pressed }) => [
              styles.row,
              { borderBottomColor: colors.border },
              pressed && { backgroundColor: colors.pressedOverlay },
            ]}
          >
            <Ionicons name="shield-checkmark-outline" size={20} color={colors.textPrimary} />
            <Text style={[styles.rowText, { color: colors.textPrimary }]}>Digitaler Nachweis</Text>
          </Pressable>
        )}
        {isOwner ? (
          <>
            {canPin && (
              <Pressable
                onPress={() => {
                  onClose();
                  onTogglePin?.();
                }}
                style={({ pressed }) => [
                  styles.row,
                  { borderBottomColor: colors.border },
                  pressed && { backgroundColor: colors.pressedOverlay },
                ]}
              >
                <Ionicons
                  name={isPinned ? 'pin' : 'pin-outline'}
                  size={20}
                  color={colors.textPrimary}
                />
                <Text style={[styles.rowText, { color: colors.textPrimary }]}>
                  {isPinned ? 'Anheftung aufheben' : 'Oben anheften'}
                </Text>
              </Pressable>
            )}
            <Pressable
              onPress={() => {
                onClose();
                onEdit();
              }}
              style={({ pressed }) => [
                styles.row,
                { borderBottomColor: colors.border },
                pressed && { backgroundColor: colors.pressedOverlay },
              ]}
            >
              <Ionicons name="create-outline" size={20} color={colors.textPrimary} />
              <Text style={[styles.rowText, { color: colors.textPrimary }]}>Bearbeiten</Text>
            </Pressable>
            <Pressable
              onPress={() => {
                onClose();
                onDelete();
              }}
              style={({ pressed }) => [
                styles.row,
                pressed && { backgroundColor: colors.pressedOverlay },
              ]}
            >
              <Ionicons name="trash-outline" size={20} color={colors.error} />
              <Text style={[styles.rowText, { color: colors.error }]}>Löschen</Text>
            </Pressable>
          </>
        ) : (
          <Pressable
            onPress={() => {
              onClose();
              onReport();
            }}
            style={({ pressed }) => [
              styles.row,
              pressed && { backgroundColor: colors.pressedOverlay },
            ]}
          >
            <Ionicons name="flag-outline" size={20} color={colors.textPrimary} />
            <Text style={[styles.rowText, { color: colors.textPrimary }]}>Melden</Text>
          </Pressable>
        )}
      </View>
    </BottomDrawer>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: 4,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 16,
    paddingHorizontal: 4,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  rowText: {
    fontSize: 16,
    fontFamily: 'Inter-Medium',
  },
});
