import assert from "node:assert/strict";
import test from "node:test";
import { createServer } from "node:http";
import { once } from "node:events";
import { createReviewGateway, type ReviewGatewayConfig } from "../src/lib/administration-review/gateway.ts";
import { fetchReviewWithPinnedHost } from "../src/lib/administration-review/transport.ts";

const caseId = "urn:stadtstack:synthetic-case:municipality:example-city:00000000-0000-4000-8000-000000000001";
function setup(actorClass: "case_steward" | "department_reviewer" = "department_reviewer", upstreamOrigin = "https://review.example") {
  const grant = { id: "planning-reviewer", label: "Stadtplanung · Prüfung", subject: "test-subject", actorId: "example:reviewer",
    actorClass, token: Buffer.alloc(32, 1).toString("base64url"), notBefore: 100, expiresAt: 1000 };
  const config: ReviewGatewayConfig = { environment: "staging", publicOrigin: "https://workspace.example", upstreamOrigin, caseId,
    assignmentTargets: [{ departmentId: "planning", label: "Stadtplanung", assignedAgentActorId: "example:agent", assignedReviewerActorId: "example:reviewer" }],
    grants: [grant, { ...grant, id: "other-department", subject: "another-subject", actorId: "other:reviewer", token: Buffer.alloc(32, 2).toString("base64url") }] };
  let subject: string | null = "test-subject", time = 200;
  const calls: { url: string; init: RequestInit }[] = [];
  const view = { schemaVersion: "administration_case_view_v1", caseId, testOnly: true, authorityBinding: "none", caseKind: "synthetic_case",
    actingAs: { actorId: grant.actorId, actorClass: grant.actorClass }, departmentPackages: [{ id: "package:planning" }] };
  let upstream = () => Response.json(view);
  const gateway = createReviewGateway(config, { authenticate: async () => subject ? { sub: subject } : null, now: () => time,
    fetch: async (url, init) => { calls.push({ url: String(url), init: init! }); return upstream(); } });
  const request = (query = "?role=planning-reviewer", method = "GET", headers: Record<string, string> = {}, body?: string) => gateway(new Request(config.publicOrigin + "/api/workspace/case-review" + query,
    { method, headers, ...(body === undefined ? {} : { body }) }));
  return { config, grant, view, calls, request, gateway, subject: (s: string | null) => { subject = s; }, time: (t: number) => { time = t; }, upstream: (f: typeof upstream) => { upstream = f; } };
}
const command = JSON.stringify({ schemaVersion: "administration_review_request_v1", operation: "review", expectedCaseVersion: 5,
  payload: { review: { packageId: "package:planning", decision: "accepted" } } });
const headers = { origin: "https://workspace.example", "content-type": "application/json", cookie: "roebel_ws=opaque-session" };

