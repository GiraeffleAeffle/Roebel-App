import assert from "node:assert/strict";
import test from "node:test";
import { createReviewGateway, type ReviewGatewayConfig } from "../src/lib/administration-review/gateway.ts";

const caseId = "urn:stadtstack:synthetic-case:municipality:example-city:00000000-0000-4000-8000-000000000001";
function setup(actorClass: "case_steward" | "department_reviewer" = "department_reviewer") {
  const grant = { id: "planning-reviewer", label: "Stadtplanung · Prüfung", subject: "test-subject", actorId: "example:reviewer",
    actorClass, token: Buffer.alloc(32, 1).toString("base64url"), notBefore: 100, expiresAt: 1000 };
  const config: ReviewGatewayConfig = { environment: "staging", publicOrigin: "https://workspace.example", upstreamOrigin: "https://review.example", caseId,
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
  return { config, grant, view, calls, request, subject: (s: string | null) => { subject = s; }, time: (t: number) => { time = t; }, upstream: (f: typeof upstream) => { upstream = f; } };
}
const command = JSON.stringify({ schemaVersion: "administration_review_request_v1", operation: "review", expectedCaseVersion: 5,
  payload: { review: { packageId: "package:planning", decision: "accepted" } } });
const headers = { origin: "https://workspace.example", "content-type": "application/json", cookie: "roebel_ws=opaque-session" };

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
