"use client";

import { useEffect, useRef, useState } from "react";
import { useActiveAccount } from "thirdweb/react";
import { useAccount } from "@/lib/context/AccountContext";
import { useUserProfile } from "@/hooks/useUserProfile";
import { updateAccount } from "@/lib/supabase-accounts";
import { ImageUploadDropzone } from "@/components/ui/image-upload-dropzone";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Save, Loader2 } from "lucide-react";
import { toast } from "sonner";
import {
  accountIdentityBinding,
  createAccountBoundDraft,
  resolveAccountBoundDraft,
  runAccountBoundAction,
} from "@/lib/context/account-bound-draft.mjs";

const EMPTY_FORM = {
  name: "",
  bio: "",
  avatar_url: "",
  cover_url: "",
};

function accountForm(account: {
  name?: string | null;
  bio?: string | null;
  avatar_url?: string | null;
  cover_url?: string | null;
} | null) {
  return account
    ? {
        name: account.name ?? "",
        bio: account.bio ?? "",
        avatar_url: account.avatar_url ?? "",
        cover_url: account.cover_url ?? "",
      }
    : EMPTY_FORM;
}

export default function OrgProfilePage() {
  const {
    activeAccount,
    refreshAccounts,
    isOwnerOf,
    canMutateAccounts,
  } = useAccount();
  const thirdwebAccount = useActiveAccount();
  const { canPersistProfile } = useUserProfile();
  const currentBinding = accountIdentityBinding(
    thirdwebAccount?.address,
    activeAccount?.id,
  );
  const latestBindingRef = useRef<string | undefined>(currentBinding);
  latestBindingRef.current = currentBinding;
  const [formState, setFormState] = useState(() =>
    createAccountBoundDraft(currentBinding, accountForm(activeAccount)),
  );
  const [savingState, setSavingState] = useState(() =>
    createAccountBoundDraft(currentBinding, false),
  );
  const draft = resolveAccountBoundDraft(
    currentBinding,
    formState,
    EMPTY_FORM,
  );
  const savingDraft = resolveAccountBoundDraft(
    currentBinding,
    savingState,
    false,
  );
  const form = draft.value;
  const saving = savingDraft.current && savingDraft.value;
  const canEdit = Boolean(
    draft.current &&
      currentBinding &&
      latestBindingRef.current === currentBinding &&
      canPersistProfile &&
      canMutateAccounts &&
      isOwnerOf(activeAccount?.id || null),
  );

  useEffect(() => {
    setFormState(
      createAccountBoundDraft(currentBinding, accountForm(activeAccount)),
    );
    setSavingState(createAccountBoundDraft(currentBinding, false));
  }, [
    activeAccount?.avatar_url,
    activeAccount?.bio,
    activeAccount?.cover_url,
    activeAccount?.name,
    currentBinding,
  ]);

  if (!activeAccount) return null;

  const updateCurrentDraft = (
    updates: Partial<typeof EMPTY_FORM>,
    requestBinding = currentBinding,
  ) => {
    if (
      !requestBinding ||
      latestBindingRef.current !== requestBinding ||
      !draft.current
    ) return;
    setFormState((previous) =>
      previous.binding === requestBinding
        ? createAccountBoundDraft(requestBinding, {
            ...previous.value,
            ...updates,
          })
        : previous,
    );
  };

  const handleSave = async () => {
    const requestBinding = currentBinding;
    if (!canEdit || !requestBinding) {
      toast.error("Staging-Gastprofile oder fremde Organisationen können nicht geändert werden");
      return;
    }
    if (!form.name.trim()) {
      toast.error("Name darf nicht leer sein");
      return;
    }
    if (!thirdwebAccount) {
      toast.error("Wallet nicht verbunden");
      return;
    }
    const accountId = activeAccount.id;
    const formSnapshot = form;
    const signingAccount = thirdwebAccount;
    setSavingState(createAccountBoundDraft(requestBinding, true));
    const t = toast.loading("Profil wird gespeichert...");
    try {
      const outcome = await runAccountBoundAction({
        binding: requestBinding,
        currentBinding: () => latestBindingRef.current,
        action: () => updateAccount(signingAccount, accountId, {
          name: formSnapshot.name.trim(),
          bio: formSnapshot.bio.trim() || null,
          avatar_url: formSnapshot.avatar_url || null,
          cover_url: formSnapshot.cover_url || null,
        }),
      });
      if (!outcome.current) {
        toast.dismiss(t);
        return;
      }
      await refreshAccounts();
      if (latestBindingRef.current !== requestBinding) {
        toast.dismiss(t);
        return;
      }
      toast.success("Profil gespeichert", { id: t });
    } catch (e) {
      if (latestBindingRef.current === requestBinding) {
        toast.error("Fehler beim Speichern", {
          id: t,
          description: e instanceof Error ? e.message : undefined,
        });
      } else {
        toast.dismiss(t);
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
        <h1 className="text-2xl font-medium">Profil</h1>
        <p className="text-sm text-muted-foreground mt-1">
          So sehen Bürger:innen deine Organisation in der App.
        </p>
      </div>

      <div className="bg-card border border-border rounded-[10px] p-6 space-y-6">
        <div>
          <Label htmlFor="name">Name *</Label>
          <Input
            id="name"
            value={form.name}
            onChange={(e) => updateCurrentDraft({ name: e.target.value })}
            disabled={!draft.current}
            className="mt-1"
            required
          />
        </div>

        <div>
          <Label htmlFor="bio">Beschreibung</Label>
          <Textarea
            id="bio"
            rows={4}
            value={form.bio}
            onChange={(e) => updateCurrentDraft({ bio: e.target.value })}
            disabled={!draft.current}
            className="mt-1"
            placeholder="Kurze Beschreibung — wofür steht die Organisation?"
          />
        </div>

        <div>
          <Label>Profilbild</Label>
          <div className="mt-2">
            <ImageUploadDropzone
              key={`avatar-${currentBinding ?? "none"}`}
              bucketName="blog-images"
              currentImageUrl={form.avatar_url}
              onUploadComplete={(url) => updateCurrentDraft(
                { avatar_url: url },
                currentBinding,
              )}
              maxSizeMB={5}
              canUpload={canEdit}
            />
          </div>
        </div>

        <div>
          <Label>Titelbild</Label>
          <div className="mt-2">
            <ImageUploadDropzone
              key={`cover-${currentBinding ?? "none"}`}
              bucketName="blog-images"
              currentImageUrl={form.cover_url}
              onUploadComplete={(url) => updateCurrentDraft(
                { cover_url: url },
                currentBinding,
              )}
              maxSizeMB={5}
              canUpload={canEdit}
            />
          </div>
        </div>
      </div>

      <div className="flex justify-end">
        <Button
          onClick={handleSave}
          disabled={saving || !canEdit}
        >
          {saving ? (
            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
          ) : (
            <Save className="h-4 w-4 mr-2" />
          )}
          Speichern
        </Button>
      </div>
    </div>
  );
}
