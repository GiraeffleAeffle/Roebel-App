import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { doctor, formatDoctorReport } from "../src/doctor.js";

const roebel = JSON.parse(
  readFileSync(
    fileURLToPath(new URL("../../protocol/examples/roebel.netizen.json", import.meta.url)),
    "utf8",
  ),
);

test("doctor reports secrets, endpoints, and plan for the node", () => {
  const r = doctor(roebel);
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
