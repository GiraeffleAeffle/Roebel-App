import { useRef, useState } from "react";
import { QRCodeSVG, QRCodeCanvas } from "qrcode.react";
import { PDFDocument } from "pdf-lib";
import type { Address } from "viem";
import { Card, ChartCard, PageHeader } from "../components/ui";
import { Ticket, Printer, Plus, Sparkles, Download } from "../components/icons";
import { SUPABASE_URL, SUPABASE_ANON as ANON } from "../lib/supabase";
import { track } from "../lib/analytics";
import { withMiniAppBasePath } from "../lib/publicDemoMode";

// Static assets live in /public and need the optional staging base path.
const posterPdfUrl = withMiniAppBasePath("/assets/event-poster.pdf");
const posterPreview = withMiniAppBasePath("/assets/event-poster-preview.jpg");

// The Röbel app scans this and reads the event id from /e/<id>.
const EVENT_BASE = "https://www.roebel.app/e/";

const DURATIONS = [
  { label: "1 Stunde", hours: 1 },
  { label: "4 Stunden", hours: 4 },
  { label: "Heute (24 Std.)", hours: 24 },
  { label: "1 Woche", hours: 168 },
];

// The poster (src/assets/event-poster.pdf) has a white rounded square in the
// lower-center. These fractions describe that square relative to the A4 page —
// measured from a render of the PDF — and drive BOTH the on-screen preview
// overlay and where pdf-lib stamps the QR. Keep them in sync with the PDF.
const SQUARE = { left: 0.2761, top: 0.5863, width: 0.4478, height: 0.315 };
// Padding inside the square, as a fraction of the square (a bit of breathing room).
const QR_PAD = 0.12;
// QR fill fraction of the square (1 − 2·pad), reused for the preview overlay.
const QR_FILL = `${(1 - 2 * QR_PAD) * 100}%`;
// Dark module color — navy to match the brand, dark enough to scan reliably on white.
const QR_DARK = "#00498B";

