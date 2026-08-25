"use client";

import { useState, useEffect, useRef } from "react";
import { useActiveAccount } from "thirdweb/react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { useAccount } from "@/lib/context/AccountContext";
import { OpeningHoursEditor } from "@/components/business/OpeningHoursEditor";
import { updateAccount } from "@/lib/supabase-accounts";
import type { OpeningHours } from "@/types/business";
import {
  accountIdentityBinding,
  createAccountBoundDraft,
  resolveAccountBoundDraft,
  runAccountBoundAction,
} from "@/lib/context/account-bound-draft.mjs";

const EMPTY_HOURS: OpeningHours = {};

export default function OrgOpeningHoursPage() {
  const { activeAccount, refreshAccounts, canMutateAccounts } = useAccount();
  const thirdwebAccount = useActiveAccount();
  const currentBinding = accountIdentityBinding(
    thirdwebAccount?.address,
    activeAccount?.id,
  );
  const latestBindingRef = useRef<string | undefined>(currentBinding);
  latestBindingRef.current = currentBinding;
  const [hoursState, setHoursState] = useState(() =>
    createAccountBoundDraft(
      currentBinding,
      activeAccount?.opening_hours ?? EMPTY_HOURS,
    ),
  );
  const [savingState, setSavingState] = useState(() =>
    createAccountBoundDraft(currentBinding, false),
  );
  const draft = resolveAccountBoundDraft(
    currentBinding,
    hoursState,
    EMPTY_HOURS,
  );
  const savingDraft = resolveAccountBoundDraft(
    currentBinding,
    savingState,
    false,
  );
  const hours = draft.value as OpeningHours;
  const saving = savingDraft.current && savingDraft.value;
  const canEdit = Boolean(
    draft.current &&
      currentBinding &&
      latestBindingRef.current === currentBinding &&
      canMutateAccounts,
  );

  useEffect(() => {
    setHoursState(
      createAccountBoundDraft(
        currentBinding,
        activeAccount?.opening_hours ?? EMPTY_HOURS,
      ),
    );
    setSavingState(createAccountBoundDraft(currentBinding, false));
  }, [activeAccount?.opening_hours, currentBinding]);

  if (!activeAccount) return null;

  const updateCurrentHours = (
    nextHours: OpeningHours,
    requestBinding = currentBinding,
  ) => {
    if (
      !requestBinding ||
      latestBindingRef.current !== requestBinding ||
      !draft.current
    ) return;
    setHoursState((previous) =>
      previous.binding === requestBinding
        ? createAccountBoundDraft(requestBinding, nextHours)
        : previous,
    );
  };

  const handleSave = async () => {
    if (!canMutateAccounts) {
      toast.error("Änderungen sind in der Staging-Umgebung deaktiviert");
      return;
    }
    const requestBinding = currentBinding;
    if (!canEdit || !requestBinding) {
      toast.error("Das Organisationskonto hat während der Bearbeitung gewechselt");
      return;
    }
    if (!thirdwebAccount) {
      toast.error("Wallet nicht verbunden");
      return;
    }
    const accountId = activeAccount.id;
    const hoursSnapshot = hours;
    const signingAccount = thirdwebAccount;
    setSavingState(createAccountBoundDraft(requestBinding, true));
    try {
      // Signed write through the org-membership edge function: the server
      // verifies the caller's signature, checks the owner/admin gate, and
      // applies the opening_hours field via its own whitelist — no direct
      // `accounts` table write from the client.
      const outcome = await runAccountBoundAction({
        binding: requestBinding,
        currentBinding: () => latestBindingRef.current,
        action: () => updateAccount(signingAccount, accountId, {
          opening_hours: hoursSnapshot,
        }),
      });
      if (!outcome.current) return;
      await refreshAccounts();
      if (latestBindingRef.current === requestBinding) {
        toast.success("Öffnungszeiten gespeichert.");
      }
    } catch (e) {
      if (latestBindingRef.current === requestBinding) {
        toast.error("Fehler beim Speichern.", {
          description: e instanceof Error ? e.message : undefined,
        });
      }
    } finally {
      if (latestBindingRef.current === requestBinding) {
        setSavingState(createAccountBoundDraft(requestBinding, false));
      }
    }
  };

  return (
    <div className="space-y-6 max-w-3xl">
      <div>
        <h1 className="text-2xl font-medium">Öffnungszeiten</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Optional — leer lassen, falls deine Organisation keine festen Öffnungszeiten hat.
        </p>
      </div>

      <div className="bg-card border border-border rounded-[10px] p-6">
        <OpeningHoursEditor
          value={hours}
          onChange={updateCurrentHours}
          disabled={!canEdit}
        />

        <div className="mt-6 flex justify-end">
          <button
            onClick={handleSave}
            disabled={saving || !canEdit}
            className="inline-flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-lg text-sm font-medium hover:bg-primary/90 disabled:opacity-60"
          >
            {saving && <Loader2 className="h-4 w-4 animate-spin" />}
            Speichern
          </button>
        </div>
      </div>
    </div>
  );
}
