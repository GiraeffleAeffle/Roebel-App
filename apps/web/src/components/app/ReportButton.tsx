"use client";

import { useState, useTransition } from "react";
import { Flag } from "lucide-react";
import { reportPost } from "@/app/actions/posts";
import { toast } from "sonner";
import { hasSupabase } from "@/lib/record";

interface ReportButtonProps {
  postId: string;
  isReported: boolean;
  walletAddress?: string;
}

export function ReportButton({ postId, isReported: initialIsReported, walletAddress }: ReportButtonProps) {
  const [isReported, setIsReported] = useState(initialIsReported);
  const [isPending, startTransition] = useTransition();

  const handleReport = () => {
    if (!walletAddress || isReported || isPending) return;

    startTransition(async () => {
      const result = await reportPost(postId, walletAddress);
      if (result.success) {
        setIsReported(true);
        toast.success("Beitrag wurde gemeldet");
      } else {
        toast.error(result.error || "Fehler beim Melden");
      }
    });
  };

  return (
    <button
      onClick={handleReport}
      disabled={!walletAddress || isReported || isPending}
      className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm transition-colors ${
        isReported
          ? "text-orange-500"
          : "text-muted-foreground hover:text-orange-500 hover:bg-orange-50 dark:hover:bg-orange-950"
      } disabled:cursor-not-allowed`}
      aria-label={isReported ? "Bereits gemeldet" : "Beitrag melden"}
      title={
        !hasSupabase
          ? "Nur Lesen — ohne Backend nicht verfügbar"
          : isReported
            ? "Bereits gemeldet"
            : "Melden"
      }
    >
      <Flag className={`h-4 w-4 ${isReported ? "fill-current" : ""}`} />
    </button>
  );
}
