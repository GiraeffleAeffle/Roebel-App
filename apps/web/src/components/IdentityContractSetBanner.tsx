"use client";

import { useEffect, useState } from "react";
import { identityContractSet } from "@/lib/identity-contract-set";

export function IdentityContractSetBanner() {
  const [runtimeConfigReady, setRuntimeConfigReady] = useState(false);
  useEffect(() => setRuntimeConfigReady(true), []);

  if (!runtimeConfigReady) return null;
  if (!identityContractSet.isTest) return null;

  const shortAddress = `${identityContractSet.citizenNFT.slice(0, 6)}…${identityContractSet.citizenNFT.slice(-4)}`;
  return (
    <div
      role="status"
      className="sticky top-0 z-[100] border-b border-amber-400 bg-amber-100 px-4 py-2 text-center text-xs font-semibold text-amber-950 shadow-sm"
      data-identity-contract-set={identityContractSet.id}
      data-authority-binding={identityContractSet.authorityBinding}
    >
      🧪 {identityContractSet.warning} Vertrag: {shortAddress}
    </div>
  );
}
