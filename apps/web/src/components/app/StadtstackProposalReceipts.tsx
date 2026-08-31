import {
  CheckCircle2,
  FileKey2,
  Landmark,
  ShieldAlert,
  ShieldCheck,
} from "lucide-react";
import type {
  CitizenSignedTopicSuggestionV1,
  ParticipantTopicSuggestionV1,
} from "@netizen-labs/nostr";

import {
  bindPublicCaseReceiptToProposal,
  projectPublicCitizenAdoptionEvidence,
  projectPublicProposalSignature,
} from "@/lib/stadtstack/proposal-signature";
import type { VerifiedPublicCaseBindingReceipt } from "@/lib/stadtstack/public-case-binding-receipt-client";

function short(value: string): string {
  return `${value.slice(0, 12)}…${value.slice(-8)}`;
}

export function StadtstackProposalReceipts({
  suggestion,
  bindingReceipt,
  rootId,
  topicId,
}: {
  suggestion:
    | CitizenSignedTopicSuggestionV1
    | ParticipantTopicSuggestionV1
    | null;
  bindingReceipt: VerifiedPublicCaseBindingReceipt | null;
  rootId: string;
  topicId: string;
}) {
  const signature = projectPublicProposalSignature(suggestion);
  const caseReceipt = bindPublicCaseReceiptToProposal({
    suggestion,
    receipt: bindingReceipt,
    rootEventId: rootId,
    topicId,
  });
  const adoption = projectPublicCitizenAdoptionEvidence(caseReceipt);

  if (!signature && !caseReceipt) return null;

  return (
    <section
      aria-labelledby="stadtstack-proposal-receipts-title"
      data-civic-authority="none"
      className="mt-4 rounded-xl border border-slate-300 bg-slate-50 p-4"
    >
      <div className="flex items-start gap-3">
        <FileKey2 className="mt-0.5 h-5 w-5 shrink-0 text-slate-700" />
        <div>
          <h3
            id="stadtstack-proposal-receipts-title"
            className="text-sm font-bold text-foreground"
          >
            Signaturen, Berechtigung und öffentliche Fallquittung
          </h3>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">
            Jeder Übergang bleibt ein eigener Nachweis. Eine Kontosignatur ist
            weder Bürgerberechtigung noch Verwaltungsfreigabe.
          </p>
        </div>
      </div>

      <div className="mt-4 grid gap-3 lg:grid-cols-3">
        {signature ? (
          <article className="rounded-lg border border-emerald-200 bg-white p-3">
            <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wide text-emerald-800">
              <CheckCircle2 className="h-4 w-4" /> Nostr-Signatur geprüft
            </div>
            <p className="mt-2 text-sm font-bold text-foreground">
              {signature.kind === "participant_request"
                ? "Mit verbundenem Röbel-Konto angefragt"
                : "Legacy-Staging-Kandidat signiert"}
            </p>
            <p className="mt-1 text-xs leading-5 text-muted-foreground">
              Ereignis {short(signature.eventId)} · Schlüssel{" "}
              {short(signature.signerPubkey)}
            </p>
            <p className="mt-2 inline-flex rounded-full bg-amber-100 px-2.5 py-1 text-[11px] font-bold text-amber-950">
              {adoption
                ? "Teilnahme-Signatur bleibt getrennt"
                : "Bürgerberechtigung noch nicht nachgewiesen"}
            </p>
            <p className="mt-2 text-xs leading-5 text-emerald-950">
              {signature.nextGate === "citizen_adoption"
                ? adoption
                  ? "Die Signatur belegt den unveränderten Teilnahme-Entwurf. Bürgerberechtigung und spätere Übernahme sind als getrennte Nachweise gebunden."
                  : "Die Signatur belegt das verbundene Konto. Eine getrennte, verifizierte Bürgerübernahme ist weiterhin erforderlich."
                : "Dieser synthetische Altpfad wartet auf eine getrennte menschliche Case-Steward-Prüfung und ist kein ADR-0023-Bürgernachweis."}
            </p>
          </article>
        ) : (
          <article className="rounded-lg border border-amber-200 bg-amber-50 p-3">
            <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wide text-amber-900">
              <ShieldAlert className="h-4 w-4" /> Signatur nicht projiziert
            </div>
            <p className="mt-2 text-xs leading-5 text-amber-950">
              Die Fallquittung bleibt sichtbar, aber diese Ansicht erfindet
              keine fehlende Bürger- oder Vorschlagssignatur.
            </p>
          </article>
        )}

        {adoption ? (
          <article className="rounded-lg border border-violet-200 bg-white p-3">
            <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wide text-violet-900">
              <ShieldCheck className="h-4 w-4" /> Bürgerübernahme verifiziert
            </div>
            <p className="mt-2 text-sm font-bold text-foreground">
              Kommunale Berechtigung für genau diesen Entwurf
            </p>
            <p className="mt-1 text-xs leading-5 text-muted-foreground">
              Bürger-Schlüssel {short(adoption.adopterPubkey)} · Ereignis{" "}
              {short(adoption.adoptionEventId)}
            </p>
            <p className="mt-2 break-all text-[11px] leading-5 text-violet-950">
              Berechtigungsquittung {adoption.eligibilityReceiptId}
            </p>
            <p className="mt-1 text-[11px] leading-5 text-muted-foreground">
              Policy {adoption.eligibilityPolicyVersion} · Aussteller{" "}
              {adoption.eligibilityIssuer} · Ledger-Annahme{" "}
              {short(adoption.adoptionAcceptanceReceiptChecksum)}
            </p>
            <p className="mt-2 text-xs leading-5 text-violet-950">
              Dieser Nachweis erlaubt nur die Anfrage an den Case Steward. Er
              ist keine Verwaltungsbefürwortung, keine bindende Abstimmung und
              keine Entscheidungs- oder Zahlungsbefugnis.
            </p>
          </article>
        ) : signature?.kind === "participant_request" ? (
          <article className="rounded-lg border border-amber-200 bg-amber-50 p-3">
            <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wide text-amber-900">
              <ShieldAlert className="h-4 w-4" /> Bürgerübernahme fehlt
            </div>
            <p className="mt-2 text-xs leading-5 text-amber-950">
              Weder das verbundene Konto noch seine Nostr-Signatur beweisen die
              kommunale Bürgerberechtigung. Ohne issuer-geprüfte Quittung,
              Bürger-Signatur und Ledger-Annahme bleibt der Case-Steward-
              Übergang gesperrt.
            </p>
          </article>
        ) : null}

        {caseReceipt ? (
          <article className="rounded-lg border border-sky-200 bg-white p-3">
            <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wide text-sky-900">
              <Landmark className="h-4 w-4" /> CivicCase öffentlich quittiert
            </div>
            <p className="mt-2 break-all text-xs font-semibold text-foreground">
              {caseReceipt.caseId}
            </p>
            <p className="mt-1 text-xs leading-5 text-muted-foreground">
              Fallversion {caseReceipt.caseVersion} · Quittung{" "}
              {short(caseReceipt.receiptChecksum)}
            </p>
            <p className="mt-2 text-xs leading-5 text-sky-950">
              Die checksum-verifizierte Quittung belegt nur die getrennte
              menschliche Aufnahme
              {adoption
                ? " samt exakter Adoption- und Berechtigungsbindung"
                : ""}
              . Sie schreibt nicht in openDesk, bestätigt keine
              Verwaltungsposition und ist kein kommunaler Beschluss, keine
              bindende Abstimmung, kein Treasury- oder Zahlungsauftrag.
            </p>
          </article>
        ) : (
          <article className="rounded-lg border border-border bg-white p-3">
            <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wide text-muted-foreground">
              <Landmark className="h-4 w-4" /> Noch keine Fallquittung
            </div>
            <p className="mt-2 text-xs leading-5 text-muted-foreground">
              Nur eine separat authentifizierte Case-Steward-Aufnahme darf einen
              CivicCase erzeugen. Diese öffentliche App löst sie nicht aus.
            </p>
          </article>
        )}
      </div>
    </section>
  );
}
