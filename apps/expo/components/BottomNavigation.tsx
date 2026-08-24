import React from 'react';
import { View, Pressable, StyleSheet, Text } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import { useTheme } from '@/context/ThemeContext';
import { useExploreDot } from '@/context/ExploreDotContext';
import { fontFamily } from '@/constants/theme';

// Import SVG icons
import HomeStroke from '../assets/icons/bottom-nav/home.svg';
import HomeFilled from '../assets/icons/bottom-nav/home-filled.svg';
import DiscoverStroke from '../assets/icons/bottom-nav/discover.svg';
import DiscoverFilled from '../assets/icons/bottom-nav/discover_fill.svg';
import UserStroke from '../assets/icons/bottom-nav/user-circle.svg';
import UserFilled from '../assets/icons/bottom-nav/user-circle-filled.svg';

export type TabKey = 'home' | 'explore' | 'profile';

// Content height only — the rendered bar adds Math.max(insets.bottom, 8) bottom padding, so on home-indicator devices the total is taller.
export const BOTTOM_NAV_HEIGHT = 72;

const ICON_SIZE = 24;

type Props = {
  activeTab: TabKey;
  onTabPress: (tab: TabKey) => void;
  /** Skip the solid fill — for hosts that paint their own (glass) surface. */
  transparent?: boolean;
};

const TABS: { key: TabKey; stroke: any; filled: any; label: string }[] = [
  { key: 'home', stroke: HomeStroke, filled: HomeFilled, label: 'Austausch' },
  { key: 'explore', stroke: DiscoverStroke, filled: DiscoverFilled, label: 'Erkunden' },
  { key: 'profile', stroke: UserStroke, filled: UserFilled, label: 'Profil' },
];

export default function BottomNavigation({ activeTab, onTabPress, transparent = false }: Props) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const { visible: exploreDotVisible, dismiss: dismissExploreDot } = useExploreDot();

  const activeColor = colors.textPrimary;
  const inactiveColor = colors.textPrimary;

  const handlePress = (key: TabKey) => {
    Haptics.selectionAsync().catch(() => {});
    if (key === 'explore' && exploreDotVisible) {
      dismissExploreDot();
    }
    onTabPress(key);
  };

  return (
    <View
      style={[
        styles.container,
        !transparent && { backgroundColor: colors.background },
        { paddingBottom: Math.max(insets.bottom, 8) },
      ]}
    >
      <View style={styles.tabsContainer}>
        {TABS.map((tab) => {
          const isActive = activeTab === tab.key;
          const tintColor = isActive ? activeColor : inactiveColor;
          const Icon = isActive ? tab.filled : tab.stroke;

          return (
            <Pressable
              key={tab.key}
              onPress={() => handlePress(tab.key)}
              style={({ pressed }) => [styles.tab, pressed && styles.tabPressed]}
              hitSlop={8}
            >
              <View style={styles.iconBox}>
                <Icon width={ICON_SIZE} height={ICON_SIZE} color={tintColor} />
                {tab.key === 'explore' && exploreDotVisible && (
                  <View
                    style={[
                      styles.dot,
                      {
                        backgroundColor: colors.primary,
                        borderColor: colors.background,
                      },
                    ]}
                  />
                )}
              </View>
              <Text
                numberOfLines={1}
                style={[styles.label, { color: tintColor }]}
              >
                {tab.label}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    paddingTop: 8,
  },
  tabsContainer: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    alignItems: 'center',
    paddingHorizontal: 16,
  },
  tab: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 4,
    paddingHorizontal: 8,
    minWidth: 64,
  },
  tabPressed: {
    opacity: 0.7,
  },
  iconBox: {
    width: 28,
    height: 28,
    alignItems: 'center',
    justifyContent: 'center',
  },
  label: {
    marginTop: 2,
    fontFamily: fontFamily.medium,
    fontSize: 11,
    lineHeight: 14,
  },
  dot: {
    position: 'absolute',
    top: 0,
    right: 0,
    width: 9,
    height: 9,
    borderRadius: 5,
    borderWidth: 1,
  },
});
