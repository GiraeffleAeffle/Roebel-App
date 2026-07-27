import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { doctor, formatDoctorReport, detectIdpDrift } from "../src/doctor.js";

const roebel = JSON.parse(
  readFileSync(
    fileURLToPath(new URL("../../protocol/examples/roebel.netizen.json", import.meta.url)),
    "utf8",
  ),
);

// Röbel declares only what the installer can stand up today; endpoint coverage
// is asserted against a node that declares Matrix too.
const withMatrix = {
  ...roebel,
  services: {
    ...roebel.services,
    chat: {
      ...roebel.services.chat,
      matrix: {
        homeserver: "https://matrix.roebel.app",
        mas: "https://auth.roebel.app",
        element: "https://chat.roebel.app",
      },
    },
  },
};

test("doctor reports secrets, endpoints, and plan for the node", () => {
  const r = doctor(withMatrix);
  assert.equal(r.node, "roebel");
  assert.ok(r.secretRefs.includes("$ROEBEL_ID_JWKS"));
  assert.ok(r.endpoints.some((e) => e.name === "matrix homeserver" && e.url.includes("matrix.roebel.app")));
  assert.ok(r.plan.length >= 7);
});

test("doctor surfaces sovereignty warnings (thirdweb bridge, off-node AI)", () => {
  const r = doctor(roebel);
  assert.ok(r.warnings.some((w) => /thirdweb/.test(w)));
  assert.ok(r.warnings.some((w) => /not self-hosted/.test(w)));
});

test("formatDoctorReport is human-readable", () => {
  const out = formatDoctorReport(doctor(roebel));
  assert.match(out, /node: roebel/);
  assert.match(out, /secrets to supply/);
  assert.match(out, /plan \(\d+ steps\)/);
});

// --- manifest <-> keystone drift (the failure that bit the live node twice) ---

test("detects the issuer mismatch that broke logins on the live node", () => {
  const d = detectIdpDrift(roebel, {
    issuer: "https://roebel-id.fly.dev", // what the keystone actually served
    scopes_supported: roebel.identity.idp.scopes,
    claims_supported: roebel.identity.idp.claims,
  });
  const issuer = d.find((f) => f.field === "issuer");
  assert.ok(issuer, "issuer drift must be reported");
  assert.equal(issuer.expected, "https://id.roebel.app");
  assert.equal(issuer.actual, "https://roebel-id.fly.dev");
});

test("reports a keystone that cannot be reached at all", () => {
  const d = detectIdpDrift(roebel, null);
  assert.equal(d.length, 1);
  assert.equal(d[0].actual, "unreachable");
});

test("flags a missing groups claim — workspace authorisation depends on it", () => {
  const d = detectIdpDrift(roebel, {
    issuer: roebel.identity.idp.issuer,
    scopes_supported: roebel.identity.idp.scopes,
    claims_supported: roebel.identity.idp.claims.filter((c: string) => c !== "groups"),
  });
  assert.ok(d.some((f) => f.field === "claim:groups"));
});

test("a keystone matching the manifest reports no drift", () => {
  const d = detectIdpDrift(roebel, {
    issuer: roebel.identity.idp.issuer,
    authorization_endpoint: `${roebel.identity.idp.issuer}/auth`,
    scopes_supported: roebel.identity.idp.scopes,
    claims_supported: roebel.identity.idp.claims,
  });
  assert.deepEqual(d, []);
});
