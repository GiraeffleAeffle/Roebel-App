import { afterEach, beforeEach, describe, it, mock } from "node:test";
import assert from "node:assert/strict";
import { createSessionStore } from "../src/lib/workspace/session-store";

const CLUSTER = "http://roebel-tracer-postgrest.stadtstack-roebel-staging-lab.svc.cluster.local:3000";
const KEY = "synthetic-workspace-database-key";
const ENV = ["WORKSPACE_SESSION_DATABASE_URL", "WORKSPACE_SESSION_DATABASE_KEY",
  "NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "ROEBEL_PUBLIC_DEPLOYMENT_PROFILE"];
const session = { sub: "synthetic-oidc-subject", groups: ["test-role"], accessToken: "test-access",
  refreshToken: "test-refresh", expiresAt: Date.parse("2026-09-17T00:00:00Z") };

describe("workspace session database at runtime", () => {
  let saved: Map<string, string | undefined>;
  beforeEach(() => {
    saved = new Map(ENV.map((key) => [key, process.env[key]]));
    for (const key of ENV) delete process.env[key];
    process.env.ROEBEL_PUBLIC_DEPLOYMENT_PROFILE = "talos_staging_synthetic_workflow";
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://runtime-config-required.invalid";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "unused-build-placeholder";
    process.env.WORKSPACE_SESSION_DATABASE_KEY = KEY;
  });
  afterEach(() => {
    mock.restoreAll();
    for (const [key, value] of saved) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  for (const origin of [CLUSTER, "https://workspace-db.example.invalid"]) {
    it(`persists and revokes sessions through the configured ${origin === CLUSTER ? "PostgREST" : "Supabase"} endpoint`, async () => {
      process.env.WORKSPACE_SESSION_DATABASE_URL = origin;
      const methods: string[] = [];
      let row: Record<string, unknown> | null = null;
      mock.method(globalThis, "fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
        const request = new Request(input, init), url = new URL(request.url);
        assert.equal(url.origin, origin);
        assert.equal(url.pathname, origin === CLUSTER ? "/workspace_sessions" : "/rest/v1/workspace_sessions");
        assert.equal(request.redirect, "error");
        assert.equal(request.headers.get("authorization"), `Bearer ${KEY}`);
        methods.push(request.method);
        if (request.method === "POST") {
          row = await request.json();
          return new Response(null, { status: 201 });
        }
        assert.equal(url.searchParams.get("id"), "eq.test-session");
        if (request.method === "PATCH") {
          row = { ...row, ...await request.json() };
          return new Response(null, { status: 204 });
        }
        if (request.method === "DELETE") {
          row = null;
          return new Response(null, { status: 204 });
        }
        assert.equal(request.method, "GET");
        return Response.json(row ? [row] : []);
      });
      const store = createSessionStore();
      await store.create("test-session", session);
      assert.deepEqual(await store.get("test-session"), session);
      const refreshed = { ...session, accessToken: "renewed-token", groups: [] };
      await store.update("test-session", refreshed);
      assert.deepEqual(await store.get("test-session"), refreshed);
      await store.destroy("test-session");
      assert.equal(await store.get("test-session"), null);
      assert.deepEqual(methods, ["POST", "GET", "PATCH", "GET", "DELETE", "GET"]);
    });
  }

  it("does not fall back to build credentials when staging configuration is missing", async () => {
    const fetcher = mock.method(globalThis, "fetch", async () => { throw Error("unexpected request"); });
    for (const missing of ["WORKSPACE_SESSION_DATABASE_URL", "WORKSPACE_SESSION_DATABASE_KEY"]) {
      process.env.WORKSPACE_SESSION_DATABASE_URL = CLUSTER;
      process.env.WORKSPACE_SESSION_DATABASE_KEY = KEY;
      delete process.env[missing];
      await assert.rejects(createSessionStore().get("test-session"), /configuration_incomplete/);
    }
    delete process.env.WORKSPACE_SESSION_DATABASE_URL;
    delete process.env.WORKSPACE_SESSION_DATABASE_KEY;
    await assert.rejects(createSessionStore().get("test-session"), /configuration_incomplete/);
    assert.equal(fetcher.mock.callCount(), 0);
  });

  it("rejects untrusted HTTP and URLs containing credentials or paths", async () => {
    const fetcher = mock.method(globalThis, "fetch", async () => { throw Error("unexpected request"); });
    for (const url of ["http://untrusted.example.invalid", "https://user:password@db.example.invalid",
      "https://db.example.invalid/path", `${CLUSTER}?extra=1`]) {
      process.env.WORKSPACE_SESSION_DATABASE_URL = url;
      await assert.rejects(createSessionStore().get("test-session"), /url_invalid/);
    }
    assert.equal(fetcher.mock.callCount(), 0);
  });
});