test("the real HTTP transport preserves the private Host and exact UTF-8 framing", async (t) => {
  const server = createServer(async (request, response) => {
    let body = "";
    for await (const chunk of request) body += String(chunk);
    response.setHeader("content-type", "application/json");
    response.end(JSON.stringify({ host: request.headers.host, length: request.headers["content-length"] ?? null, body }));
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => { server.closeAllConnections(); server.close(); });
  const port = (server.address() as { port: number }).port;
  const url = `http://127.0.0.1:${port}/v1/staging/administration/review`;
  const get = await fetchReviewWithPinnedHost(url, { method: "GET", headers: { host: "127.0.0.1" } });
  assert.deepEqual(await get.json(), { host: "127.0.0.1", length: null, body: "" });
  const body = JSON.stringify({ request: "Straße prüfen" });
  const post = await fetchReviewWithPinnedHost(url, { method: "POST", headers: { host: "127.0.0.1", "content-type": "application/json" }, body });
  assert.deepEqual(await post.json(), { host: "127.0.0.1", length: String(Buffer.byteLength(body)), body });
});

test("the admitted internal listener receives its pinned Host without browser credentials", async () => {
  const upstream = "http://roebel-case-steward-control.stadtstack-roebel-staging-lab.svc.cluster.local:18090";
  const h = setup(undefined, upstream);
  assert.equal((await h.request(undefined, "GET", headers)).status, 200);
  assert.equal(h.calls[0].url, upstream + "/v1/staging/administration/review");
  assert.deepEqual(h.calls[0].init.headers, { authorization: `Bearer ${h.grant.token}`, accept: "application/json", host: "127.0.0.1" });
});

test("ingress requests use the exact public Host while Next's URL names its bind address", async () => {
  const h = setup();
  const proxyHeaders = { host: "workspace.example", "x-forwarded-proto": "https" };
  const url = "https://0.0.0.0:8080/api/workspace/case-review";
  const roles = await h.gateway(new Request(url, { headers: proxyHeaders }));
  assert.equal(roles.status, 200);
  assert.equal((await roles.json()).roles[0].id, h.grant.id);
  const view = await h.gateway(new Request(url + "?role=planning-reviewer", { headers: proxyHeaders }));
  assert.equal(view.status, 200);
  assert.deepEqual(await view.json(), h.view);
  assert.equal(h.calls.length, 1);
});

test("forwarded host spoofing and nonpublic request origins cannot reach review", async () => {
  for (const [url, extra] of [
    ["https://0.0.0.0:8080", {}],
    ["https://0.0.0.0:8080", { host: "elsewhere.example", "x-forwarded-host": "workspace.example", "x-forwarded-proto": "https" }],
    ["https://0.0.0.0:8080", { host: "workspace.example.evil.example", "x-forwarded-proto": "https" }],
    ["https://0.0.0.0:8080", { host: "workspace.example", "x-forwarded-proto": "http" }],
    ["https://0.0.0.0:8080", { host: "workspace.example", "x-forwarded-proto": "https,http" }],
    ["http://0.0.0.0:8080", { host: "workspace.example", "x-forwarded-proto": "https" }],
    ["https://elsewhere.example", { host: "workspace.example", "x-forwarded-proto": "https" }],
  ] as [string, Record<string, string>][]) {
    const h = setup();
    const response = await h.gateway(new Request(url + "/api/workspace/case-review?role=planning-reviewer", { headers: extra }));
    assert.equal(response.status, 404);
    assert.equal(h.calls.length, 0);
  }
});

test("proxied review writes retain the browser-origin and credential checks", async () => {
  const h = setup();
  const url = "https://0.0.0.0:8080/api/workspace/case-review?role=planning-reviewer";
  const proxyHeaders = { host: "workspace.example", "x-forwarded-proto": "https", ...headers };
  h.upstream(() => Response.json({ schemaVersion: "synthetic_administration_review_receipt_v1", caseId, testOnly: true, authorityBinding: "none" }) as never);
  const response = await h.gateway(new Request(url, { method: "POST", headers: proxyHeaders, body: command }));
  assert.equal(response.status, 200);
  assert.equal(h.calls[0].init.body, command);
  for (const extra of [{ origin: "https://elsewhere.example" }, { origin: "" }, { "sec-fetch-site": "cross-site" }, { authorization: "Bearer browser-controlled" }] as Record<string, string>[]) {
    const before = h.calls.length;
    assert.equal((await h.gateway(new Request(url, { method: "POST", headers: { ...proxyHeaders, ...extra }, body: command }))).status, 403);
    assert.equal(h.calls.length, before);
  }
});

test("verified subject sees only assigned roles; backend receives only the server-owned credential", async () => {
  const h = setup(), roles = await (await h.request("")).json();
  assert.deepEqual(roles.roles, [{ id: h.grant.id, label: h.grant.label, actorClass: h.grant.actorClass }]);
  assert.ok(!JSON.stringify(roles).includes(h.grant.token)); assert.equal(h.calls.length, 0);
  const response = await h.request(undefined, "GET", { cookie: "roebel_ws=opaque-session" });
  assert.equal(response.status, 200); assert.deepEqual(await response.json(), h.view);
  assert.equal(h.calls[0].url, "https://review.example/v1/staging/administration/review");
  assert.deepEqual(h.calls[0].init.headers, { authorization: `Bearer ${h.grant.token}`, accept: "application/json" });
  assert.equal(h.calls[0].init.redirect, "error"); assert.equal(response.headers.get("cache-control"), "no-store");
});

test("unknown subjects, expired grants and forged role/Case or browser bearer never reach the backend", async () => {
  for (const fault of ["anonymous", "other-user", "expired", "role", "case", "duplicate", "bearer", "cross-site", "origin"]) {
    const h = setup(); let query = "?role=planning-reviewer", extra = {};
    if (fault === "anonymous") h.subject(null);
    if (fault === "other-user") h.subject("unassigned");
    if (fault === "expired") h.time(1000);
    if (fault === "role") query = "?role=other-department";
    if (fault === "case") query += "&caseId=other";
    if (fault === "duplicate") query += "&role=other-department";
    if (fault === "bearer") extra = { authorization: "Bearer browser-controlled" };
    if (fault === "cross-site") extra = { "sec-fetch-site": "cross-site" };
    if (fault === "origin") extra = { origin: "https://elsewhere.example" };
    assert.ok((await h.request(query, "GET", extra)).status >= 400, fault); assert.equal(h.calls.length, 0, fault);
  }
});

test("review POST requires same-origin JSON; preserves exact command bytes and refuses actor overrides", async () => {
  const h = setup();
  h.upstream(() => Response.json({ schemaVersion: "synthetic_administration_review_receipt_v1", caseId, testOnly: true, authorityBinding: "none", receipt: { caseVersion: 6 } }) as never);
  assert.equal((await h.request(undefined, "POST", headers, command)).status, 200);
  assert.equal(h.calls[0].init.body, command);
  assert.equal(new Headers(h.calls[0].init.headers).get("cookie"), null);
  assert.equal(new Headers(h.calls[0].init.headers).get("origin"), null);
  for (const [head, body] of [[{ "content-type": "application/json" }, command], [headers, JSON.stringify({ ...JSON.parse(command), actorId: "other" })], [headers, "x".repeat(65_537)]] as const) {
    const before = h.calls.length;
    assert.ok((await h.request(undefined, "POST", head, body)).status >= 400); assert.equal(h.calls.length, before);
  }
});

test("wrong Case/actor and revoked session responses are withheld; errors and redirects cannot leak upstream data", async () => {
  for (const fault of ["case", "actor", "expiry", "logout", "error", "redirect", "oversize"]) {
    const h = setup();
    h.upstream(() => {
      if (fault === "expiry") h.time(1000);
      if (fault === "logout") h.subject(null);
      if (fault === "error") return new Response(h.grant.token, { status: 500 }) as never;
      if (fault === "redirect") return new Response(h.grant.token, { status: 302, headers: { location: "https://elsewhere.example" } }) as never;
      if (fault === "oversize") return new Response("x".repeat(1024 * 1024 + 1)) as never;
      return Response.json({ ...h.view, ...(fault === "case" ? { caseId: "other" } : {}), ...(fault === "actor" ? { actingAs: { actorId: "other" } } : {}) });
    });
    const response = await h.request(); assert.ok(response.status >= 400, fault);
    assert.ok(!(await response.text()).includes(h.grant.token)); assert.equal(response.headers.get("location"), null);
  }
});

test("configuration rejects production, token reuse and unreviewed plaintext destinations", () => {
  for (const change of [(c: ReviewGatewayConfig) => { c.environment = "production" as never; },
    (c: ReviewGatewayConfig) => { c.upstreamOrigin = "http://localhost:18090"; },
    (c: ReviewGatewayConfig) => { c.grants[1].token = c.grants[0].token; }]) {
    const h = setup(); change(h.config);
    assert.throws(() => createReviewGateway(h.config, { authenticate: async () => null }), /configuration_invalid/);
  }
});


test("only the steward sees assignment targets and can use the configured department actors", async () => {
  const h = setup("case_steward");
  const view = await (await h.request()).json();
  assert.deepEqual(view.assignmentTargets, h.config.assignmentTargets);
  assert.equal(JSON.stringify(view).includes(h.grant.token), false);
  assert.equal((await (await setup().request()).json()).assignmentTargets, undefined);
  const target = h.config.assignmentTargets![0];
  const assignment = { schemaVersion: "administration_review_request_v1", operation: "assign", expectedCaseVersion: 3,
    payload: { departmentPackage: { id: "package:planning", departmentId: target.departmentId, suggestionId: "suggestion:one", request: "Assess the crossing.", assignedAgentActorId: target.assignedAgentActorId, assignedReviewerActorId: target.assignedReviewerActorId, authorityBinding: "none" } } };
  h.upstream(() => Response.json({schemaVersion: "synthetic_administration_review_receipt_v1", caseId, testOnly: true, authorityBinding: "none"}));
  const body = JSON.stringify(assignment);
  assert.equal((await h.request(undefined, "POST", headers, body)).status, 200);
  assert.equal(h.calls.at(-1)!.init.body, body);
  for (const patch of [{departmentId: "unconfigured"}, {assignedAgentActorId: "forged:agent"}, {assignedReviewerActorId: "forged:reviewer"}]) {
    const before = h.calls.length;
    assert.equal((await h.request(undefined, "POST", headers, JSON.stringify({...assignment, payload: {departmentPackage: {...assignment.payload.departmentPackage, ...patch}}}))).status, 403);
    assert.equal(h.calls.length, before);
  }
  const reviewer = setup();
  assert.equal((await reviewer.request(undefined, "POST", headers, body)).status, 403);
  assert.equal(reviewer.calls.length, 0);
  for (const targets of [[target, target], [{...target, assignedReviewerActorId: target.assignedAgentActorId}]]) {
    assert.throws(() => createReviewGateway({...h.config, assignmentTargets: targets}, {authenticate: async () => null}), /configuration_invalid/);
  }
});

test("only the steward can prepare and confirm a Brief through the existing session and origin checks", async () => {
  const h = setup("case_steward");
  for (const operation of ["prepare_brief", "apply_brief"]) {
    const schemaVersion = operation === "prepare_brief" ? "synthetic_citizen_brief_preparation_v1" : "synthetic_administration_review_receipt_v1";
    h.upstream(() => Response.json({ schemaVersion, caseId, testOnly: true, authorityBinding: "none" }));
    const body = JSON.stringify({ schemaVersion: "administration_review_request_v1", operation, expectedCaseVersion: 27, payload: { briefId: "brief:demo" } });
    assert.equal((await h.request(undefined, "POST", headers, body)).status, 200);
    assert.equal((await h.request(undefined, "POST", { ...headers, origin: "https://foreign.example" }, body)).status, 403);
    const other = setup("department_reviewer");
    assert.equal((await other.request(undefined, "POST", headers, body)).status, 403);
    assert.equal(other.calls.length, 0);
  }
});
