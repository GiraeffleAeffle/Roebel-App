"use client";

import { useId, useState, type FormEvent } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";

interface StagingParticipantEnrollmentProps {
  className?: string;
  isEnrolling: boolean;
  enroll: (
    inviteToken?: string
  ) => Promise<{ success: boolean; error?: string }>;
}

export function StagingParticipantEnrollment({
  className,
  isEnrolling,
  enroll,
}: StagingParticipantEnrollmentProps) {
  const inputId = useId();
  const [open, setOpen] = useState(false);
  const [inviteToken, setInviteToken] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const busy = isEnrolling || isSubmitting;

  const changeOpen = (nextOpen: boolean) => {
    if (busy) return;
    setOpen(nextOpen);
    if (!nextOpen) {
      setInviteToken("");
      setError(null);
    }
  };

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (busy) return;
    setIsSubmitting(true);
    setError(null);
    try {
      const result = await enroll(inviteToken.trim() || undefined);
      if (result.success) {
        toast.success("Staging-Testteilnahme aktiviert");
        setOpen(false);
        setInviteToken("");
        return;
      }
      setError(result.error || "Staging-Testteilnahme fehlgeschlagen");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={changeOpen}>
      <DialogTrigger asChild>
        <button type="button" disabled={busy} className={className}>
          Staging-Testteilnahme aktivieren
        </button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Staging-Testteilnahme aktivieren</DialogTitle>
          <DialogDescription>
            Die Einladung wird nur für diese Anmeldung verwendet. Anschließend
            bestätigst du die Teilnahme mit deiner verbundenen Wallet.
          </DialogDescription>
        </DialogHeader>
        <form className="space-y-4" onSubmit={submit}>
          <div className="space-y-2">
            <label htmlFor={inputId} className="text-sm font-medium">
              Staging-Einladung
            </label>
            <Input
              id={inputId}
              type="password"
              value={inviteToken}
              onChange={(event) => {
                setInviteToken(event.target.value);
                setError(null);
              }}
              autoComplete="off"
              autoFocus
              disabled={busy}
            />
          </div>
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={busy}
              onClick={() => changeOpen(false)}
            >
              Abbrechen
            </Button>
            <Button type="submit" disabled={busy}>
              {busy ? "Teilnahme wird aktiviert …" : "Teilnahme aktivieren"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
