import React, { useState } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import BottomNavigation from '@/components/BottomNavigation';
import { useRouter } from 'expo-router';
import { useTheme } from '@/context/ThemeContext';

export default function LocationScreen() {
  const router = useRouter();
  const { colors } = useTheme();
  const [activeTab, setActiveTab] = useState<'home' | 'explore' | 'map' | 'profile'>('map');

  const handleTabPress = (tab: 'home' | 'explore' | 'map' | 'profile') => {
    setActiveTab(tab);
    if (tab === 'home') router.replace('/');
    else if (tab === 'explore') router.push('/explore');
    else if (tab === 'profile') router.push('/profile');
  };

  return (
    <SafeAreaView
      style={[styles.container, { backgroundColor: colors.background }]}
      edges={['top', 'left', 'right']}
    >
      <View style={styles.content}>
        <Text style={styles.emoji}>🗺️</Text>
        <Text style={[styles.title, { color: colors.textPrimary }]}>Karte nicht verfügbar</Text>
        <Text style={[styles.subtitle, { color: colors.textSecondary }]}>
          Die Karte ist auf Web nicht verfügbar.
        </Text>
      </View>
      <BottomNavigation activeTab={activeTab} onTabPress={handleTabPress} />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { flex: 1, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 40 },
  emoji: { fontSize: 32, marginBottom: 16 },
  title: { fontSize: 20, fontFamily: 'Inter-SemiBold', marginBottom: 8, textAlign: 'center' },
  subtitle: { fontSize: 15, fontFamily: 'Inter-Regular', textAlign: 'center', lineHeight: 22 },
});
