"use client";

import { useState, useEffect, useRef } from "react";
import { Heart } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useActiveAccount } from "thirdweb/react";
import { createClient } from "@/lib/supabase/client";
import { hasSupabase } from "@/lib/record";

interface EventInterestButtonProps {
  eventId: string;
  initialCount?: number;
  initialIsInterested?: boolean;
  variant?: "card" | "detail";
}

export function EventInterestButton({
  eventId,
  initialCount = 0,
  initialIsInterested = false,
  variant = "card",
}: EventInterestButtonProps) {
  const account = useActiveAccount();
  const [isInterested, setIsInterested] = useState(initialIsInterested);
  const [interestCount, setInterestCount] = useState(initialCount);
  const [toggling, setToggling] = useState(false);
  const hasFetched = useRef(false);

  // Fetch user's interest state on mount (needed when server can't pre-populate)
  useEffect(() => {
    if (!account?.address || hasFetched.current) return;
    hasFetched.current = true;

    async function fetchInterestState() {
      const supabase = createClient();

      const { data } = await supabase
        .from("event_interests")
        .select("id")
        .eq("event_id", eventId)
        .eq("user_wallet", account!.address)
        .maybeSingle();

      if (data) {
        setIsInterested(true);
      }
    }

    fetchInterestState();
  }, [account?.address, eventId]);

  const handleToggle = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();

    if (!account?.address || toggling) return;

    setToggling(true);

    const wasInterested = isInterested;
    setIsInterested(!wasInterested);
    setInterestCount((c) => (wasInterested ? c - 1 : c + 1));

    try {
      const supabase = createClient();

      if (wasInterested) {
        await supabase
          .from("event_interests")
          .delete()
          .eq("event_id", eventId)
          .eq("user_wallet", account.address);
      } else {
        await supabase.from("event_interests").insert({
          event_id: eventId,
          user_wallet: account.address,
        });
      }
    } catch {
      setIsInterested(wasInterested);
      setInterestCount((c) => (wasInterested ? c + 1 : c - 1));
    } finally {
      setToggling(false);
    }
  };

  if (variant === "detail") {
    return (
      <Button
        variant={isInterested ? "default" : "outline"}
        className="w-full rounded-lg"
        onClick={handleToggle}
        disabled={!account?.address || toggling}
        title={!hasSupabase ? "Nur Lesen — ohne Backend nicht verfügbar" : undefined}
      >
        <Heart
          className={`h-4 w-4 mr-2 ${isInterested ? "fill-current" : ""}`}
        />
        {isInterested ? "Interessiert!" : "Interessiert?"}
        {interestCount > 0 && (
          <span className="ml-1">({interestCount})</span>
        )}
      </Button>
    );
  }

  return (
    <Button
      variant={isInterested ? "default" : "outline"}
      size="sm"
      className="w-full mt-1 rounded-lg text-xs h-8"
      onClick={handleToggle}
      disabled={!account?.address || toggling}
      title={!hasSupabase ? "Nur Lesen — ohne Backend nicht verfügbar" : undefined}
    >
      <Heart
        className={`h-3.5 w-3.5 mr-1 ${isInterested ? "fill-current" : ""}`}
      />
      {isInterested ? "Interessiert!" : "Interessiert?"}
      {interestCount > 0 && (
        <span className="ml-1">({interestCount})</span>
      )}
    </Button>
  );
}
