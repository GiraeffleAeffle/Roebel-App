import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { NetizenManifestSchema } from "@netizen-labs/protocol";
import { renderComposeYml, renderNextcloudSetup, renderRoebelIdEnv } from "../src/render.js";
import { doctor } from "../src/doctor.js";

/**
 * Task 17 — the workspace (Nextcloud + Collabora + the web app's OIDC session)
 * declared in the manifest, rendered by the installer, and checked by doctor.
 * See .superpowers/sdd/2026-07-28-sovereign-arbeitsbereich-slice1/task-17-brief.md.
 */

const roebel = JSON.parse(
  readFileSync(
    fileURLToPath(new URL("../../protocol/examples/roebel.netizen.json", import.meta.url)),
    "utf8",
  ),
);

const m = NetizenManifestSchema.parse(roebel);

test("the workspace declaration parses with the new fields", () => {
  assert.equal(m.services.workspace?.bearerValidation, true);
  assert.ok((m.services.workspace?.wopiHosts ?? []).includes("https://roebel.app"));
});

test("the manifest declares the web relying party, so the keystone learns about the app", () => {
  const web = m.identity?.relyingParties.find((r) => r.id === "web");
  assert.ok(web, "manifest must declare a `web` relying party");
  assert.ok(web!.redirectUris.some((u) => u.endsWith("/api/workspace/auth/callback")));
});

test("renderRoebelIdEnv emits the web client vars beside the nextcloud and matrix ones", () => {
  const env = renderRoebelIdEnv(m);
  assert.match(env, /^WEB_CLIENT_ID=web$/m);
  assert.match(env, /^WEB_CLIENT_SECRET=/m);
  assert.match(env, /^WEB_REDIRECT_URIS=.*\/api\/workspace\/auth\/callback/m);
});

// FACT (verified live, 2026-07-28): the keystone issues OPAQUE access tokens
// (panva default, no `formats` config), not self-encoded JWTs. So
// `selfencoded_bearer_validation` would reject every token it issues, and the
// live node runs with it OFF — `userinfo_bearer_validation` is what actually
// validates our tokens. The task-17 brief predates this discovery and asserts
// the opposite (selfencoded=1); that would be wrong for this deployment, so
// these assertions encode the live, correct configuration instead.
test("renderNextcloudSetup turns on userinfo bearer validation, without which the app cannot read a file", () => {
  const sh = renderNextcloudSetup(m);
  assert.match(sh, /userinfo_bearer_validation --value=1/);
  assert.match(sh, /selfencoded_bearer_validation --value=0/);
  assert.match(sh, /oidc_provider_bearer_validation --value=0/);
});

test("renderNextcloudSetup maps the uid to the sub, because the WebDAV path is derived from it", () => {
  assert.match(renderNextcloudSetup(m), /--unique-uid=0/);
});

test("renderComposeYml adds every declared WOPI host to Collabora's alias group", () => {
  const compose = renderComposeYml(m);
  assert.match(compose, /aliasgroup1: "https:\/\/cloud\.roebel\.app"/);
  assert.match(compose, /aliasgroup2: "https:\/\/roebel\.app"/);
});

test("doctor warns when a workspace declares collabora but no WOPI host", () => {
  const broken = structuredClone(m) as typeof m;
  broken.services.workspace!.wopiHosts = [];
  const warnings = doctor(broken).warnings.join("\n");
  assert.match(warnings, /wopiHosts/);
});

test("doctor warns when Nextcloud is declared without bearer validation", () => {
  const broken = structuredClone(m) as typeof m;
  broken.services.workspace!.bearerValidation = false;
  assert.match(doctor(broken).warnings.join("\n"), /bearerValidation/);
});

test("doctor warns when a workspace has no group folders, so org scope cannot work", () => {
  const broken = structuredClone(m) as typeof m;
  broken.services.workspace!.groupFolders = false;
  assert.match(doctor(broken).warnings.join("\n"), /groupFolders/);
});

test("doctor is quiet about workspace on the real manifest", () => {
  const warnings = doctor(m).warnings.join("\n");
  for (const term of ["wopiHosts", "bearerValidation", "groupFolders"]) {
    assert.doesNotMatch(warnings, new RegExp(term));
  }
});
