"use client";

/**
 * Event-specific flyer generator, embedded on the event edit page. Uses ALL the
 * event's data as copy context (via draftFlyerCopyAction(eventId)) and, by
 * default, the event's own image as the gpt-image-1 reference. One click can set
 * the result as the event's cover image.
 */

import { useCallback, useState } from "react";
import { useActiveAccount } from "thirdweb/react";
import {
  draftFlyerCopyAction,
  generateFlyerAction,
  attachFlyerToEvent,
  postFlyerToFeed,
} from "@/app/actions/flyer";
import { FLYER_STYLES } from "@/lib/flyer/styles";
import { downloadImage, slugForFile, printFlyer, COPY_FIELDS } from "@/lib/flyer/ui";
import type { FlyerCopy } from "@/lib/flyer/copy";
import type { Flyer } from "@/types/flyer";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Loader2,
  Sparkles,
  Wand2,
  Download,
  Printer,
  Share2,
  ImageIcon,
} from "lucide-react";
import { toast } from "sonner";

interface Props {
  accountId: string;
  eventId: string;
  eventTitle: string;
  eventImageUrl?: string | null;
}

export function EventFlyerGenerator({ accountId, eventId, eventTitle, eventImageUrl }: Props) {
  const wallet = useActiveAccount();
  const walletAddress = wallet?.address ?? null;

  const [styleId, setStyleId] = useState("festlich");
  const [note, setNote] = useState("");
  const [useEventImage, setUseEventImage] = useState(!!eventImageUrl);
  const [copy, setCopy] = useState<FlyerCopy | null>(null);
  const [drafting, setDrafting] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [preview, setPreview] = useState<Flyer | null>(null);
  const [busy, setBusy] = useState(false);

  const patchCopy = useCallback((key: keyof FlyerCopy, value: string) => {
    setCopy((c) => (c ? { ...c, [key]: value } : c));
  }, []);

  const handleDraft = useCallback(async () => {
    if (!walletAddress) return;
    setDrafting(true);
    const res = await draftFlyerCopyAction(accountId, walletAddress, note, styleId, eventId);
    setDrafting(false);
    if (!res.success || !res.copy) {
      toast.error(res.error ?? "Text konnte nicht entworfen werden");
      return;
    }
    setCopy(res.copy);
    toast.success("Textentwurf fertig — passt ihn an und erstellt den Flyer.");
  }, [walletAddress, accountId, note, styleId, eventId]);

  const handleGenerate = useCallback(async () => {
    if (!walletAddress || !copy) return;
    setGenerating(true);
    const res = await generateFlyerAction(accountId, walletAddress, {
      title: copy.headline || eventTitle,
      brief: note,
      copy,
      style: styleId,
      eventId,
      referenceUrl: useEventImage ? eventImageUrl ?? null : null,
    });
    setGenerating(false);
    if (!res.success || !res.flyer) {
      toast.error(res.error ?? "Flyer konnte nicht erstellt werden");
      return;
    }
    setPreview(res.flyer);
    toast.success("Flyer erstellt!");
  }, [walletAddress, accountId, copy, note, styleId, eventId, useEventImage, eventImageUrl, eventTitle]);

  const handleSetCover = useCallback(async () => {
    if (!walletAddress || !preview) return;
    setBusy(true);
    const res = await attachFlyerToEvent(accountId, walletAddress, preview.id, eventId);
    setBusy(false);
    if (!res.success) toast.error(res.error ?? "Konnte nicht gesetzt werden");
    else toast.success("Als Event-Bild gesetzt — beim nächsten Öffnen sichtbar.");
  }, [walletAddress, accountId, preview, eventId]);

  const handleFeed = useCallback(async () => {
    if (!walletAddress || !preview) return;
    setBusy(true);
    const res = await postFlyerToFeed(accountId, walletAddress, preview.id);
    setBusy(false);
    if (!res.success) toast.error(res.error ?? "Teilen fehlgeschlagen");
    else toast.success("Flyer im Feed geteilt");
  }, [walletAddress, accountId, preview]);

  if (!walletAddress) {
    return (
      <p className="text-sm text-muted-foreground">
        Verbinde dein Wallet, um einen Flyer zu erstellen.
      </p>
    );
  }

  return (
    <div className="space-y-5">
      <div className="bg-card border border-border rounded-[10px] p-5 space-y-5">
        <div className="flex items-start gap-2">
          <ImageIcon className="h-5 w-5 text-primary mt-0.5 shrink-0" />
          <p className="text-sm text-muted-foreground">
            Mecky erstellt aus den Event-Daten einen druckfertigen A4-Flyer — Text und Gestaltung
            passend zu <span className="font-medium text-foreground">{eventTitle}</span>.
          </p>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label>Stil</Label>
            <Select value={styleId} onValueChange={setStyleId}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {FLYER_STYLES.map((s) => (
                  <SelectItem key={s.id} value={s.id}>{s.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              {FLYER_STYLES.find((s) => s.id === styleId)?.description}
            </p>
          </div>

          {eventImageUrl && (
            <div className="space-y-1.5">
              <Label>Event-Bild als Vorlage</Label>
              <div className="flex items-center gap-3 pt-1">
                <Switch checked={useEventImage} onCheckedChange={setUseEventImage} />
                <span className="text-xs text-muted-foreground">
                  Das Event-Bild in den Flyer einbeziehen
                </span>
              </div>
            </div>
          )}
        </div>

        <div className="space-y-1.5">
          <Label>Zusätzlicher Hinweis (optional)</Label>
          <Textarea
            rows={2}
            placeholder="z. B. „Bitte den Kuchenbasar und den kostenlosen Eintritt betonen.“"
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
        </div>

        <div>
          <Button onClick={handleDraft} disabled={drafting || generating} variant="outline">
            {drafting ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Wand2 className="h-4 w-4 mr-2" />}
            Text entwerfen
          </Button>
        </div>

        {copy && (
          <div className="space-y-4 border-t border-border pt-5">
            <p className="text-sm font-medium">Textentwurf — anpassen und dann erstellen</p>
            <div className="grid gap-3 sm:grid-cols-2">
              {COPY_FIELDS.map((f) => (
                <div key={f.key} className={`space-y-1.5 ${f.multiline ? "sm:col-span-2" : ""}`}>
                  <Label className="text-xs">{f.label}</Label>
                  {f.multiline ? (
                    <Textarea rows={2} value={copy[f.key]} onChange={(e) => patchCopy(f.key, e.target.value)} />
                  ) : (
                    <Input value={copy[f.key]} onChange={(e) => patchCopy(f.key, e.target.value)} />
                  )}
                </div>
              ))}
            </div>
            <Button onClick={handleGenerate} disabled={generating}>
              {generating ? (
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
              ) : (
                <Sparkles className="h-4 w-4 mr-2" />
              )}
              Flyer erstellen
            </Button>
            {generating && (
              <p className="text-xs text-muted-foreground">
                Mecky gestaltet euren Flyer — das dauert einen Moment.
              </p>
            )}
          </div>
        )}
      </div>

      {preview && (
        <div className="bg-card border border-border rounded-[10px] p-5 space-y-3">
          <p className="text-sm font-medium">Euer Flyer</p>
          <div className="flex flex-col sm:flex-row gap-4">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={preview.image_url}
              alt={preview.title}
              className="w-full sm:w-64 rounded-md border border-border"
            />
            <div className="flex flex-wrap gap-2 content-start">
              <Button onClick={handleSetCover} size="sm" disabled={busy}>
                <ImageIcon className="h-4 w-4 mr-2" /> Als Event-Bild setzen
              </Button>
              <Button
                onClick={() => downloadImage(preview.image_url, `${slugForFile(preview.title)}.png`)}
                variant="outline"
                size="sm"
              >
                <Download className="h-4 w-4 mr-2" /> PNG
              </Button>
              <Button onClick={() => printFlyer(preview.image_url)} variant="outline" size="sm">
                <Printer className="h-4 w-4 mr-2" /> Drucken / PDF
              </Button>
              <Button onClick={handleFeed} variant="outline" size="sm" disabled={busy}>
                <Share2 className="h-4 w-4 mr-2" /> Im Feed teilen
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
