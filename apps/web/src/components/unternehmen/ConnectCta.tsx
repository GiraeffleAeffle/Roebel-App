"use client";

import { useState } from "react";
import { useConnectModal } from "thirdweb/react";

import { client } from "@/app/client";
import { activeChain } from "@/lib/chains";
import { wallets } from "@/lib/wallet-config";
import { cn } from "@/lib/utils";
import { hasSupabase } from "@/lib/record";

type Variant = "primary" | "secondary" | "primary-light";

const VARIANT_CLASSES: Record<Variant, string> = {
  primary:
    "bg-primary text-primary-foreground hover:bg-primary/90 focus-visible:ring-primary",
  "primary-light":
    "bg-background text-foreground hover:bg-background/90 focus-visible:ring-background",
  secondary:
    "bg-transparent text-foreground border border-foreground/40 hover:bg-foreground/5 focus-visible:ring-foreground",
};

interface ConnectCtaProps {
  label: string;
  variant?: Variant;
  className?: string;
  title?: string;
}

export function ConnectCta({
  label,
  variant = "primary",
  className,
  title = "Bei Röbel/Müritz DAO anmelden",
}: ConnectCtaProps) {
  const { connect, isConnecting } = useConnectModal();
  const [busy, setBusy] = useState(false);

  // No backend means no account creation — never offer a login that dead-ends.
  if (!hasSupabase) return null;

  const handleClick = async () => {
    if (busy || isConnecting) return;
    setBusy(true);
    try {
      await connect({
        client,
        chain: activeChain,
        wallets,
        size: "compact",
        title,
      });
    } catch (err) {
      console.error("Connect failed", err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={busy || isConnecting}
      className={cn(
        "inline-flex items-center justify-center rounded-md px-5 py-3 text-sm font-semibold transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:opacity-60 disabled:cursor-not-allowed",
        VARIANT_CLASSES[variant],
        className,
      )}
    >
      {busy || isConnecting ? "Wird geöffnet…" : label}
    </button>
  );
}
