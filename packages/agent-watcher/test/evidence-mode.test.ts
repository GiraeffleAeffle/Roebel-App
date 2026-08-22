import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { resolvePublicMeckyEvidenceMode } from "../src/evidence-mode";

describe("resolvePublicMeckyEvidenceMode", () => {
  it("uses reviewed public retrieval by default", () => {
    assert.deepEqual(resolvePublicMeckyEvidenceMode({}), {
      kind: "reviewed_public",
      ignoredLegacySyntheticRequest: false,
    });
  });

  it("does not grant synthetic evidence to the legacy mode variable alone", () => {
    assert.deepEqual(
      resolvePublicMeckyEvidenceMode({
        STADTSTACK_E2E_MODE: "synthetic-reviewed",
      }),
      {
        kind: "reviewed_public",
        ignoredLegacySyntheticRequest: true,
      },
    );
  });

  it("requires both exact E2E values for synthetic reviewed evidence", () => {
    assert.deepEqual(
      resolvePublicMeckyEvidenceMode({
        STADTSTACK_E2E_MODE: "synthetic-reviewed",
        STADTSTACK_E2E_SYNTHETIC_EVIDENCE_ALLOWED: "true",
      }),
      {
        kind: "synthetic_reviewed",
        ignoredLegacySyntheticRequest: false,
      },
    );
  });

  it("does not grant synthetic evidence to the capability flag alone", () => {
    assert.deepEqual(
      resolvePublicMeckyEvidenceMode({
        STADTSTACK_E2E_SYNTHETIC_EVIDENCE_ALLOWED: "true",
      }),
      {
        kind: "reviewed_public",
        ignoredLegacySyntheticRequest: false,
      },
    );
  });

  it("rejects unknown evidence modes", () => {
    assert.throws(
      () => resolvePublicMeckyEvidenceMode({ STADTSTACK_E2E_MODE: "demo" }),
      /evidence mode is invalid/,
    );
  });

  it("rejects ambiguous synthetic permissions", () => {
    assert.throws(
      () =>
        resolvePublicMeckyEvidenceMode({
          STADTSTACK_E2E_MODE: "synthetic-reviewed",
          STADTSTACK_E2E_SYNTHETIC_EVIDENCE_ALLOWED: "1",
        }),
      /synthetic evidence permission is invalid/,
    );
  });
});
