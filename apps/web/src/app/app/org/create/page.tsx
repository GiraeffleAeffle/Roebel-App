"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useActiveAccount } from "thirdweb/react";
import { useAccount } from "@/lib/context/AccountContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ArrowRight, Loader2, Store } from "lucide-react";
import { toast } from "sonner";
import {
  SUB_TYPE_LABELS,
  SUB_TYPE_EMOJI,
  type OrgSubType,
} from "@/types/account";

// Self-service sub_types only — the org-membership edge function's
// create_account action rejects 'stadt'/'fraktion' (administrator-issued
// only, via the service role), so offering them here would just produce a
// BAD_REQUEST for anyone who picks them.
const ORG_SUB_TYPES: OrgSubType[] = [
  "unternehmen",
  "restaurant",
  "verein",
  "journalist",
];

export default function CreateOrgPage() {
  const router = useRouter();
  const wallet = useActiveAccount();
  const { createOrgAccount, switchAccount } = useAccount();

  const [submitting, setSubmitting] = useState(false);
  const [form, setForm] = useState({
    name: "",
    sub_type: "unternehmen" as OrgSubType,
    bio: "",
    contact_email: "",
    reason: "",
    is_extern: false,
  });

  if (!wallet?.address) {
    return (
      <div className="max-w-md mx-auto py-12 px-4 text-center">
        <div className="w-12 h-12 rounded-full bg-muted mx-auto mb-4 flex items-center justify-center">
          <Store className="h-5 w-5 text-muted-foreground" />
        </div>
        <h1 className="text-lg font-semibold">Wallet nicht verbunden</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Verbinde deine Wallet, um eine Organisation zu erstellen.
        </p>
      </div>
    );
  }

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name.trim() || !form.sub_type) {
      toast.error("Bitte alle Pflichtfelder ausfüllen");
      return;
    }
    setSubmitting(true);
    const t = toast.loading("Organisation wird angelegt...");
    try {
      const account = await createOrgAccount(form.sub_type, form.name.trim(), {
        isExtern: form.is_extern,
        contactEmail: form.contact_email.trim() || null,
        reason: form.reason.trim() || null,
        bio: form.bio.trim() || null,
      });
      await switchAccount(account.id);
      if (form.is_extern) {
        toast.success("Antrag eingereicht", {
          id: t,
          description:
            "Dein externes Konto wartet auf Freigabe durch das Röbel-Team.",
        });
      } else {
        toast.success("Organisation angelegt", { id: t });
      }
      router.push("/dashboard");
    } catch (err) {
      toast.error("Fehler beim Anlegen", {
        id: t,
        description: err instanceof Error ? err.message : undefined,
      });
      setSubmitting(false);
    }
  };

  return (
    <div className="max-w-2xl mx-auto py-8 px-4">
      <h1 className="text-2xl font-medium">Organisation anlegen</h1>
      <p className="text-sm text-muted-foreground mt-1">
        Erstelle ein neues Organisationskonto. Externe (nicht-Röbel)
        Antragsteller werden vom Röbel-Team freigegeben.
      </p>

      <form
        onSubmit={submit}
        className="mt-6 space-y-5 bg-card border border-border rounded-[10px] p-6"
      >
        <div>
          <Label htmlFor="name">Name *</Label>
          <Input
            id="name"
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            required
            className="mt-1"
            placeholder="z. B. SV Röbel/Müritz"
          />
        </div>

        <div>
          <Label>Typ *</Label>
          <Select
            value={form.sub_type}
            onValueChange={(v) =>
              setForm({ ...form, sub_type: v as OrgSubType })
            }
          >
            <SelectTrigger className="mt-1">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {ORG_SUB_TYPES.map((s) => (
                <SelectItem key={s} value={s}>
                  {SUB_TYPE_EMOJI[s]} {SUB_TYPE_LABELS[s]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div>
          <Label htmlFor="bio">Beschreibung (optional)</Label>
          <Textarea
            id="bio"
            rows={3}
            value={form.bio}
            onChange={(e) => setForm({ ...form, bio: e.target.value })}
            className="mt-1"
            placeholder="Wofür steht die Organisation?"
          />
        </div>

        <label className="flex items-start gap-3 p-4 rounded-lg border border-border cursor-pointer hover:bg-accent">
          <input
            type="checkbox"
            checked={form.is_extern}
            onChange={(e) =>
              setForm({ ...form, is_extern: e.target.checked })
            }
            className="mt-1"
          />
          <div className="flex-1">
            <p className="text-sm font-medium">
              Externe Organisation (nicht aus Röbel)
            </p>
            <p className="text-xs text-muted-foreground mt-0.5">
              Wenn aktiviert, wird dein Antrag manuell vom Röbel-Team geprüft.
              Veröffentlichen ist erst nach Freigabe möglich.
            </p>
          </div>
        </label>

        {form.is_extern && (
          <>
            <div>
              <Label htmlFor="contact_email">Kontakt-E-Mail (empfohlen)</Label>
              <Input
                id="contact_email"
                type="email"
                value={form.contact_email}
                onChange={(e) =>
                  setForm({ ...form, contact_email: e.target.value })
                }
                className="mt-1"
                placeholder="redaktion@..."
              />
              <p className="text-xs text-muted-foreground mt-1">
                Wir benachrichtigen dich per E-Mail, sobald dein Konto
                freigegeben wird.
              </p>
            </div>
            <div>
              <Label htmlFor="reason">Worum geht es? (optional)</Label>
              <Textarea
                id="reason"
                rows={3}
                value={form.reason}
                onChange={(e) => setForm({ ...form, reason: e.target.value })}
                className="mt-1"
                placeholder="Kurz: warum möchtest du auf der Röbel App veröffentlichen?"
              />
            </div>
          </>
        )}

        <Button type="submit" disabled={submitting} className="w-full">
          {submitting ? (
            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
          ) : (
            <ArrowRight className="h-4 w-4 mr-2" />
          )}
          {form.is_extern ? "Antrag senden" : "Organisation anlegen"}
        </Button>
      </form>
    </div>
  );
}
