/** Browser session → explicit server-owned staging role → private Case service.
 * No app, wallet or organisation membership implicitly grants municipal roles.
 */
export type ReviewGrant = {
  id: string; label: string; subject: string; actorId: string;
  actorClass: "case_steward" | "administration" | "department_agent" | "department_reviewer";
  token: string; notBefore: number; expiresAt: number;
};
export type ReviewGatewayConfig = {
  environment: "staging"; publicOrigin: string; upstreamOrigin: string; caseId: string;
  grants: ReviewGrant[];
};
const CASE = /^urn:stadtstack:synthetic-case:municipality:[a-z0-9-]+:[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/;
const ENDPOINT = "/api/workspace/case-review";
const UPSTREAM = "/v1/staging/administration/review";
const HEADERS = { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff" };
const reply = (status: number, value: unknown) => new Response(JSON.stringify(value), { status, headers: HEADERS });
const error = (status: number, code: string) => reply(status, { error: code });
function origin(raw: string, upstream = false): string {
  const url = new URL(raw);
  const internal = url.hostname === "roebel-case-steward-control.stadtstack-roebel-staging-lab.svc.cluster.local" && url.port === "18090";
  if (url.origin !== raw || url.username || url.password ||
    !(url.protocol === "https:" || (upstream && internal && url.protocol === "http:"))) throw Error();
  return url.origin;
}
async function boundedText(response: Request | Response, limit: number): Promise<string> {
  if (!response.body) return "";
  const reader = response.body.getReader(); const parts: Uint8Array[] = []; let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read(); if (done) break;
      total += value.length; if (total > limit) throw Error("too_large"); parts.push(value);
    }
    const bytes = new Uint8Array(total); let offset = 0;
    for (const part of parts) { bytes.set(part, offset); offset += part.length; }
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } finally { await reader.cancel(); reader.releaseLock(); }
}

export function createReviewGateway(config: ReviewGatewayConfig, dependencies: {
  /** Only a subject from a verified, unexpired server-side OIDC session. */
  authenticate(): Promise<{ sub: string } | null>;
  fetch?: typeof fetch; now?: () => number;
}) {
  let settings: ReviewGatewayConfig;
  try {
    settings = structuredClone(config);
    if (settings.environment !== "staging" || !CASE.test(settings.caseId) ||
      !Array.isArray(settings.grants) || settings.grants.length < 1 || settings.grants.length > 64) throw Error();
    origin(settings.publicOrigin); origin(settings.upstreamOrigin, true);
    const ids = new Set<string>(), tokens = new Set<string>();
    for (const grant of settings.grants) {
      if (!/^[a-z0-9-]{1,64}$/.test(grant.id) || ids.has(grant.id) ||
        typeof grant.label !== "string" || !grant.label.trim() || grant.label.length > 100 ||
        typeof grant.subject !== "string" || !grant.subject || grant.subject.length > 256 ||
        !/^[A-Za-z0-9:._-]{1,256}$/.test(grant.actorId) ||
        !["case_steward", "administration", "department_agent", "department_reviewer"].includes(grant.actorClass) ||
        !/^[A-Za-z0-9_-]{43}$/.test(grant.token) || Buffer.from(grant.token, "base64url").toString("base64url") !== grant.token || tokens.has(grant.token) ||
        !Number.isSafeInteger(grant.notBefore) || !Number.isSafeInteger(grant.expiresAt) ||
        grant.notBefore < 0 || grant.expiresAt <= grant.notBefore) throw Error();
      ids.add(grant.id); tokens.add(grant.token);
    }
  } catch { throw new Error("review_gateway_configuration_invalid"); }
  const fetcher = dependencies.fetch ?? fetch, now = dependencies.now ?? Date.now;
  return async (request: Request): Promise<Response> => {
    try {
      const session = await dependencies.authenticate();
      if (!session?.sub) return error(401, "authentication_required");
      const url = new URL(request.url);
      if (url.origin !== settings.publicOrigin || url.pathname !== ENDPOINT) return error(404, "not_found");
      if (!["GET", "POST"].includes(request.method)) return error(405, "method_not_allowed");
      if (request.headers.has("authorization") || request.headers.get("sec-fetch-site") === "cross-site" ||
        (request.headers.has("origin") && request.headers.get("origin") !== settings.publicOrigin) ||
        (request.method === "POST" && request.headers.get("origin") !== settings.publicOrigin)) return error(403, "request_origin_rejected");
      const time = now();
      if (!Number.isSafeInteger(time)) return error(503, "review_unavailable");
      const grants = settings.grants.filter((g) => g.subject === session.sub && time >= g.notBefore && time < g.expiresAt);
      if (!grants.length) return error(403, "review_role_required");
      if ([...url.searchParams.keys()].some((key) => key !== "role") || url.searchParams.getAll("role").length > 1) return error(400, "request_invalid");
      const role = url.searchParams.get("role");
      if (request.method === "GET" && role === null) return reply(200, { caseId: settings.caseId, testOnly: true,
        roles: grants.map(({ id, label, actorClass }) => ({ id, label, actorClass })) });
      const grant = grants.find((g) => g.id === role);
      if (!grant) return error(403, "review_role_required");
      let body: string | undefined;
      if (request.method === "POST") {
        if (request.headers.get("content-type")?.split(";")[0].trim() !== "application/json") return error(400, "request_invalid");
        try { body = await boundedText(request, 65_536); }
        catch { return error(413, "request_too_large"); }
        let command;
        try { command = JSON.parse(body); } catch { return error(400, "request_invalid"); }
        if (!command || Object.keys(command).sort().join() !== "expectedCaseVersion,operation,payload,schemaVersion" ||
          command.schemaVersion !== "administration_review_request_v1" || !["assign", "draft", "review"].includes(command.operation)) return error(400, "request_invalid");
      }
      const upstream = await fetcher(settings.upstreamOrigin + UPSTREAM, { method: request.method,
        headers: { authorization: `Bearer ${grant.token}`, accept: "application/json", ...(body === undefined ? {} : { "content-type": "application/json" }) },
        body, cache: "no-store", redirect: "error", signal: AbortSignal.timeout(10_000) });
      if (!upstream.ok) {
        // Never forward upstream error bodies, headers, credentials or redirects.
        const status = [400, 401, 403, 409, 413].includes(upstream.status) ? upstream.status : 503;
        await upstream.body?.cancel();
        return error(status, status === 409 ? "review_conflict" : "review_unavailable");
      }
      const value = JSON.parse(await boundedText(upstream, 1024 * 1024));
      if (!value || value.caseId !== settings.caseId || value.testOnly !== true || value.authorityBinding !== "none") throw Error();
      if (request.method === "GET" && (value.schemaVersion !== "administration_case_view_v1" || value.caseKind !== "synthetic_case" ||
        value.actingAs?.actorId !== grant.actorId || value.actingAs?.actorClass !== grant.actorClass)) throw Error();
      if (request.method === "POST" && value.schemaVersion !== "synthetic_administration_review_receipt_v1") throw Error();
      // Expiry/revocation during a slow request must not expose its response.
      const current = await dependencies.authenticate(), finished = now();
      if (current?.sub !== session.sub || !Number.isSafeInteger(finished) || finished >= grant.expiresAt || finished < grant.notBefore) return error(401, "authentication_required");
      return reply(200, value);
    } catch { return error(503, "review_unavailable"); }
  };
}
