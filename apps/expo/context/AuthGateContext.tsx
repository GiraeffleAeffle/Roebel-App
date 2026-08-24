import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { useActiveAccount } from 'thirdweb/react';
import LoginDrawer from '@/components/LoginDrawer';

type AuthGateValue = {
  requireAuth: (action: () => void) => void;
};

const AuthGateContext = createContext<AuthGateValue | null>(null);

export function AuthGateProvider({ children }: { children: React.ReactNode }) {
  const account = useActiveAccount();
  const address = account?.address;

  const pendingActionRef = useRef<(() => void) | null>(null);
  const prevAddressRef = useRef<string | undefined>(address);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const wasSignedOut = !prevAddressRef.current;
    const isNowSignedIn = !!address;
    prevAddressRef.current = address;

    if (wasSignedOut && isNowSignedIn && pendingActionRef.current) {
      const action = pendingActionRef.current;
      pendingActionRef.current = null;
      setVisible(false);
      action();
    }
  }, [address]);

  const requireAuth = useCallback(
    (action: () => void) => {
      if (address) {
        action();
        return;
      }
      pendingActionRef.current = action;
      setVisible(true);
    },
    [address]
  );

  const onClose = useCallback(() => {
    pendingActionRef.current = null;
    setVisible(false);
  }, []);

  const value = useMemo<AuthGateValue>(() => ({ requireAuth }), [requireAuth]);

  return (
    <AuthGateContext.Provider value={value}>
      {children}
      <LoginDrawer visible={visible} onClose={onClose} />
    </AuthGateContext.Provider>
  );
}

export function useRequireAuth(): (action: () => void) => void {
  const ctx = useContext(AuthGateContext);
  if (!ctx) {
    throw new Error('useRequireAuth must be used within AuthGateProvider');
  }
  return ctx.requireAuth;
}
