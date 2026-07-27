"use client";

/**
 * "Flyer" — org dashboard tool. First Mecky content-creation agent.
 *
 * One page:
 *   1. Werkstatt — brief (+ optional event prefill) + style → "Text entwerfen"
 *      (Claude Sonnet drafts editable German copy) → edit → "Flyer erstellen"
 *      (Nano Banana 2 Lite renders a text-legible A4 flyer) → preview + download.
 *   2. Bibliothek — the org's saved flyers (re-download, delete).
 *
 * Wallet/account wiring + styling mirror dashboard/foerdermittel + dashboard/stories.
 */

import { useCallback, useEffect, useState } from "react";
import { useActiveAccount } from "thirdweb/react";
import { useAccount } from "@/lib/context/AccountContext";
import {
  getFlyerEventOptions,
  draftFlyerCopyAction,
  generateFlyerAction,
  listFlyers,
  deleteFlyer,
  postFlyerToFeed,
  attachFlyerToEvent,
} from "@/app/actions/flyer";
import { FLYER_STYLES } from "@/lib/flyer/styles";
import { downloadImage, slugForFile, printFlyer, COPY_FIELDS } from "@/lib/flyer/ui";
import type { FlyerCopy } from "@/lib/flyer/copy";
import type { Flyer, FlyerEventOption } from "@/types/flyer";
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
import { ImageUploadDropzone } from "@/components/ui/image-upload-dropzone";
import { FlyerEditControl } from "@/components/flyer/FlyerEditControl";
import {
  Image as ImageIcon,
  Loader2,
  Sparkles,
  Wand2,
  Download,
  Trash2,
  Printer,
  Share2,
} from "lucide-react";
import { toast } from "sonner";

const NO_EVENT = "__none__";

