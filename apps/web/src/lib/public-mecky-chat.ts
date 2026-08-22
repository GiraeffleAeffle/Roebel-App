export const PUBLIC_MECKY_CHAT_REQUEST_SCHEMA =
  "public_mecky_chat_request_v1" as const;
export const PUBLIC_MECKY_CHAT_RESPONSE_SCHEMA =
  "public_mecky_chat_response_v1" as const;

const MAX_QUESTION_BYTES = 2_000;

export type PublicMeckyEvidenceRef = Readonly<{
  evidenceId: `sha256:${string}`;
  title: string;
  publicCaseUrl: string;
}>;

type PublicMeckyNoEffects = Readonly<{
  civicStateMutation: false;
  suggestionSubmission: false;
  vote: false;
}>;

export type PublicMeckyChatResponse =
  | Readonly<{
      schemaVersion: typeof PUBLIC_MECKY_CHAT_RESPONSE_SCHEMA;
      status: "answered";
      content: string;
      evidenceRefs: readonly PublicMeckyEvidenceRef[];
      authorityBinding: "none";
      effects: PublicMeckyNoEffects;
    }>
  | Readonly<{
      schemaVersion: typeof PUBLIC_MECKY_CHAT_RESPONSE_SCHEMA;
      status: "refused";
      reason: string;
      retryable: boolean;
      diagnosticCode: string;
      authorityBinding: "none";
      effects: PublicMeckyNoEffects;
    }>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype;
}

function exactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  return actual.length === wanted.length &&
    actual.every((key, index) => key === wanted[index]);
}

function noEffects(value: unknown): value is PublicMeckyNoEffects {
  return isRecord(value) &&
    exactKeys(value, ["civicStateMutation", "suggestionSubmission", "vote"]) &&
    value.civicStateMutation === false &&
    value.suggestionSubmission === false &&
    value.vote === false;
}

function publicHttpsUrl(value: unknown): value is string {
  if (typeof value !== "string") return false;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password &&
      !url.hash;
  } catch {
    return false;
  }
}

export function parsePublicMeckyChatQuestion(value: unknown): string {
  if (!isRecord(value) || !exactKeys(value, ["schemaVersion", "question"]) ||
    value.schemaVersion !== PUBLIC_MECKY_CHAT_REQUEST_SCHEMA ||
    typeof value.question !== "string" || value.question !== value.question.trim() ||
    !value.question || new TextEncoder().encode(value.question).byteLength > MAX_QUESTION_BYTES) {
    throw new Error("public_mecky_chat_request_invalid");
  }
  return value.question;
}

export function parsePublicMeckyChatResponse(value: unknown): PublicMeckyChatResponse {
  if (!isRecord(value) ||
    value.schemaVersion !== PUBLIC_MECKY_CHAT_RESPONSE_SCHEMA ||
    value.authorityBinding !== "none" || !noEffects(value.effects)) {
    throw new Error("public_mecky_chat_response_invalid");
  }
  if (value.status === "answered") {
    if (!exactKeys(value, [
      "schemaVersion", "status", "content", "evidenceRefs",
      "authorityBinding", "effects",
    ]) || typeof value.content !== "string" || !value.content.trim() ||
      value.content.length > 2_000 || !Array.isArray(value.evidenceRefs) ||
      value.evidenceRefs.length < 1 || value.evidenceRefs.length > 3) {
      throw new Error("public_mecky_chat_response_invalid");
    }
    const seen = new Set<string>();
    for (const evidence of value.evidenceRefs) {
      if (!isRecord(evidence) || !exactKeys(evidence, [
        "evidenceId", "title", "publicCaseUrl",
      ]) || typeof evidence.evidenceId !== "string" ||
        !/^sha256:[0-9a-f]{64}$/u.test(evidence.evidenceId) ||
        seen.has(evidence.evidenceId) || typeof evidence.title !== "string" ||
        !evidence.title.trim() || !publicHttpsUrl(evidence.publicCaseUrl)) {
        throw new Error("public_mecky_chat_response_invalid");
      }
      seen.add(evidence.evidenceId);
    }
    return value as unknown as PublicMeckyChatResponse;
  }
  if (value.status === "refused" && exactKeys(value, [
    "schemaVersion", "status", "reason", "retryable", "diagnosticCode",
    "authorityBinding", "effects",
  ]) && typeof value.reason === "string" && !!value.reason &&
    typeof value.retryable === "boolean" &&
    typeof value.diagnosticCode === "string" && !!value.diagnosticCode) {
    return value as unknown as PublicMeckyChatResponse;
  }
  throw new Error("public_mecky_chat_response_invalid");
}

export function publicMeckyChatEndpoint(baseUrl: string): URL {
  let base: URL;
  try {
    base = new URL(baseUrl);
  } catch {
    throw new Error("public_mecky_chat_url_invalid");
  }
  const local = base.protocol === "http:" &&
    ["localhost", "127.0.0.1", "[::1]"].includes(base.hostname);
  const clusterInternal = base.protocol === "http:" &&
    /^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?\.svc\.cluster\.local$/u.test(base.hostname);
  if ((!local && !clusterInternal) || base.username || base.password ||
    base.search || base.hash || (base.pathname !== "/" && base.pathname !== "")) {
    throw new Error("public_mecky_chat_url_invalid");
  }
  base.pathname = "/v1/answer";
  return base;
}

export async function requestPublicMeckyChat(input: {
  baseUrl: string;
  question: string;
  fetch?: typeof globalThis.fetch;
  signal?: AbortSignal;
}): Promise<PublicMeckyChatResponse> {
  const question = parsePublicMeckyChatQuestion({
    schemaVersion: PUBLIC_MECKY_CHAT_REQUEST_SCHEMA,
    question: input.question,
  });
  const fetcher = input.fetch ?? globalThis.fetch;
  const response = await fetcher(publicMeckyChatEndpoint(input.baseUrl), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      schemaVersion: PUBLIC_MECKY_CHAT_REQUEST_SCHEMA,
      question,
    }),
    cache: "no-store",
    signal: input.signal,
  });
  if (!response.ok) {
    throw new Error(`public_mecky_chat_http_${response.status}`);
  }
  return parsePublicMeckyChatResponse(await response.json());
}
