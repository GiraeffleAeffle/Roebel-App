import React, { createContext, useContext, useState, useEffect, useCallback, useMemo, ReactNode } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';

// Entwicklermodus: schaltet in den Einstellungen die Mini-App-Vorschau frei
// (eigene Mini-App per URL im echten Host-WebView testen, ohne Store-Eintrag).
type DeveloperModeContextType = {
  isDeveloperMode: boolean;
  toggleDeveloperMode: () => Promise<void>;
};

const DeveloperModeContext = createContext<DeveloperModeContextType | undefined>(undefined);

const DEVELOPER_MODE_KEY = '@developer_mode_enabled';

export function DeveloperModeProvider({ children }: { children: ReactNode }) {
  const [isDeveloperMode, setIsDeveloperMode] = useState(false);

  useEffect(() => {
    loadDeveloperModeState();
  }, []);

  const loadDeveloperModeState = async () => {
    try {
      const value = await AsyncStorage.getItem(DEVELOPER_MODE_KEY);
      if (value !== null) {
        setIsDeveloperMode(value === 'true');
      }
    } catch (error) {
      console.error('Error loading developer mode state:', error);
    }
  };

  const toggleDeveloperMode = useCallback(async () => {
    try {
      const newValue = !isDeveloperMode;
      await AsyncStorage.setItem(DEVELOPER_MODE_KEY, String(newValue));
      setIsDeveloperMode(newValue);
    } catch (error) {
      console.error('Error toggling developer mode state:', error);
    }
  }, [isDeveloperMode]);

  const value = useMemo<DeveloperModeContextType>(
    () => ({ isDeveloperMode, toggleDeveloperMode }),
    [isDeveloperMode, toggleDeveloperMode]
  );

  return (
    <DeveloperModeContext.Provider value={value}>
      {children}
    </DeveloperModeContext.Provider>
  );
}

const defaultValue: DeveloperModeContextType = {
  isDeveloperMode: false,
  toggleDeveloperMode: async () => {},
};

export function useDeveloperMode() {
  const context = useContext(DeveloperModeContext);
  // Return safe default during initial mount before provider is ready
  return context ?? defaultValue;
}
