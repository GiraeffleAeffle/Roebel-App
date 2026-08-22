import React, { createContext, useContext, useState, useEffect, useCallback, useMemo, ReactNode } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';

type GovernanceTestContextType = {
  isGovernanceTestEnabled: boolean;
  toggleGovernanceTesting: () => Promise<void>;
};

const GovernanceTestContext = createContext<GovernanceTestContextType | undefined>(undefined);

const GOVERNANCE_TEST_KEY = '@governance_test_enabled';

export function GovernanceTestProvider({ children }: { children: ReactNode }) {
  const [isGovernanceTestEnabled, setIsGovernanceTestEnabled] = useState(false);

  // Load saved state on mount
  useEffect(() => {
    loadGovernanceTestState();
  }, []);

  const loadGovernanceTestState = async () => {
    try {
      const value = await AsyncStorage.getItem(GOVERNANCE_TEST_KEY);
      if (value !== null) {
        setIsGovernanceTestEnabled(value === 'true');
      }
    } catch (error) {
      console.error('Error loading governance test state:', error);
    }
  };

  const toggleGovernanceTesting = useCallback(async () => {
    try {
      const newValue = !isGovernanceTestEnabled;
      await AsyncStorage.setItem(GOVERNANCE_TEST_KEY, String(newValue));
      setIsGovernanceTestEnabled(newValue);
    } catch (error) {
      console.error('Error toggling governance test state:', error);
    }
  }, [isGovernanceTestEnabled]);

  const value = useMemo<GovernanceTestContextType>(
    () => ({ isGovernanceTestEnabled, toggleGovernanceTesting }),
    [isGovernanceTestEnabled, toggleGovernanceTesting]
  );

  return (
    <GovernanceTestContext.Provider value={value}>
      {children}
    </GovernanceTestContext.Provider>
  );
}

export function useGovernanceTest() {
  const context = useContext(GovernanceTestContext);
  if (context === undefined) {
    throw new Error('useGovernanceTest must be used within a GovernanceTestProvider');
  }
  return context;
}
