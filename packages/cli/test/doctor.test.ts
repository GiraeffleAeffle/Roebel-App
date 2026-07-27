import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { doctor, formatDoctorReport, detectIdpDrift, sovereigntyReport } from "../src/doctor.js";

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

test("sovereignty is measured from the manifest, pessimistically", () => {
  const r = sovereigntyReport(roebel);
  const byLayer = Object.fromEntries(r.map((l) => [l.layer, l]));

  // The deepest lock-in: the account minter decides every citizen's ADDRESS.
  assert.equal(byLayer["identity-keys"].provider, "thirdweb");
  assert.equal(byLayer["identity-keys"].sovereign, false);
  assert.match(byLayer["identity-keys"].note, /changing it changes addresses/);

  // The app's data spine is still managed SaaS.
  assert.equal(byLayer["data"].provider, "supabase");
  assert.equal(byLayer["data"].sovereign, false);

  // What the node genuinely owns.
  assert.equal(byLayer["workspace"].sovereign, true);
  assert.equal(byLayer["comms"].sovereign, true);

  // Durability counts as a sovereignty layer. Röbel declares restic-sftp, so it
  // reads as sovereign here — but the note points at the runtime check, because
  // a DECLARED offsite that is never configured still leaves dumps on the box.
  assert.equal(byLayer["durability"].sovereign, true);
  assert.match(byLayer["durability"].note, /verify ops\/status\.json/);
});

test("a node with no backups is reported as not durable, loudly", () => {
  const bare = { ...roebel };
  delete (bare as Record<string, unknown>).operations;
  const d = doctor(bare);
  const dur = d.sovereignty.find((l) => l.layer === "durability");
  assert.equal(dur?.sovereign, false);
  assert.match(dur?.note ?? "", /NO BACKUPS DECLARED/);
  assert.ok(d.warnings.some((w) => /less sovereign than the SaaS it replaced/.test(w)));
  assert.ok(d.warnings.some((w) => /no hardening declared/.test(w)));

  // On-box-only backups are called out separately: they protect against
  // corruption, not against losing the machine.
  const onBox = { ...roebel, operations: { backup: { schedule: "02:30", retentionDays: 14, offsite: "none" } } };
  assert.ok(doctor(onBox).warnings.some((w) => /never leave the box/.test(w)));
});

test("the human report shows a sovereignty score an operator can watch move", () => {
  const text = formatDoctorReport(doctor(roebel));
  assert.match(text, /sovereignty \(\d+\/\d+ layers under own control\)/);
  assert.match(text, /✗ identity-keys: thirdweb/);
  assert.match(text, /✓ workspace: self/);
});
