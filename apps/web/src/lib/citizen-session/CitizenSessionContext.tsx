"use client";

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  type ReactNode,
} from "react";
import { useActiveAccount } from "thirdweb/react";
import { useAccount } from "@/lib/context/AccountContext";
import { createThirdwebCitizenSession } from "./thirdweb-adapter";
import type { CitizenSession } from "./session";

const CitizenSessionContext = createContext<CitizenSession | null>(null);

export function CitizenSessionProvider({ children }: { children: ReactNode }) {
  const credential = useActiveAccount();
  const { activeAccount } = useAccount();

  const session = useMemo(
    () =>
      credential
        ? createThirdwebCitizenSession({
            account: credential,
            memberId: null,
            appAccountId: activeAccount?.id ?? null,
          })
        : null,
    [credential, activeAccount?.id]
  );

  useEffect(() => () => session?.dispose(), [session]);

  return (
    <CitizenSessionContext.Provider value={session}>
      {children}
    </CitizenSessionContext.Provider>
  );
}

export function useCitizenSession(): CitizenSession | null {
  return useContext(CitizenSessionContext);
}
