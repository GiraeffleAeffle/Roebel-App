"use client";

import { useEffect, useState } from "react";
import { useActiveAccount } from "thirdweb/react";
import { useAccount } from "@/lib/context/AccountContext";
import { updateAccount } from "@/lib/supabase-accounts";
import { ImageUploadDropzone } from "@/components/ui/image-upload-dropzone";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Save, Loader2 } from "lucide-react";
import { toast } from "sonner";

export default function OrgProfilePage() {
  const { activeAccount, refreshAccounts } = useAccount();
  const thirdwebAccount = useActiveAccount();
  const [form, setForm] = useState({
    name: "",
    bio: "",
    avatar_url: "",
    cover_url: "",
  });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!activeAccount) return;
    setForm({
      name: activeAccount.name ?? "",
      bio: activeAccount.bio ?? "",
      avatar_url: activeAccount.avatar_url ?? "",
      cover_url: activeAccount.cover_url ?? "",
    });
  }, [activeAccount]);

  if (!activeAccount) return null;

  const handleSave = async () => {
    if (!form.name.trim()) {
      toast.error("Name darf nicht leer sein");
      return;
    }
    if (!thirdwebAccount) {
      toast.error("Wallet nicht verbunden");
      return;
    }
    setSaving(true);
    const t = toast.loading("Profil wird gespeichert...");
    try {
      await updateAccount(thirdwebAccount, activeAccount.id, {
        name: form.name.trim(),
        bio: form.bio.trim() || null,
        avatar_url: form.avatar_url || null,
        cover_url: form.cover_url || null,
      });
      await refreshAccounts();
      toast.success("Profil gespeichert", { id: t });
    } catch (e) {
      toast.error("Fehler beim Speichern", {
        id: t,
        description: e instanceof Error ? e.message : undefined,
      });
    } finally {
      setSaving(false);
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
            onChange={(e) => setForm({ ...form, name: e.target.value })}
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
            onChange={(e) => setForm({ ...form, bio: e.target.value })}
            className="mt-1"
            placeholder="Kurze Beschreibung — wofür steht die Organisation?"
          />
        </div>

        <div>
          <Label>Profilbild</Label>
          <div className="mt-2">
            <ImageUploadDropzone
              bucketName="blog-images"
              currentImageUrl={form.avatar_url}
              onUploadComplete={(url) => setForm({ ...form, avatar_url: url })}
              maxSizeMB={5}
            />
          </div>
        </div>

        <div>
          <Label>Titelbild</Label>
          <div className="mt-2">
            <ImageUploadDropzone
              bucketName="blog-images"
              currentImageUrl={form.cover_url}
              onUploadComplete={(url) => setForm({ ...form, cover_url: url })}
              maxSizeMB={5}
            />
          </div>
        </div>
      </div>

      <div className="flex justify-end">
        <Button onClick={handleSave} disabled={saving}>
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
