"use client"

import { useEffect, useState } from "react"
import Image from "next/image"
import { usePathname } from "next/navigation"
import { X } from "lucide-react"

// Canonical store URLs (same as apps/expo/constants/app-store.ts and the e/r/order pages).
const APP_STORE_URL = "https://apps.apple.com/de/app/r%C3%B6bel/id6754984699"
const PLAY_STORE_URL =
  "https://play.google.com/store/apps/details?id=com.maxbrych.roebelonchain&hl=de"

const DISMISS_KEY = "roebel-app-sheet-dismissed-at"
const DISMISS_TTL_MS = 14 * 24 * 60 * 60 * 1000

// Routes that already run their own app-open/download flow (/e, /r, /order,
// event/news details incl. the /app/* ones with DeepLinkRedirect), are
// rendered inside the Röbel app's WebView (/mini), or are tool/legal
// surfaces where an install prompt is noise. The /app section itself DOES
// show the sheet — mobile web-app visitors are the main install audience.
const SUPPRESSED_PREFIXES = [
  "/app/news/",
  "/app/events/",
  "/e/",
  "/r/",
  "/order",
  "/events/",
  "/news/",
  "/mini",
  "/editor",
  "/admin",
  "/dashboard",
  "/datenschutz",
  "/privacy",
  "/impressum",
  "/agb",
  "/delete-account",
]

type Platform = "ios" | "android"

function detectPlatform(): Platform | null {
  const ua = navigator.userAgent
  // Never show inside a WebView (e.g. the Röbel app itself hosting /mini/*):
  // Android WebViews carry "; wv"; iOS WKWebViews lack the "Safari/" token
  // that real Safari, CriOS and FxiOS all send.
  if (/Android/i.test(ua)) {
    return /; wv/i.test(ua) ? null : "android"
  }
  if (/iPhone|iPad|iPod/i.test(ua)) {
    return /Safari\//i.test(ua) ? "ios" : null
  }
  return null
}

export function GlobalAppDownloadSheet() {
  const pathname = usePathname()
  const [platform, setPlatform] = useState<Platform | null>(null)
  const [visible, setVisible] = useState(false)

  const suppressed = SUPPRESSED_PREFIXES.some((prefix) =>
    pathname?.startsWith(prefix),
  )

  useEffect(() => {
    if (suppressed) return
    const detected = detectPlatform()
    if (!detected) return
    try {
      const dismissedAt = Number(localStorage.getItem(DISMISS_KEY) ?? 0)
      if (dismissedAt && Date.now() - dismissedAt < DISMISS_TTL_MS) return
    } catch {
      // localStorage unavailable (private mode) — show the sheet anyway
    }
    setPlatform(detected)
    const timer = window.setTimeout(() => setVisible(true), 800)
    return () => window.clearTimeout(timer)
  }, [suppressed])

  function rememberDismissal() {
    try {
      localStorage.setItem(DISMISS_KEY, String(Date.now()))
    } catch {
      // ignore
    }
  }

  function dismiss() {
    setVisible(false)
    rememberDismissal()
  }

  if (!platform || suppressed) return null

  const storeUrl = platform === "ios" ? APP_STORE_URL : PLAY_STORE_URL
  const storeName = platform === "ios" ? "App Store" : "Play Store"

  return (
    <div
      role="dialog"
      aria-label="Röbel App laden"
      className={`fixed inset-x-0 bottom-0 z-[60] transition-transform duration-300 ease-out ${
        visible ? "translate-y-0" : "translate-y-full"
      }`}
    >
      <div
        className="relative mx-auto max-w-md rounded-t-2xl border border-b-0 border-border bg-card px-5 pt-5 text-card-foreground shadow-[0_-8px_30px_rgba(0,0,0,0.15)]"
        style={{ paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 1.25rem)" }}
      >
        <button
          onClick={dismiss}
          aria-label="Schließen"
          className="absolute right-3 top-3 rounded-full p-1.5 text-muted-foreground hover:bg-muted"
        >
          <X className="h-4 w-4" />
        </button>
        <div className="flex items-center gap-4 pr-6">
          <Image
            src="/apple-touch-icon.png"
            alt="Röbel App"
            width={56}
            height={56}
            className="rounded-xl"
          />
          <div>
            <p className="text-base font-semibold">Röbel App</p>
            <p className="text-sm text-muted-foreground">
              Neuigkeiten, Events und Röbel-Münzen – direkt auf deinem Handy.
            </p>
          </div>
        </div>
        <a
          href={storeUrl}
          target="_blank"
          rel="noopener noreferrer"
          onClick={rememberDismissal}
          className="mt-4 block w-full rounded-full bg-primary py-3 text-center text-base font-semibold text-primary-foreground hover:opacity-90"
        >
          Im {storeName} laden
        </a>
        <button
          onClick={dismiss}
          className="mt-1 w-full py-2 text-center text-sm text-muted-foreground"
        >
          Weiter im Browser
        </button>
      </div>
    </div>
  )
}
