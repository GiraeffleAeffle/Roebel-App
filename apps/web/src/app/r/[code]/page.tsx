import type { Metadata } from "next"
import Link from "next/link"
import { notFound } from "next/navigation"
import { createClient } from "@/lib/supabase/server"
import { hasSupabase } from "@/lib/record"
import { ReferralOpenCTA } from "./ReferralOpenCTA"

interface Props {
  params: Promise<{ code: string }>
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { code } = await params
  return {
    title: `Du wirst zur Röbel App eingeladen · Code ${code}`,
    description:
      "Jemand hat dich zur Röbel App eingeladen. Lade die App, öffne den Link und sichert euch beide Münzen.",
    openGraph: {
      title: "Röbel App — Einladung",
      description: "Öffne den Link, registriere dich und gewinnt beide Münzen.",
    },
  }
}

async function resolveReferral(code: string) {
  // Referral codes are a Supabase-only wallet/invite feature (no record
  // equivalent) — nothing to resolve in record mode.
  if (!hasSupabase) return null

  const supabase = await createClient()
  const { data: ref } = await supabase
    .from("referral_codes")
    .select("code, wallet_address")
    .eq("code", code.toUpperCase())
    .maybeSingle()

  if (!ref) return null

  const { data: user } = await supabase
    .from("users")
    .select("username, profile_picture_url")
    .eq("wallet_address", ref.wallet_address)
    .maybeSingle()

  return {
    code: ref.code,
    referrer: user || null,
  }
}

export default async function ReferralLandingPage({ params }: Props) {
  const { code } = await params
  const upper = code.toUpperCase()

  if (!hasSupabase) {
    return (
      <div className="min-h-screen bg-gradient-to-b from-[#00498B] via-[#264e8e] to-[#E4F2FF] text-white flex items-center justify-center p-6">
        <div className="max-w-md text-center space-y-4">
          <div className="text-5xl">🐂</div>
          <h1 className="text-2xl font-semibold">Einladung nicht verfügbar</h1>
          <p className="text-white/80 text-sm">
            Diese Funktion benötigt ein Backend und ist im öffentlichen Datensatz nicht
            verfügbar.
          </p>
          <Link href="/" className="inline-block underline text-sm">
            Zur Startseite
          </Link>
        </div>
      </div>
    )
  }

  const data = await resolveReferral(upper)
  if (!data) notFound()

  const displayName = data.referrer?.username || "Jemand aus Röbel"

  return (
    <div className="min-h-screen bg-gradient-to-b from-[#00498B] via-[#264e8e] to-[#E4F2FF] text-white">
      <header className="max-w-4xl mx-auto px-6 pt-8 flex items-center justify-between">
        <Link href="/" className="flex items-center gap-2">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo.png" alt="Röbel" className="w-10 h-10" />
          <span className="font-semibold">Röbel App</span>
        </Link>
        <Link href="/about" className="text-sm underline opacity-80 hover:opacity-100">
          Was ist Röbel?
        </Link>
      </header>

      <main className="max-w-xl mx-auto px-6 pt-12 pb-24 text-center">
        <div className="mb-8">
          {data.referrer?.profile_picture_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={data.referrer.profile_picture_url}
              alt={displayName}
              className="w-24 h-24 rounded-full mx-auto border-4 border-white/20"
            />
          ) : (
            <div className="w-24 h-24 rounded-full mx-auto bg-white/10 flex items-center justify-center text-5xl">
              🐂
            </div>
          )}
        </div>

        <p className="text-sm uppercase tracking-widest text-white/70 mb-2">
          Einladung
        </p>
        <h1 className="text-3xl md:text-4xl font-semibold leading-tight mb-4">
          {displayName} lädt dich in die Röbel App ein
        </h1>
        <p className="text-base md:text-lg text-white/80 mb-8">
          Entdecke Events, verdiene Münzen, sammle Mecky-Sticker und gewinne in der
          Röbeler Schatzkammer. Du und {displayName.split(" ")[0]} bekommen beide einen
          Bonus, wenn du die App installierst.
        </p>

        <div className="bg-white text-[#00498B] rounded-2xl p-5 mb-6 shadow-xl">
          <p className="text-xs uppercase tracking-widest text-[#00498B]/60 mb-1">
            Dein Einladungscode
          </p>
          <p className="text-3xl font-semibold tracking-widest">{upper}</p>
        </div>

        <ReferralOpenCTA code={upper} />

        <div className="mt-10 text-left bg-white/10 rounded-2xl p-5 backdrop-blur">
          <p className="text-lg font-semibold mb-2">Was du bekommst</p>
          <ul className="space-y-2 text-sm text-white/90">
            <li className="flex gap-2">
              <span>🪙</span>
              <span>100 Münzen Willkommens-Bonus nach der Anmeldung</span>
            </li>
            <li className="flex gap-2">
              <span>🎯</span>
              <span>Weitere Münzen durch Missionen und täglichen Check-in</span>
            </li>
            <li className="flex gap-2">
              <span>🗝️</span>
              <span>Schlüssel zur Röbeler Schatzkammer kaufen und Truhen öffnen</span>
            </li>
            <li className="flex gap-2">
              <span>🎨</span>
              <span>Seltene Mecky-Sticker, Profilrahmen und Banner gewinnen</span>
            </li>
          </ul>
        </div>

        <p className="mt-8 text-xs text-white/60">
          Missbrauch wird überprüft. Ein Account kann nur einen Code einlösen.
        </p>
      </main>
    </div>
  )
}
