import React, { createContext, useContext, useState, useEffect, useCallback, useMemo, ReactNode } from 'react';
import { useColorScheme } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { colors, ColorTokens } from '@/constants/theme';

export type ThemePreference = 'system' | 'light' | 'dark';
type EffectiveTheme = 'light' | 'dark';

type ThemeContextType = {
  preference: ThemePreference;
  effectiveTheme: EffectiveTheme;
  colors: ColorTokens;
  isDark: boolean;
  setPreference: (pref: ThemePreference) => Promise<void>;
};

const THEME_PREFERENCE_KEY = '@theme_preference';

const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const systemScheme = useColorScheme() ?? 'light';
  const [preference, setPreferenceState] = useState<ThemePreference>('system');
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    AsyncStorage.getItem(THEME_PREFERENCE_KEY).then((val) => {
      if (val === 'light' || val === 'dark' || val === 'system') {
        setPreferenceState(val);
      }
      setLoaded(true);
    });
  }, []);

  const effectiveTheme: EffectiveTheme =
    preference === 'system' ? systemScheme : preference;

  const setPreference = useCallback(async (pref: ThemePreference) => {
    await AsyncStorage.setItem(THEME_PREFERENCE_KEY, pref);
    setPreferenceState(pref);
  }, []);

  const value: ThemeContextType = useMemo(
    () => ({
      preference,
      effectiveTheme,
      colors: colors[effectiveTheme],
      isDark: effectiveTheme === 'dark',
      setPreference,
    }),
    [preference, effectiveTheme, setPreference]
  );

  if (!loaded) return null;

  return (
    <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
  );
}

const defaultTheme: ThemeContextType = {
  preference: 'system',
  effectiveTheme: 'light',
  colors: colors.light,
  isDark: false,
  setPreference: async () => {},
};

export function useTheme() {
  const ctx = useContext(ThemeContext);
  // Return safe default during initial mount before provider is ready
  return ctx ?? defaultTheme;
}
