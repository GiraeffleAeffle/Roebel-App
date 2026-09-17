import { verifyEvent, type NostrEvent } from "@netizen-labs/nostr";

import type { NostrPostEvidence } from "./public-evidence";

const APP_SOURCE_ID =
  /^(?:[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}|[0-9a-f]{64})$/iu;
const HEX_64 = /^[0-9a-f]{64}$/u;

export type DirectMentionEvidenceOptions = {
  readonly municipalityId: string;
  readonly agentPubkey: string;
} & ({ readonly publicIndexBaseUrl: string } | { readonly verifiedPublicEventUrl: string });

function publicIndexOrigin(value: string): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("Public Mecky index origin is invalid.");
  }
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    (url.pathname !== "/" && url.pathname !== "")
  ) {
    throw new Error("Public Mecky index origin is invalid.");
  }
  url.pathname = "/";
  return url;
}

/**
 * Admit only the exact signed note that explicitly asked Mecky to read it.
 * This verifies attribution and consent; it does not promote the author's
 * statement to editorial, official, or reviewed-civic authority.
 */
export function createDirectMentionEvidence(
  event: NostrEvent,
  options: DirectMentionEvidenceOptions,
): NostrPostEvidence {
  const municipalityId = options.municipalityId.trim();
  const agentPubkey = options.agentPubkey.toLowerCase();
  if (
    municipalityId !== options.municipalityId ||
    !/^[a-z0-9][a-z0-9-]{0,79}$/u.test(municipalityId) ||
    !HEX_64.test(agentPubkey) ||
    !verifyEvent(event) ||
    event.kind !== 1 ||
    !event.content.trim() ||
    Buffer.byteLength(event.content, "utf8") > 2_000 ||
    !Number.isSafeInteger(event.created_at) ||
    event.created_at < 1
  ) {
    throw new Error("Public Mecky direct mention is invalid.");
  }

  const meckyMentions = event.tags.filter(
    (tag) => tag.length >= 2 && tag[0] === "p" && tag[1]?.toLowerCase() === agentPubkey,
  );
  const postBindings = event.tags.filter((tag) => tag[0] === "source-app-post");
  const commentBindings = event.tags.filter((tag) => tag[0] === "source-app-comment");
  if (
    meckyMentions.length !== 1 ||
    postBindings.length !== 1 ||
    postBindings[0]!.length !== 2 ||
    !APP_SOURCE_ID.test(postBindings[0]![1] ?? "") ||
    commentBindings.length > 1 ||
    (commentBindings.length === 1 &&
      (commentBindings[0]!.length !== 2 || !APP_SOURCE_ID.test(commentBindings[0]![1] ?? "")))
  ) {
    throw new Error("Public Mecky direct mention binding is invalid.");
  }

  let eventUrl: URL;
  if ("publicIndexBaseUrl" in options) {
    eventUrl = new URL("events", publicIndexOrigin(options.publicIndexBaseUrl));
    eventUrl.searchParams.set("ids", event.id);
  } else {
    eventUrl = new URL(options.verifiedPublicEventUrl);
    if (eventUrl.protocol !== "https:" || eventUrl.username || eventUrl.password || eventUrl.search || eventUrl.hash) {
      throw new Error("Public Mecky event URL is invalid.");
    }
  }
  return {
    evidenceId: `sha256:${event.id}`,
    municipalityId,
    sourceKind: "nostr_post",
    authority: "community_statement",
    title: "Öffentlicher Röbel-Beitrag",
    summary: event.content.trim(),
    publishedAt: new Date(event.created_at * 1_000).toISOString(),
    admissionState: "admitted",
    lifecycle: "current",
    eventId: event.id,
    authorPubkey: event.pubkey.toLowerCase(),
    eventUrl: eventUrl.href,
    signatureValid: true,
    retrievalConsent: "direct_mention",
  };
}