function dataUrlToBytes(dataUrl: string): Uint8Array {
  const base64 = dataUrl.slice(dataUrl.indexOf(",") + 1);
  const bin = atob(base64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

export default function EventInviteView({ inviter }: { inviter: Address | null }) {
  const [label, setLabel] = useState("");
  const [hours, setHours] = useState(24);
  const [creating, setCreating] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [event, setEvent] = useState<{ id: string; label: string; expiresAt: string } | null>(null);

  // Hidden high-res QR canvas → PNG bytes for the stamped PDF.
  const qrCanvasRef = useRef<HTMLCanvasElement>(null);
  // Cached blob URL of the stamped PDF (built once per event).
  const pdfUrlRef = useRef<string | null>(null);

  const clearPdfCache = () => {
    if (pdfUrlRef.current) {
      URL.revokeObjectURL(pdfUrlRef.current);
      pdfUrlRef.current = null;
    }
  };

  if (!inviter) {
    return (
      <div className="space-y-4">
        <PageHeader title="Event-Einladung" description="Erstelle einen QR-Code für ein lokales Event." />
        <Card className="p-5 text-[13px] leading-relaxed text-muted-foreground">
          Öffne diese Mini-App in der Röbel-App, um dein Konto zu verbinden — dann kannst du als Bürger:in einen Event-QR-Code erstellen.
        </Card>
      </div>
    );
  }

  const create = async () => {
    if (!label.trim()) {
      setError("Bitte gib einen Event-Namen ein.");
      return;
    }
    setCreating(true);
    setError(null);
    try {
      const expiresAt = new Date(Date.now() + hours * 3600_000).toISOString();
      const res = await fetch(`${SUPABASE_URL}/functions/v1/create-reward-event`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${ANON}`, apikey: ANON },
        body: JSON.stringify({ creator: inviter, label: label.trim(), expiresAt }),
      });
      const j = await res.json();
      if (!res.ok || !j.id) throw new Error(j.error || "Event konnte nicht erstellt werden");
      clearPdfCache();
      setEvent({ id: j.id, label: label.trim(), expiresAt });
      track("event_created", { hours });
    } catch (e: any) {
      setError(e?.message ?? String(e));
    } finally {
      setCreating(false);
    }
  };

  const link = event ? `${EVENT_BASE}${event.id}` : "";

  // Stamp the QR into the real event-poster.pdf white square (with padding) and
  // return a blob URL for the resulting PDF. Built once, then reused.
  const buildPdf = async (): Promise<string> => {
    if (pdfUrlRef.current) return pdfUrlRef.current;
    const canvas = qrCanvasRef.current;
    if (!canvas) throw new Error("Der QR-Code ist noch nicht bereit.");

    const qrBytes = dataUrlToBytes(canvas.toDataURL("image/png"));
    const posterBytes = await fetch(posterPdfUrl).then((r) => r.arrayBuffer());
    const doc = await PDFDocument.load(posterBytes);
    const page = doc.getPages()[0];
    const { width: pw, height: ph } = page.getSize();
    const qrImage = await doc.embedPng(qrBytes);

    const sqX = SQUARE.left * pw;
    const sqW = SQUARE.width * pw;
    const sqH = SQUARE.height * ph;
    // pdf-lib origin is bottom-left; the fraction is measured from the top.
    const sqY = ph - (SQUARE.top + SQUARE.height) * ph;
    const pad = QR_PAD * sqW;
    const side = Math.min(sqW, sqH) - 2 * pad;
    page.drawImage(qrImage, {
      x: sqX + (sqW - side) / 2,
      y: sqY + (sqH - side) / 2,
      width: side,
      height: side,
    });

    const bytes = await doc.save();
    // Copy into a fresh ArrayBuffer-backed view so the Blob part type is concrete
    // (avoids the Uint8Array<ArrayBufferLike> → BlobPart mismatch on TS 5.7 lib.dom).
    const url = URL.createObjectURL(new Blob([new Uint8Array(bytes)], { type: "application/pdf" }));
    pdfUrlRef.current = url;
    return url;
  };

  const downloadPdf = (url: string) => {
    const a = document.createElement("a");
    a.href = url;
    a.download = `roebel-event-${event?.id ?? "poster"}.pdf`;
    document.body.appendChild(a);
    a.click();
    a.remove();
  };

  const handlePrint = async () => {
    setBusy(true);
    setError(null);
    try {
      const url = await buildPdf();
      // Open the stamped PDF so the user can print it; fall back to a download
      // if the mini-app's iframe blocks the pop-up.
      const win = window.open(url, "_blank");
      if (!win) downloadPdf(url);
    } catch (e: any) {
      setError(e?.message ?? String(e));
    } finally {
      setBusy(false);
    }
  };

  const handleDownload = async () => {
    setBusy(true);
    setError(null);
    try {
      downloadPdf(await buildPdf());
    } catch (e: any) {
      setError(e?.message ?? String(e));
    } finally {
      setBusy(false);
    }
  };

  const newEvent = () => {
    clearPdfCache();
    setEvent(null);
    setError(null);
  };

  return (
    <div className="space-y-4">
      <PageHeader title="Event-Einladung" description="Ein QR-Code für ein lokales Event: Gäste machen bei den Röbel-Münzen mit und alle sammeln ein paar Röbel-Münzen als „War-in-Röbel“-Nachweis — bezahlt aus der Gemeinschaftskasse, nicht von dir." />

      {!event ? (
        <ChartCard>
          <div className="mb-4 flex items-center gap-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-[10px] bg-[#00498B]/10 text-[#00498B]">
              <Ticket className="h-5 w-5" />
            </div>
            <div>
              <h3 className="text-sm font-semibold uppercase tracking-wide text-foreground">Event-QR erstellen</h3>
              <p className="text-xs text-muted-foreground">Gäste scannen → mitmachen → Röbel-Münzen sammeln</p>
            </div>
          </div>

          <label className="block">
            <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Event-Name</span>
            <input
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="z. B. Röbeler Wochenmarkt"
              maxLength={80}
              className="mt-1.5 w-full rounded-[10px] border border-border bg-card px-3 py-2.5 text-sm outline-none transition focus:border-[#00498B] focus:ring-2 focus:ring-[#00498B]/15"
            />
          </label>

          <label className="mt-3 block">
            <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Gültig für</span>
            <select
              value={hours}
              onChange={(e) => setHours(Number(e.target.value))}
              className="mt-1.5 w-full rounded-[10px] border border-border bg-card px-3 py-2.5 text-sm outline-none transition focus:border-[#00498B] focus:ring-2 focus:ring-[#00498B]/15"
            >
              {DURATIONS.map((d) => (
                <option key={d.hours} value={d.hours}>
                  {d.label}
                </option>
              ))}
            </select>
          </label>

          {error && <p className="mt-2 text-sm font-medium text-foreground">{error}</p>}

          <button
            onClick={create}
            disabled={creating}
            className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-[10px] bg-[#00498B] px-4 py-3 text-sm font-semibold text-white transition hover:bg-[#1d4e99] active:scale-[0.99] disabled:opacity-60"
          >
            <Plus className="h-4 w-4" />
            {creating ? "Wird erstellt…" : "Event-QR erstellen"}
          </button>
        </ChartCard>
      ) : (
        <Card className="p-4">
          <div className="mb-3 text-center">
            <div className="mb-1 inline-flex items-center gap-1.5 rounded-full bg-[#00498B]/10 px-2.5 py-0.5 text-[11px] font-medium text-[#00498B]">
              <Sparkles className="h-3 w-3" /> Event aktiv
            </div>
            <h3 className="font-display text-lg font-bold tracking-tight text-foreground">{event.label}</h3>
          </div>

          {/* Live preview of the printed poster: the QR sits in the white square. */}
          <div className="relative mx-auto w-full max-w-[320px] overflow-hidden rounded-xl border border-border shadow-sm">
            <img src={posterPreview} alt="Röbel Event-Plakat" className="block w-full" />
            <div
              className="absolute flex items-center justify-center"
              style={{
                left: `${SQUARE.left * 100}%`,
                top: `${SQUARE.top * 100}%`,
                width: `${SQUARE.width * 100}%`,
                height: `${SQUARE.height * 100}%`,
              }}
            >
              <QRCodeSVG
                value={link}
                level="M"
                fgColor={QR_DARK}
                bgColor="#ffffff"
                style={{ width: QR_FILL, height: QR_FILL }}
              />
            </div>
          </div>

          <p className="mt-3 text-center text-xs text-muted-foreground">
            Gültig bis {new Date(event.expiresAt).toLocaleString("de-DE")}
          </p>

          {error && <p className="mt-2 text-center text-sm font-medium text-foreground">{error}</p>}

          <button
            onClick={handlePrint}
            disabled={busy}
            className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-[10px] bg-[#00498B] px-4 py-3 text-sm font-semibold text-white transition hover:bg-[#1d4e99] active:scale-[0.99] disabled:opacity-60"
          >
            <Printer className="h-4 w-4" />
            {busy ? "Wird vorbereitet…" : "Plakat drucken (PDF)"}
          </button>
          <div className="mt-2 flex gap-2">
            <button
              onClick={handleDownload}
              disabled={busy}
              className="inline-flex flex-1 items-center justify-center gap-2 rounded-[10px] border border-border bg-card px-4 py-2.5 text-sm font-medium text-muted-foreground transition hover:text-foreground active:scale-[0.99] disabled:opacity-60"
            >
              <Download className="h-4 w-4" />
              PDF speichern
            </button>
            <button
              onClick={newEvent}
              className="rounded-[10px] border border-border bg-card px-4 py-2.5 text-sm font-medium text-muted-foreground transition hover:text-foreground active:scale-[0.99]"
            >
              Neu
            </button>
          </div>

          {/* Hidden high-res QR rendered to a canvas → PNG bytes stamped into the PDF. */}
          <QRCodeCanvas
            ref={qrCanvasRef}
            value={link}
            size={600}
            level="M"
            fgColor={QR_DARK}
            bgColor="#ffffff"
            marginSize={2}
            style={{ display: "none" }}
          />
        </Card>
      )}
    </div>
  );
}
