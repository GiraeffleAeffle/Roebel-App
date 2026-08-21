import type { NostrEvent } from "@netizen-labs/nostr";

export interface StadtstackNostrIntakeClientOptions {
  baseUrl: string;
  actorToken: string;
  canonicalCaseId: string;
  fetch?: typeof globalThis.fetch;
}

export interface StadtstackCommandReceipt {
  caseVersion: number;
  eventIds: string[];
  journalHeadChecksum: string;
}

export interface StadtstackNostrIntakeClient {
  ingestDiscussion(
    event: NostrEvent,
    relayRefs: readonly string[],
  ): Promise<StadtstackCommandReceipt>;
}

const SHA256 = /^sha256:[0-9a-f]{64}$/;
const CANONICAL_CASE_ID = /^urn:stadtstack:case:municipality:[a-z0-9][a-z0-9-]{0,119}:[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

function fail(code: string): never {
  throw new Error(`stadtstack_control_${code}`);
}

function endpoint(value: string): URL {
  let base: URL;
  try {
    base = new URL(value);
  } catch {
    fail("url_invalid");
  }
  const internalHttp =
    base.protocol === "http:" &&
    (base.hostname === "127.0.0.1" ||
      base.hostname === "localhost" ||
      base.hostname.endsWith(".svc.cluster.local"));
  if (
    (base.protocol !== "https:" && !internalHttp) ||
    base.username ||
    base.password ||
    base.pathname !== "/" ||
    base.search ||
    base.hash
  ) fail("url_invalid");
  return new URL("/v1/nostr/discussions", base.origin);
}

function receipt(value: unknown, canonicalCaseId: string): StadtstackCommandReceipt {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail("response_invalid");
  const record = value as Record<string, unknown>;
  const expectedEventIds = [1, 2].map((version) => `urn:stadtstack:case-event:${canonicalCaseId}:${version}`);
  if (
    Object.keys(record).sort().join(",") !==
      "caseVersion,eventIds,journalHeadChecksum" ||
    record.caseVersion !== 2 ||
    !Array.isArray(record.eventIds) ||
    JSON.stringify(record.eventIds) !== JSON.stringify(expectedEventIds) ||
    typeof record.journalHeadChecksum !== "string" ||
    !SHA256.test(record.journalHeadChecksum)
  ) fail("response_invalid");
  return {
    caseVersion: record.caseVersion as number,
    eventIds: [...record.eventIds] as string[],
    journalHeadChecksum: record.journalHeadChecksum,
  };
}

export function createStadtstackNostrIntakeClient(
  options: StadtstackNostrIntakeClientOptions,
): StadtstackNostrIntakeClient {
  const url = endpoint(options.baseUrl);
  if (typeof options.canonicalCaseId !== "string" || !CANONICAL_CASE_ID.test(options.canonicalCaseId)) fail("case_id_invalid");
  if (
    typeof options.actorToken !== "string" ||
    options.actorToken.length < 32 ||
    options.actorToken !== options.actorToken.trim() ||
    /[\u0000-\u0020\u007f]/.test(options.actorToken)
  ) fail("token_invalid");
  const fetcher = options.fetch ?? globalThis.fetch;
  if (typeof fetcher !== "function") fail("fetch_unavailable");
  return Object.freeze({
    async ingestDiscussion(event: NostrEvent, relayRefs: readonly string[]) {
      if (!Array.isArray(relayRefs)) fail("relay_invalid");
      const response = await fetcher(url, {
        method: "POST",
        headers: {
          authorization: `Bearer ${options.actorToken}`,
          "content-type": "application/json",
          "x-stadtstack-actor-id": "roebel:nostr-ingestor",
        },
        body: JSON.stringify({ event, relayRefs: [...relayRefs] }),
      });
      if (!response.ok) fail("unavailable");
      let value: unknown;
      try {
        value = await response.json();
      } catch {
        fail("response_invalid");
      }
      return receipt(value, options.canonicalCaseId);
    },
  });
}
