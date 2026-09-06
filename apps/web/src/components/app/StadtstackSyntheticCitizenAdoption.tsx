"use client";

import { useEffect, useRef, useState } from "react";
import { FlaskConical, Loader2 } from "lucide-react";
import type { ParticipantTopicSuggestionV1 } from "@netizen-labs/nostr";

import { bindPublicSyntheticCaseReceiptToProposal } from "@/lib/stadtstack/proposal-signature";
import type { VerifiedPublicCaseBindingReceipt } from "@/lib/stadtstack/public-case-binding-receipt-client";
import type { CitizenSession } from "@/lib/citizen-session/session";
import {
  loadCachedSyntheticAdopterPubkey,
  loadPublicSyntheticCitizenAdoption,
  recoverSyntheticCitizenAdoption,
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
 * preview remains immutable; a separate matching receipt may report a test Case.
 */
export function StadtstackSyntheticCitizenAdoption({
  suggestion,
  session,
  bindingReceipt,
  bindingReceiptUnavailable,
}: {
  suggestion: ParticipantTopicSuggestionV1;
  session: CitizenSession | null;
  bindingReceipt: VerifiedPublicCaseBindingReceipt | null;
  bindingReceiptUnavailable: boolean;
}) {
  const [projection, setProjection] =
    useState<PublicSyntheticCitizenAdoptionProjection | null>(null);
  const [loading, setLoading] = useState(Boolean(session));
  const [busy, setBusy] = useState<"trace" | "recover" | null>(null);
  const [receiptMissing, setReceiptMissing] = useState(false);
  const operation = useRef(0);
  const [errorCode, setErrorCode] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    operation.current += 1;
    setBusy(null);
    setReceiptMissing(false);
    setProjection(null);
    setErrorCode(null);
    // The public receipt can recover its public preview without login or a
    // signing prompt. Account hints are only needed before a test Case exists.
    const publicAdopter =
      bindingReceipt?.schemaVersion ===
        "public_synthetic_case_binding_receipt_v1" &&
      bindingReceipt.rootEventId === suggestion.draft.sourceDiscussionId &&
      bindingReceipt.participantSuggestionEventId === suggestion.suggestionId
        ? bindingReceipt.adopterPubkey
        : null;
    const cached =
      publicAdopter ??
      (session &&
        loadCachedSyntheticAdopterPubkey(session.snapshot.credential.address));
    if (!cached) {
      setLoading(false);
      return () => {
        active = false;
        operation.current += 1;
      };
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
            : "synthetic_citizen_adoption_projection_unavailable"
        );
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
      operation.current += 1;
    };
  }, [
    session,
    suggestion.suggestionId,
    suggestion.draft.sourceDiscussionId,
    bindingReceipt,
  ]);

  const trace = async () => {
    if (!session || busy) return;
    const current = ++operation.current;
    setBusy("trace");
    setReceiptMissing(false);
    setErrorCode(null);
    try {
      const accepted = await traceSyntheticCitizenAdoption({
        participantSuggestion: suggestion,
        session,
      });
      saveCachedSyntheticAdopterPubkey(
        session.snapshot.credential.address,
        accepted.tracer.adopterPubkey
      );
      if (current === operation.current) setProjection(accepted);
    } catch (cause) {
      if (current !== operation.current) return;
      setProjection(null);
      setErrorCode(
        cause instanceof SyntheticCitizenAdoptionClientError
          ? cause.code
          : "synthetic_citizen_adoption_gateway_unavailable"
      );
    } finally {
      if (current === operation.current) setBusy(null);
    }
  };

  const recover = async () => {
    if (!session || busy) return;
    const current = ++operation.current;
    setBusy("recover");
    setReceiptMissing(false);
    setErrorCode(null);
    try {
      const stored = await recoverSyntheticCitizenAdoption(
        suggestion.suggestionId,
        session
      );
      if (current !== operation.current) return;
      setProjection(stored);
      setReceiptMissing(stored === null);
    } catch (cause) {
      if (current !== operation.current) return;
      setErrorCode(
        cause instanceof SyntheticCitizenAdoptionClientError
          ? cause.code
          : "synthetic_citizen_adoption_projection_unavailable"
      );
    } finally {
      if (current === operation.current) setBusy(null);
    }
  };

  const testCaseReceipt = bindPublicSyntheticCaseReceiptToProposal({
    suggestion,
    receipt: bindingReceipt,
    projection,
  });
  const hasTestCaseReceipt =
    bindingReceipt?.schemaVersion ===
    "public_synthetic_case_binding_receipt_v1";
  const testCaseStatus = (hasTestCaseReceipt || projection) && (
    <section
      aria-label="Isolierter Testfall"
      data-synthetic-case-state={
        testCaseReceipt
          ? "verified"
          : loading
            ? "loading"
            : bindingReceiptUnavailable || errorCode
              ? "unavailable"
              : hasTestCaseReceipt
                ? "mismatch"
                : "pending"
      }
      className="mt-3 rounded-xl border border-sky-300 bg-sky-50 p-4 text-sky-950"
    >
      <p className="text-[11px] font-black uppercase tracking-wide">
        Nur Staging · Testfall
      </p>
      <h3 className="mt-1 text-sm font-bold">
        {testCaseReceipt
          ? "Isolierter Testfall aufgenommen"
          : loading
            ? "Testfall-Nachweis wird geprüft…"
            : bindingReceiptUnavailable || errorCode
              ? "Testfall-Stand gerade nicht erreichbar"
              : hasTestCaseReceipt
                ? "Testfall-Nachweise passen nicht zusammen"
                : "Testfall-Aufnahme noch nicht öffentlich quittiert"}
      </h3>
      <p className="mt-2 text-xs leading-5">
        {testCaseReceipt
          ? "Der Case Steward hat genau diesen Testnachweis und den unveränderten Entwurf in den isolierten Testablauf aufgenommen. Die Fachprüfung im Testablauf ist der nächste, noch nicht geöffnete Schritt."
          : "Erst eine passende öffentliche Quittung bestätigt die getrennte Testfall-Aufnahme. Du kannst den Stand durch erneutes Laden dieser Diskussion prüfen."}
      </p>
      {testCaseReceipt && (
        <details className="mt-3 text-xs">
          <summary className="cursor-pointer font-semibold">
            Testfall-Nachweis anzeigen
          </summary>
          <dl className="mt-2 space-y-2 break-all text-[11px]">
            <div>
              <dt className="font-bold">
                Testfall · Version {testCaseReceipt.caseVersion}
              </dt>
              <dd>{testCaseReceipt.caseId}</dd>
            </div>
            <div>
              <dt className="font-bold">Öffentliche Quittung</dt>
              <dd>{testCaseReceipt.receiptChecksum}</dd>
            </div>
            <div>
              <dt className="font-bold">Testnachweis</dt>
              <dd>{testCaseReceipt.candidateEventId}</dd>
            </div>
          </dl>
        </details>
      )}
      <p className="mt-2 text-xs font-semibold leading-5">
        Kein realer CivicCase und keine Bürgerberechtigung. Keine
        Verwaltungsbefürwortung, bindende Abstimmung, kein Beschluss und keine
        Zahlung.
      </p>
    </section>
  );

  if (loading) {
    return (
      <section
        aria-label="Synthetische Testübernahme"
        className="mt-4 rounded-xl border border-sky-300 bg-sky-50 p-4 text-sky-950"
      >
        <p className="flex items-center gap-2 text-sm font-semibold">
          <Loader2 className="h-4 w-4 animate-spin" /> Testnachweis wird
          geladen…
        </p>
      </section>
    );
  }

  if (projection) {
    return (
      <>
        <details
          aria-label="Synthetische Testübernahme"
          data-synthetic-citizen-adoption-state="accepted"
          className="mt-4 rounded-xl border-2 border-sky-400 bg-sky-50 p-4 text-sky-950"
        >
          <summary className="flex cursor-pointer list-none items-start gap-3 text-sm font-bold">
            <FlaskConical className="mt-0.5 h-5 w-5 shrink-0" />
            <span className="min-w-0">
              <span className="block text-[11px] font-black uppercase tracking-wide">
                Synthetischer Staging-Test · keine Bürgerberechtigung
              </span>
              <span className="mt-1 block">
                Test-Bürger-Pass und beide Signaturen geprüft
              </span>
            </span>
          </summary>
          <div className="mt-3 border-t border-sky-200 pt-3">
            <p className="text-xs leading-5">
              Dieser gespeicherte Nachweis belegt die ursprüngliche Übernahme
              des unveränderten Teilnahme-Entwurfs in die isolierte UI-Vorschau.
              Testnachweis {short(projection.proofEvent.id)}.
            </p>
            <p className="mt-2 text-xs font-bold leading-5">
              Der ursprüngliche Testnachweis erzeugt keinen CivicCase. Keine
              Verwaltungsbefürwortung. Keine bindende Abstimmung, kein
              Beschluss, keine Treasury-Wirkung und keine Zahlung.
            </p>
            <p className="mt-2 text-[11px] leading-4">
              Die echte Bürgerübernahme oberhalb bleibt bewusst gesperrt und
              wird durch diesen Testnachweis nicht verändert.
            </p>
          </div>
        </details>
        {testCaseStatus}
      </>
    );
  }

  const passMissing = errorCode === "synthetic_test_citizen_pass_required";
  return (
    <>
      <details
        aria-label="Synthetische Testübernahme"
        data-synthetic-citizen-adoption-state={
          passMissing ? "test-pass-required" : "available"
        }
        className="mt-4 rounded-xl border-2 border-dashed border-sky-400 bg-sky-50 p-4 text-sky-950"
      >
        <summary className="flex cursor-pointer list-none items-start gap-3">
          <FlaskConical className="mt-0.5 h-5 w-5 shrink-0" />
          <span className="min-w-0 flex-1">
            <span className="block text-[11px] font-black uppercase tracking-wide">
              Synthetischer Staging-Test · keine Bürgerberechtigung
            </span>
            <span className="mt-1 block text-sm font-bold">
              {passMissing
                ? "Test-Bürger-Pass fehlt"
                : "Isolierten Ablauf testen"}
            </span>
          </span>
        </summary>
        <div className="mt-3 border-t border-sky-200 pt-3">
          <p className="text-xs leading-5">
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
          {session && (
            <div className="mt-3">
              <button
                type="button"
                onClick={() => void recover()}
                disabled={busy !== null}
                className="inline-flex min-h-10 w-full items-center justify-center gap-2 rounded-full border border-sky-900 px-4 py-2 text-sm font-bold disabled:opacity-50"
              >
                {busy === "recover" && (
                  <Loader2 className="h-4 w-4 animate-spin" />
                )}
                Gespeicherten Testnachweis laden
              </button>
              <p className="mt-1 text-xs leading-5">
                Dein Konto kann eine Identitätsbestätigung anfordern. Dabei wird
                kein neuer Testnachweis erstellt.
              </p>
            </div>
          )}
          {receiptMissing && (
            <p role="status" className="mt-2 text-xs leading-5">
              Für dieses Konto und diesen Entwurf ist kein Testnachweis
              gespeichert.
            </p>
          )}
          <button
            type="button"
            onClick={() => void trace()}
            disabled={!session || busy !== null}
            className="mt-3 inline-flex min-h-10 w-full items-center justify-center gap-2 rounded-full bg-sky-900 px-4 py-2 text-sm font-bold text-white disabled:opacity-50"
          >
            {busy === "trace" ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" /> Test wird signiert…
              </>
            ) : session ? (
              <>
                <FlaskConical className="h-4 w-4" /> Test-Pass prüfen und
                Testsignatur erzeugen
              </>
            ) : (
              "Anmelden, um den Testpfad auszuführen"
            )}
          </button>
        </div>
      </details>
      {testCaseStatus}
    </>
  );
}
