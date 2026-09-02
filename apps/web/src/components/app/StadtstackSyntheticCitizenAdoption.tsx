"use client";

import { useEffect, useState } from "react";
import { FlaskConical, Loader2 } from "lucide-react";
import type { ParticipantTopicSuggestionV1 } from "@netizen-labs/nostr";

import type { CitizenSession } from "@/lib/citizen-session/session";
import {
  loadCachedSyntheticAdopterPubkey,
  loadPublicSyntheticCitizenAdoption,
  saveCachedSyntheticAdopterPubkey,
  SyntheticCitizenAdoptionClientError,
  traceSyntheticCitizenAdoption,
  type PublicSyntheticCitizenAdoptionProjection,
} from "@/lib/staging-participant/synthetic-citizen-adoption";

function short(value: string) {
  return `${value.slice(0, 12)}…${value.slice(-8)}`;
}

/**
 * This card has no callback into the real adoption or journey state. A stored
 * result proves only that the staging UI and test-NFT verifier were exercised.
 */
export function StadtstackSyntheticCitizenAdoption({
  suggestion,
  session,
}: {
  suggestion: ParticipantTopicSuggestionV1;
  session: CitizenSession | null;
}) {
  const [projection, setProjection] =
    useState<PublicSyntheticCitizenAdoptionProjection | null>(null);
  const [loading, setLoading] = useState(Boolean(session));
  const [busy, setBusy] = useState(false);
  const [errorCode, setErrorCode] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setProjection(null);
    setErrorCode(null);
    const cached = session && loadCachedSyntheticAdopterPubkey(
      session.snapshot.credential.address,
    );
    if (!cached) {
      setLoading(false);
      return () => { active = false; };
    }
    setLoading(true);
    void loadPublicSyntheticCitizenAdoption(suggestion.suggestionId, cached)
      .then((value) => {
        if (active) setProjection(value);
      })
      .catch((cause) => {
        if (!active) return;
        setErrorCode(
          cause instanceof SyntheticCitizenAdoptionClientError
            ? cause.code
            : "synthetic_citizen_adoption_projection_unavailable",
        );
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => { active = false; };
  }, [session, suggestion.suggestionId]);

  const trace = async () => {
    if (!session || busy) return;
    setBusy(true);
    setErrorCode(null);
    try {
      const accepted = await traceSyntheticCitizenAdoption({
        participantSuggestion: suggestion,
        session,
      });
      saveCachedSyntheticAdopterPubkey(
        session.snapshot.credential.address,
        accepted.tracer.adopterPubkey,
      );
      setProjection(accepted);
    } catch (cause) {
      setProjection(null);
      setErrorCode(
        cause instanceof SyntheticCitizenAdoptionClientError
          ? cause.code
          : "synthetic_citizen_adoption_gateway_unavailable",
      );
    } finally {
      setBusy(false);
    }
  };

  if (loading) {
    return (
      <section
        aria-label="Synthetische Testübernahme"
        className="mt-4 rounded-xl border border-sky-300 bg-sky-50 p-4 text-sky-950"
      >
        <p className="flex items-center gap-2 text-sm font-semibold">
          <Loader2 className="h-4 w-4 animate-spin" /> Testnachweis wird geladen…
        </p>
      </section>
    );
  }

  if (projection) {
    return (
      <section
        aria-label="Synthetische Testübernahme"
        data-synthetic-citizen-adoption-state="accepted"
        className="mt-4 rounded-xl border-2 border-sky-400 bg-sky-50 p-4 text-sky-950"
      >
        <div className="flex items-start gap-3">
          <FlaskConical className="mt-0.5 h-5 w-5 shrink-0" />
          <div>
            <p className="text-[11px] font-black uppercase tracking-wide">
              Synthetischer Staging-Test · keine Bürgerberechtigung
            </p>
            <h3 className="mt-1 text-sm font-bold">
              Test-Bürger-Pass und beide Signaturen geprüft
            </h3>
            <p className="mt-2 text-xs leading-5">
              Der unveränderte Teilnahme-Entwurf wurde nur in die isolierte
              UI-Vorschau übernommen. Testnachweis {short(projection.proofEvent.id)}.
            </p>
            <p className="mt-2 text-xs font-bold leading-5">
              Kein CivicCase. Keine Verwaltungsbefürwortung. Keine bindende
              Abstimmung, kein Beschluss, keine Treasury-Wirkung und keine Zahlung.
            </p>
            <p className="mt-2 text-[11px] leading-4">
              Die echte Bürgerübernahme oberhalb bleibt bewusst gesperrt und
              wird durch diesen Testnachweis nicht verändert.
            </p>
          </div>
        </div>
      </section>
    );
  }

  const passMissing = errorCode === "synthetic_test_citizen_pass_required";
  return (
    <section
      aria-label="Synthetische Testübernahme"
      data-synthetic-citizen-adoption-state={passMissing ? "test-pass-required" : "available"}
      className="mt-4 rounded-xl border-2 border-dashed border-sky-400 bg-sky-50 p-4 text-sky-950"
    >
      <div className="flex items-start gap-3">
        <FlaskConical className="mt-0.5 h-5 w-5 shrink-0" />
        <div className="min-w-0 flex-1">
          <p className="text-[11px] font-black uppercase tracking-wide">
            Synthetischer Staging-Test · keine Bürgerberechtigung
          </p>
          <h3 className="mt-1 text-sm font-bold">
            {passMissing ? "Test-Bürger-Pass fehlt" : "Isolierten Ablauf testen"}
          </h3>
          <p className="mt-2 text-xs leading-5">
            {passMissing
              ? "Das verbundene Testkonto besitzt auf dem getrennten Testvertrag noch keinen aktiven Test-Pass. Es wurde nichts gespeichert."
              : "Prüft den getrennten Gnosis-Testvertrag sowie Konto- und Nostr-Signatur. Das Ergebnis kann ausschließlich diese synthetische Vorschau öffnen."}
          </p>
          {errorCode && !passMissing && (
            <p role="alert" className="mt-2 text-xs font-semibold leading-5">
              Der isolierte Testpfad ist gerade nicht verlässlich erreichbar.
              Die echte Bürgerübernahme bleibt unverändert gesperrt.
            </p>
          )}
          <button
            type="button"
            onClick={() => void trace()}
            disabled={!session || busy}
            className="mt-3 inline-flex min-h-10 w-full items-center justify-center gap-2 rounded-full bg-sky-900 px-4 py-2 text-sm font-bold text-white disabled:opacity-50"
          >
            {busy ? (
              <><Loader2 className="h-4 w-4 animate-spin" /> Test wird signiert…</>
            ) : session ? (
              <><FlaskConical className="h-4 w-4" /> Test-Pass prüfen und Testsignatur erzeugen</>
            ) : (
              "Anmelden, um den Testpfad auszuführen"
            )}
          </button>
        </div>
      </div>
    </section>
  );
}