export default function FlyerPage() {
  const { activeAccount } = useAccount();
  const wallet = useActiveAccount();
  const walletAddress = wallet?.address ?? null;

  const [loading, setLoading] = useState(true);
  const [brief, setBrief] = useState("");
  const [styleId, setStyleId] = useState("modern");
  const [referenceUrl, setReferenceUrl] = useState("");
  const [eventId, setEventId] = useState<string>(NO_EVENT);
  const [events, setEvents] = useState<FlyerEventOption[]>([]);
  const [copy, setCopy] = useState<FlyerCopy | null>(null);
  const [drafting, setDrafting] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [preview, setPreview] = useState<Flyer | null>(null);
  const [flyers, setFlyers] = useState<Flyer[]>([]);
  const [busyFlyerId, setBusyFlyerId] = useState<string | null>(null);

  const canUse = !!activeAccount && !!walletAddress;

  useEffect(() => {
    if (!activeAccount || !walletAddress) return;
    let cancelled = false;
    setLoading(true);
    Promise.all([
      listFlyers(activeAccount.id, walletAddress),
      getFlyerEventOptions(activeAccount.id, walletAddress),
    ])
      .then(([flyerRes, eventRes]) => {
        if (cancelled) return;
        if (flyerRes.success && flyerRes.flyers) setFlyers(flyerRes.flyers);
        if (eventRes.success && eventRes.events) setEvents(eventRes.events);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [activeAccount, walletAddress]);

  const patchCopy = useCallback((key: keyof FlyerCopy, value: string) => {
    setCopy((c) => (c ? { ...c, [key]: value } : c));
  }, []);

  const handleDraft = useCallback(async () => {
    if (!activeAccount || !walletAddress) return;
    setDrafting(true);
    const res = await draftFlyerCopyAction(
      activeAccount.id,
      walletAddress,
      brief,
      styleId,
      eventId === NO_EVENT ? null : eventId,
    );
    setDrafting(false);
    if (!res.success || !res.copy) {
      toast.error(res.error ?? "Text konnte nicht entworfen werden");
      return;
    }
    setCopy(res.copy);
    toast.success("Textentwurf fertig — passt ihn an und erstellt den Flyer.");
  }, [activeAccount, walletAddress, brief, styleId, eventId]);

  const handleGenerate = useCallback(async () => {
    if (!activeAccount || !walletAddress || !copy) return;
    setGenerating(true);
    const res = await generateFlyerAction(activeAccount.id, walletAddress, {
      title: copy.headline,
      brief,
      copy,
      style: styleId,
      eventId: eventId === NO_EVENT ? null : eventId,
      referenceUrl: referenceUrl || null,
    });
    setGenerating(false);
    if (!res.success || !res.flyer) {
      toast.error(res.error ?? "Flyer konnte nicht erstellt werden");
      return;
    }
    setPreview(res.flyer);
    setFlyers((prev) => [res.flyer as Flyer, ...prev]);
    toast.success("Flyer erstellt!");
  }, [activeAccount, walletAddress, copy, brief, styleId, eventId, referenceUrl]);

  const handleDelete = useCallback(
    async (id: string) => {
      if (!activeAccount || !walletAddress) return;
      setFlyers((prev) => prev.filter((f) => f.id !== id));
      if (preview?.id === id) setPreview(null);
      const res = await deleteFlyer(activeAccount.id, walletAddress, id);
      if (!res.success) {
        toast.error(res.error ?? "Löschen fehlgeschlagen");
        // Resync from the DB so an optimistically-removed-but-still-present flyer reappears.
        const fresh = await listFlyers(activeAccount.id, walletAddress);
        if (fresh.success && fresh.flyers) setFlyers(fresh.flyers);
      }
    },
    [activeAccount, walletAddress, preview],
  );

  const handleShareToFeed = useCallback(
    async (id: string) => {
      if (!activeAccount || !walletAddress) return;
      setBusyFlyerId(id);
      const res = await postFlyerToFeed(activeAccount.id, walletAddress, id);
      setBusyFlyerId(null);
      if (!res.success) toast.error(res.error ?? "Teilen fehlgeschlagen");
      else toast.success("Flyer im Feed geteilt");
    },
    [activeAccount, walletAddress],
  );

  const handleAttachToEvent = useCallback(
    async (id: string, evId: string) => {
      if (!activeAccount || !walletAddress || evId === NO_EVENT) return;
      setBusyFlyerId(id);
      const res = await attachFlyerToEvent(activeAccount.id, walletAddress, id, evId);
      setBusyFlyerId(null);
      if (!res.success) toast.error(res.error ?? "Anhängen fehlgeschlagen");
      else toast.success("Flyer als Event-Bild gesetzt");
    },
    [activeAccount, walletAddress],
  );

  if (!canUse) {
    return (
      <div className="max-w-xl mx-auto py-16 text-center">
        <div className="w-12 h-12 rounded-full bg-muted mx-auto mb-4 flex items-center justify-center">
          <ImageIcon className="h-5 w-5 text-muted-foreground" />
        </div>
        <h1 className="text-lg font-semibold text-foreground">Anmeldung erforderlich</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Verbinde dein Wallet und wähle eine Organisation, um Flyer zu erstellen.
        </p>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-medium flex items-center gap-2">
          <ImageIcon className="h-5 w-5 text-primary" />
          Flyer
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Beschreibt euer Vorhaben — Mecky textet und gestaltet daraus einen druckfertigen A4-Flyer.
        </p>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-20 text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin mr-2" /> Lädt…
        </div>
      ) : (
        <>
          {/* Werkstatt */}
          <div className="bg-card border border-border rounded-[10px] p-5 space-y-5">
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

              <div className="space-y-1.5">
                <Label>Aus Event übernehmen (optional)</Label>
                <Select value={eventId} onValueChange={setEventId}>
                  <SelectTrigger><SelectValue placeholder="Kein Event" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NO_EVENT}>Kein Event</SelectItem>
                    {events.map((e) => (
                      <SelectItem key={e.id} value={e.id}>
                        {e.title}
                        {e.date ? ` · ${e.date}` : ""}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-1.5">
              <Label>Worum geht es?</Label>
              <Textarea
                rows={3}
                placeholder="z. B. „Wir veranstalten am 12. Juli unser Sommerfest am See mit Livemusik, Kuchen und Spielen für Kinder. Eintritt frei.“"
                value={brief}
                onChange={(e) => setBrief(e.target.value)}
              />
            </div>

            <div className="space-y-1.5">
              <Label>Logo oder Foto als Vorlage (optional)</Label>
              <p className="text-xs text-muted-foreground">
                Mecky bezieht euer Logo oder ein Foto in den Flyer ein.
              </p>
              <ImageUploadDropzone
                bucketName="images"
                folder="flyer-references"
                maxSizeMB={10}
                currentImageUrl={referenceUrl}
                onUploadComplete={setReferenceUrl}
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
                        <Textarea
                          rows={2}
                          value={copy[f.key]}
                          onChange={(e) => patchCopy(f.key, e.target.value)}
                        />
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

          {/* Preview of the just-generated flyer */}
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
                <div className="space-y-2 min-w-0">
                  <div className="flex flex-wrap gap-2">
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
                    <Button
                      onClick={() => handleShareToFeed(preview.id)}
                      variant="outline"
                      size="sm"
                      disabled={busyFlyerId === preview.id}
                    >
                      <Share2 className="h-4 w-4 mr-2" /> Im Feed teilen
                    </Button>
                  </div>
                  <FlyerEditControl
                    accountId={activeAccount.id}
                    walletAddress={walletAddress}
                    flyer={preview}
                    onEdited={(f) => {
                      setPreview(f);
                      setFlyers((prev) => [f, ...prev]);
                    }}
                  />
                  {events.length > 0 && (
                    <div className="space-y-1.5 max-w-xs">
                      <Label className="text-xs">An Event anhängen (als Event-Bild)</Label>
                      <Select
                        key={preview.id}
                        onValueChange={(v) => handleAttachToEvent(preview.id, v)}
                        disabled={busyFlyerId === preview.id}
                      >
                        <SelectTrigger><SelectValue placeholder="Event wählen…" /></SelectTrigger>
                        <SelectContent>
                          {events.map((e) => (
                            <SelectItem key={e.id} value={e.id}>
                              {e.title}
                              {e.date ? ` · ${e.date}` : ""}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* Bibliothek */}
          {flyers.length > 0 && (
            <div className="space-y-3">
              <p className="text-sm font-medium">Bibliothek</p>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {flyers.map((f) => (
                  <div key={f.id} className="bg-card border border-border rounded-[10px] overflow-hidden">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={f.image_url} alt={f.title} className="w-full aspect-[2/3] object-cover" />
                    <div className="p-3 space-y-2">
                      <p className="text-sm font-medium truncate">{f.title || "Flyer"}</p>
                      <div className="flex flex-wrap items-center gap-1.5">
                        <Button
                          onClick={() => downloadImage(f.image_url, `${slugForFile(f.title)}.png`)}
                          variant="outline"
                          size="sm"
                          title="Als PNG herunterladen"
                        >
                          <Download className="h-4 w-4" />
                        </Button>
                        <Button
                          onClick={() => printFlyer(f.image_url)}
                          variant="outline"
                          size="sm"
                          title="Drucken / als PDF speichern"
                        >
                          <Printer className="h-4 w-4" />
                        </Button>
                        <Button
                          onClick={() => handleShareToFeed(f.id)}
                          variant="outline"
                          size="sm"
                          disabled={busyFlyerId === f.id}
                          title="Im Feed teilen"
                        >
                          <Share2 className="h-4 w-4" />
                        </Button>
                        <FlyerEditControl
                          compact
                          accountId={activeAccount.id}
                          walletAddress={walletAddress}
                          flyer={f}
                          onEdited={(nf) => setFlyers((prev) => [nf, ...prev])}
                        />
                        <div className="flex-1" />
                        <Button
                          onClick={() => handleDelete(f.id)}
                          variant="ghost"
                          size="sm"
                          title="Löschen"
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
