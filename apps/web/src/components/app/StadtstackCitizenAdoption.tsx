"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { CheckCircle2, Loader2, ShieldAlert, ShieldCheck } from "lucide-react";
import type { ParticipantTopicSuggestionV1 } from "@netizen-labs/nostr";

import type { CitizenSession } from "@/lib/citizen-session/session";
import {
  adoptStagingParticipantSuggestion,
  CitizenAdoptionClientError,
  loadCachedCitizenAdopterPubkey,
  loadPublicCitizenAdoption,
  saveCachedCitizenAdopterPubkey,
  type PublicCitizenAdoptionProjection,
} from "@/lib/staging-participant/citizen-adoption";

const ACTIVE_CITIZEN_NFT_REQUIRED =
  "citizen_eligibility_active_citizen_nft_required";

function short(value: string): string {
  return `${value.slice(0, 12)}…${value.slice(-8)}`;
}

export function StadtstackCitizenAdoption({
  suggestion,
  session,
  onProjectionChange,
}: {
  suggestion: ParticipantTopicSuggestionV1;
  session: CitizenSession | null;
  onProjectionChange: (
    projection: PublicCitizenAdoptionProjection | null
  ) => void;
}) {
  const [projection, setProjection] =
    useState<PublicCitizenAdoptionProjection | null>(null);
  const [loading, setLoading] = useState(Boolean(session));
  const [busy, setBusy] = useState(false);
  const [errorCode, setErrorCode] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setProjection(null);
    setErrorCode(null);
    onProjectionChange(null);
    if (!session) {
      setLoading(false);
      return () => {
        active = false;
      };
    }
    const cachedAdopterPubkey = loadCachedCitizenAdopterPubkey(
      session.snapshot.credential.address
    );
    if (!cachedAdopterPubkey) {
      setLoading(false);
      return () => {
        active = false;
      };
    }
    setLoading(true);
    void loadPublicCitizenAdoption(suggestion.suggestionId, cachedAdopterPubkey)
      .then((persisted) => {
        if (!active) return;
        setProjection(persisted);
        onProjectionChange(persisted);
      })
      .catch((cause) => {
        if (!active) return;
        setErrorCode(
          cause instanceof CitizenAdoptionClientError
            ? cause.code
            : "citizen_adoption_public_projection_unavailable"
        );
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [onProjectionChange, session, suggestion.suggestionId]);

  const adopt = async () => {
    if (!session || busy) return;
    setBusy(true);
    setErrorCode(null);
    try {
      const accepted = await adoptStagingParticipantSuggestion({
        participantSuggestion: suggestion,
        session,
      });
      saveCachedCitizenAdopterPubkey(
        session.snapshot.credential.address,
        accepted.adoptionEvent.pubkey
      );
      setProjection(accepted);
      onProjectionChange(accepted);
    } catch (cause) {
      setProjection(null);
      onProjectionChange(null);
      setErrorCode(
        cause instanceof CitizenAdoptionClientError
          ? cause.code
          : "citizen_adoption_gateway_unavailable"
      );
    } finally {
      setBusy(false);
    }
  };

  if (loading) {
    return (
      <section
        aria-label="Bürgerübernahme"
        className="mt-4 rounded-xl border border-border bg-muted/20 p-4"
      >
        <div className="flex items-center gap-2 text-sm font-semibold text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Öffentliche
          Übernahmequittung wird geladen…
        </div>
      </section>
    );
  }

  if (projection) {
    return (
      <section
        aria-label="Bürgerübernahme"
        data-citizen-adoption-state="accepted"
        className="mt-4 rounded-xl border border-violet-300 bg-violet-50 p-4 text-violet-950"
      >
        <div className="flex items-start gap-3">
          <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0" />
          <div>
            <h3 className="text-sm font-bold">
              Bürgerübernahme verifiziert → wartet auf Case Steward
            </h3>
            <p className="mt-2 text-xs leading-5">
              Die server-geprüfte und öffentlich gespeicherte Quittung bindet
              die Bürger-Signatur an genau diesen unveränderten
              Teilnahme-Entwurf. Ereignis {short(projection.adoptionEvent.id)}.
            </p>
            <p className="mt-2 text-xs leading-5">
              Die Berechtigung galt zum Übernahmezeitpunkt. Vor einer späteren
              Aufnahme muss der Case Steward sie erneut aktuell prüfen.
            </p>
            <p className="mt-2 text-xs font-semibold leading-5">
              Es wurde kein CivicCase angelegt. Keine Verwaltungsbefürwortung,
              keine bindende Abstimmung, kein Beschluss und keine Zahlung.
            </p>
          </div>
        </div>
      </section>
    );
  }

  const citizenPassRequired = errorCode === ACTIVE_CITIZEN_NFT_REQUIRED;

  return (
    <section
      aria-label="Bürgerübernahme"
      data-citizen-adoption-state={
        citizenPassRequired ? "citizen-pass-required" : "required"
      }
      className={`mt-4 rounded-xl border p-4 ${
        citizenPassRequired
          ? "border-amber-300 bg-amber-50 text-amber-950"
          : "border-violet-200 bg-violet-50 text-violet-950"
      }`}
    >
      <div className="flex items-start gap-3">
        {citizenPassRequired ? (
          <ShieldAlert className="mt-0.5 h-5 w-5 shrink-0" />
        ) : (
          <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0" />
        )}
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-bold">
            {citizenPassRequired
              ? "Bürger-Pass erforderlich"
              : "Bürgerübernahme erforderlich"}
          </h3>
          <p className="mt-2 text-xs leading-5">
            {citizenPassRequired
              ? "Dieses verbundene Konto hat aktuell keinen aktiven Röbel Bürger-Pass (CitizenNFT). Es wurde keine Bürgerübernahme und keine Quittung erstellt."
              : session
                ? "Mit einem aktiven Röbel Bürger-Pass kannst du den unveränderten Teilnahme-Entwurf ausdrücklich übernehmen. Konto- und Nostr-Signatur werden getrennt geprüft."
                : "Melde dich mit deinem Röbel-Konto an. Danach kann ein aktiver Bürger-Pass geprüft und der unveränderte Entwurf ausdrücklich übernommen werden."}
          </p>
          {errorCode && !citizenPassRequired && (
            <p role="alert" className="mt-2 text-xs font-semibold leading-5">
              Die Prüfung ist gerade nicht verlässlich erreichbar. Es wurde
              keine Bürgerübernahme und keine Quittung erstellt.
            </p>
          )}
          {citizenPassRequired ? (
            <div className="mt-3 grid gap-2 sm:grid-cols-2">
              <Link
                href="/verifizierung/buerger-beantragen"
                className="inline-flex min-h-10 items-center justify-center rounded-full bg-violet-900 px-4 py-2 text-sm font-bold text-white"
              >
                Bürger-Pass beantragen
              </Link>
              <button
                type="button"
                onClick={() => void adopt()}
                disabled={!session || busy}
                className="inline-flex min-h-10 items-center justify-center gap-2 rounded-full border border-amber-500 bg-white px-4 py-2 text-sm font-semibold text-amber-950 disabled:opacity-50"
              >
                {busy ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" /> Wird geprüft…
                  </>
                ) : (
                  "Bürger-Pass erneut prüfen"
                )}
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => void adopt()}
              disabled={!session || busy}
              className="mt-3 inline-flex min-h-10 w-full items-center justify-center gap-2 rounded-full bg-violet-900 px-4 py-2 text-sm font-bold text-white disabled:opacity-50"
            >
              {busy ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" /> Berechtigung und
                  Signaturen werden geprüft…
                </>
              ) : session ? (
                <>
                  <CheckCircle2 className="h-4 w-4" /> Bürgerübernahme prüfen
                  und signieren
                </>
              ) : (
                "Anmelden, um Bürgerübernahme zu prüfen"
              )}
            </button>
          )}
          <p className="mt-2 text-[11px] leading-4 opacity-80">
            Dieser Schritt beantragt nur die spätere Prüfung durch einen Case
            Steward. Er erzeugt keinen Fall und keine kommunale Wirkung.
          </p>
        </div>
      </div>
    </section>
  );
}
