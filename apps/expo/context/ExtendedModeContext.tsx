import React, { createContext, useContext, useState, useEffect, useCallback, useMemo, ReactNode } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';

type ExtendedModeContextType = {
  isExtendedMode: boolean;
  toggleExtendedMode: () => Promise<void>;
};

const ExtendedModeContext = createContext<ExtendedModeContextType | undefined>(undefined);

const EXTENDED_MODE_KEY = '@extended_mode_enabled';

export function ExtendedModeProvider({ children }: { children: ReactNode }) {
  const [isExtendedMode, setIsExtendedMode] = useState(false);

  useEffect(() => {
    loadExtendedModeState();
  }, []);

  const loadExtendedModeState = async () => {
    try {
      const value = await AsyncStorage.getItem(EXTENDED_MODE_KEY);
      if (value !== null) {
        setIsExtendedMode(value === 'true');
      }
    } catch (error) {
      console.error('Error loading extended mode state:', error);
    }
  };

  const toggleExtendedMode = useCallback(async () => {
    try {
      const newValue = !isExtendedMode;
      await AsyncStorage.setItem(EXTENDED_MODE_KEY, String(newValue));
      setIsExtendedMode(newValue);
    } catch (error) {
      console.error('Error toggling extended mode state:', error);
    }
  }, [isExtendedMode]);

  const value = useMemo<ExtendedModeContextType>(
    () => ({ isExtendedMode, toggleExtendedMode }),
    [isExtendedMode, toggleExtendedMode]
  );

  return (
    <ExtendedModeContext.Provider value={value}>
      {children}
    </ExtendedModeContext.Provider>
  );
}

const defaultValue: ExtendedModeContextType = {
  isExtendedMode: false,
  toggleExtendedMode: async () => {},
};

export function useExtendedMode() {
  const context = useContext(ExtendedModeContext);
  // Return safe default during initial mount before provider is ready
  return context ?? defaultValue;
}
