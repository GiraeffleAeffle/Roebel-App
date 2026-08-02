"use client";

// Landing page for the Sommer Camp Mini-App Hackathon — 6 Wochen-Runden
// (Cohorts) über die kompletten Sommerferien in MV, jede Runde startet
// freitags 18 Uhr. The printed roll-ups exist in a day and a night variant —
// this page mirrors both: time of day picks the default, a sun/moon toggle
// overrides it (persisted per browser).
import { useEffect, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { MessageCircle, Moon, Sun } from "lucide-react";
import { Reveal } from "./Reveal";
import { RegistrationCard } from "./RegistrationCard";
import { hasSupabase } from "@/lib/record";
import {
  AblaufSection,
  FaqSection,
  PreiseSection,
  VideoSection,
  WasIstDasSection,
} from "./sections";

const MODE_KEY = "sommercamp-mode";
type Mode = "day" | "night";

function defaultModeForHour(hour: number): Mode {
  return hour >= 6 && hour < 20 ? "day" : "night";
}

// Static, subtle star field for the night sky (no motion — calm by default).
const STARS = {
  backgroundImage: [
    "radial-gradient(1px 1px at 12% 22%, rgba(255,255,255,.9) 50%, transparent 51%)",
    "radial-gradient(1px 1px at 28% 8%, rgba(255,255,255,.6) 50%, transparent 51%)",
    "radial-gradient(1.5px 1.5px at 41% 31%, rgba(255,216,77,.9) 50%, transparent 51%)",
    "radial-gradient(1px 1px at 57% 12%, rgba(255,255,255,.7) 50%, transparent 51%)",
    "radial-gradient(1px 1px at 66% 27%, rgba(255,255,255,.5) 50%, transparent 51%)",
    "radial-gradient(1.5px 1.5px at 78% 7%, rgba(255,255,255,.8) 50%, transparent 51%)",
    "radial-gradient(1px 1px at 89% 19%, rgba(255,216,77,.7) 50%, transparent 51%)",
    "radial-gradient(1px 1px at 8% 44%, rgba(255,255,255,.5) 50%, transparent 51%)",
    "radial-gradient(1px 1px at 94% 39%, rgba(255,255,255,.6) 50%, transparent 51%)",
  ].join(", "),
} as const;

export function SommercampPage() {
  const [mode, setMode] = useState<Mode>("day");

  useEffect(() => {
    const stored = window.localStorage.getItem(MODE_KEY);
    if (stored === "day" || stored === "night") {
      setMode(stored);
    } else {
      setMode(defaultModeForHour(new Date().getHours()));
    }
  }, []);

  const toggleMode = () => {
    const next: Mode = mode === "day" ? "night" : "day";
    setMode(next);
    window.localStorage.setItem(MODE_KEY, next);
  };

  const night = mode === "night";

  return (
    <div
      data-mode={mode}
      className={night ? "bg-[#0E1A38] text-[#E6EEFA]" : "bg-white text-[#12203A]"}
    >
      {/* Tag/Nacht-Umschalter */}
      <button
        type="button"
        onClick={toggleMode}
        aria-pressed={night}
        aria-label={night ? "Tag-Ansicht einschalten" : "Nacht-Ansicht einschalten"}
        className={`fixed top-4 right-4 z-50 flex h-10 w-10 items-center justify-center rounded-full border shadow-sm backdrop-blur transition hover:rotate-12 motion-reduce:transition-none ${
          night
            ? "border-white/20 bg-white/10 text-[#FFD84D] hover:bg-white/20"
            : "border-black/10 bg-white/70 text-[#00498B] hover:bg-white"
        }`}
      >
        {night ? <Sun className="h-5 w-5" /> : <Moon className="h-5 w-5" />}
      </button>

      {/* Hero — der Roll-Up-Himmel (exakte Poster-Verläufe: Tag + Nacht) */}
      <header
        className="relative overflow-hidden"
        style={{
          background: night
            ? "linear-gradient(180deg, #051433 50.42%, #7ABBF2 79.81%, #D3D6DE 86.52%, #FDC705 100%)"
            : "linear-gradient(180deg, #FDC705 15.34%, #E3E5E9 36.57%, #7BBBF2 80.57%)",
        }}
      >
        {night && (
          <div aria-hidden className="absolute inset-0" style={STARS} />
        )}
        <div className="relative mx-auto flex max-w-3xl flex-col items-center px-4 pb-16 pt-20 text-center sm:pb-20 sm:pt-24">
          <Reveal>
            {night ? (
              // Nachts würde der volle Lockup per `brightness-0 invert` zu
              // einem flächigen weißen Klecks — das Mühlen-Motiv verschwindet.
              // Stattdessen: die Bildmarke in einem weißen Chip (Windmühle
              // bleibt erkennbar) + Wortmarke in Weiß daneben.
              <div className="flex items-center gap-2.5">
                <span className="flex h-10 w-10 items-center justify-center rounded-full bg-white shadow-sm">
                  <Image
                    src="/logo.png"
                    alt="Röbel App"
                    width={28}
                    height={28}
                    priority
                    className="h-7 w-7 object-contain"
                  />
                </span>
                <span className="font-heading text-xl font-black uppercase tracking-tight text-white">
                  Röbel App
                </span>
              </div>
            ) : (
              <Image
                src="/Logo-new.png"
                alt="Röbel App"
                width={175}
                height={40}
                priority
                className="h-9 w-auto object-contain sm:h-10"
              />
            )}
          </Reveal>
          <Reveal delay={100}>
            <h1
              className={`font-heading mt-6 text-6xl font-black uppercase leading-[0.9] tracking-tight sm:text-8xl ${
                night ? "text-white" : "text-[#051433]"
              }`}
            >
              Sommer
              <br />
              Camp
            </h1>
          </Reveal>
          <Reveal delay={200}>
            <p
              className={`mt-4 text-lg font-semibold ${
                night ? "text-[#CFE2F5]" : "text-[#051433]"
              }`}
            >
              Mini-App Hackathon
            </p>
          </Reveal>
          <Reveal delay={300}>
            <span className="mt-4 inline-block rounded-full bg-[#FDC705] px-5 py-1.5 font-mono text-sm font-bold tracking-wider text-[#051433]">
              ZEITLICH BEGRENZT
            </span>
          </Reveal>
          <Reveal delay={400}>
            <p
              className={`mt-6 max-w-md text-2xl font-semibold leading-snug sm:text-3xl ${
                night ? "text-white" : "text-[#051433]"
              }`}
            >
              100% Online.
              <br />
              Mini-Apps mit KI bauen von Zuhause aus.
            </p>
          </Reveal>
          <Reveal delay={500}>
            <p
              className={`mt-3 max-w-md text-base leading-relaxed ${
                night ? "text-white/85" : "text-[#1D2E4C]"
              }`}
            >
              Die ganzen Sommerferien lang: Jede Woche eine neue Runde, jeden
              Freitag Preise — gebaut mit KI, ganz ohne Vorwissen.
            </p>
          </Reveal>
          <Reveal delay={600}>
            <a
              href="#mitmachen"
              className={`mt-8 inline-block rounded-full px-8 py-3.5 text-base font-bold shadow-lg transition-transform hover:scale-[1.03] motion-reduce:transition-none ${
                night
                  ? "bg-[#051433] text-white"
                  : "bg-[#00498B] text-white"
              }`}
            >
              Jetzt mitmachen
            </a>
          </Reveal>
        </div>
      </header>

      <main>
        <VideoSection night={night} />
        <WasIstDasSection night={night} />
        <PreiseSection night={night} />
        <AblaufSection night={night} />

        {/* Anmeldung — nachts läuft der Himmel ins Gold (rechtes Roll-Up) */}
        <section
          id="mitmachen"
          className={
            night
              ? "bg-gradient-to-b from-[#101F42] via-[#3D5A8A] to-[#F5D96B]"
              : "bg-[#00498B]"
          }
        >
          <div className="mx-auto max-w-xl px-4 py-14 sm:py-16">
            <Reveal>
              <h2 className="font-heading text-center text-3xl font-black uppercase tracking-tight text-white">
                Anmeldung
              </h2>
              <p className="mt-2 text-center text-base text-white/80">
                Kostenlos. Dauert eine Minute — deine Runde startet offiziell
                freitags um 18&nbsp;Uhr.
              </p>
            </Reveal>
            <Reveal delay={150} className="mt-8">
              {hasSupabase ? (
                <RegistrationCard night={night} />
              ) : (
                <p className="rounded-2xl bg-white/10 px-6 py-8 text-center text-base text-white">
                  Diese Funktion benötigt ein Backend und ist im öffentlichen
                  Datensatz nicht verfügbar.
                </p>
              )}
            </Reveal>
            {/* Fragen? Direkter Draht per WhatsApp (+49 176 82275490). */}
            <Reveal delay={250} className="mt-6 text-center">
              <p className="text-base text-white/80">Noch Fragen?</p>
              <a
                href="https://wa.me/4917682275490?text=Hallo!%20Ich%20habe%20eine%20Frage%20zum%20Sommer%20Camp."
                target="_blank"
                rel="noopener noreferrer"
                className="mt-3 inline-flex items-center gap-2 rounded-full bg-[#25D366] px-6 py-3 text-base font-bold text-white shadow-lg transition-transform hover:scale-[1.03] motion-reduce:transition-none"
              >
                <MessageCircle className="h-5 w-5" />
                Frag uns auf WhatsApp
              </a>
            </Reveal>
          </div>
        </section>

        <FaqSection night={night} />
      </main>

      <footer
        className={`px-4 py-10 text-center text-base ${
          night ? "bg-[#0B1530] text-[#9DB4D0]" : "bg-[#F4F7FB] text-[#6B7280]"
        }`}
      >
        <p className="font-semibold">Röbel App · Sommer Camp 2026</p>
        <nav className="mt-3 flex items-center justify-center gap-4">
          <Link href="/impressum" className="hover:underline">
            Impressum
          </Link>
          <Link href="/datenschutz" className="hover:underline">
            Datenschutz
          </Link>
          <Link href="/agb" className="hover:underline">
            AGB
          </Link>
        </nav>
      </footer>
    </div>
  );
}
