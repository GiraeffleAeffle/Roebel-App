"use client";

import { useState, useTransition } from "react";
import { Heart } from "lucide-react";
import { toggleLike } from "@/app/actions/posts";
import { hasSupabase } from "@/lib/record";

interface LikeButtonProps {
  postId: string;
  isLiked: boolean;
  likesCount: number;
  walletAddress?: string;
}

export function LikeButton({
  postId,
  isLiked: initialIsLiked,
  likesCount: initialCount,
  walletAddress,
}: LikeButtonProps) {
  const [isLiked, setIsLiked] = useState(initialIsLiked);
  const [count, setCount] = useState(initialCount);
  const [isAnimating, setIsAnimating] = useState(false);
  const [isPending, startTransition] = useTransition();

  const handleToggle = () => {
    if (!walletAddress || isPending) return;

    // Optimistic update
    const newLiked = !isLiked;
    setIsLiked(newLiked);
    setCount((prev) => (newLiked ? prev + 1 : Math.max(prev - 1, 0)));

    if (newLiked) {
      setIsAnimating(true);
      setTimeout(() => setIsAnimating(false), 300);
    }

    startTransition(async () => {
      const result = await toggleLike(postId, walletAddress);
      if (result.success && result.data) {
        setIsLiked(result.data.liked);
        setCount(result.data.newCount);
      } else {
        // Rollback on error
        setIsLiked(!newLiked);
        setCount((prev) => (newLiked ? prev - 1 : prev + 1));
      }
    });
  };

  return (
    <button
      onClick={handleToggle}
      disabled={!walletAddress}
      className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm transition-colors ${
        isLiked
          ? "text-red-500 hover:bg-red-50 dark:hover:bg-red-950"
          : "text-muted-foreground hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-950"
      } ${!walletAddress ? "opacity-50 cursor-not-allowed" : ""}`}
      aria-label={isLiked ? "Gefällt mir nicht mehr" : "Gefällt mir"}
      title={!hasSupabase ? "Nur Lesen — ohne Backend nicht verfügbar" : undefined}
    >
      <Heart
        className={`h-4 w-4 transition-transform ${
          isAnimating ? "scale-125" : "scale-100"
        }`}
        fill={isLiked ? "currentColor" : "none"}
      />
      {count > 0 && <span>{count}</span>}
    </button>
  );
}
