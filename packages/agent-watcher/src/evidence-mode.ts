export interface PublicMeckyEvidenceEnvironment {
  readonly STADTSTACK_E2E_MODE?: string;
  readonly STADTSTACK_E2E_SYNTHETIC_EVIDENCE_ALLOWED?: string;
}

export type PublicMeckyEvidenceMode =
  | {
      readonly kind: "reviewed_public";
      readonly ignoredLegacySyntheticRequest: boolean;
    }
  | {
      readonly kind: "synthetic_reviewed";
      readonly ignoredLegacySyntheticRequest: false;
    };

/**
 * Synthetic reviewed evidence is an isolated test capability, not a runtime
 * default. A legacy mode variable is deliberately insufficient on its own:
 * the workload must also carry the explicit E2E-only capability flag.
 */
export function resolvePublicMeckyEvidenceMode(
  environment: PublicMeckyEvidenceEnvironment,
): PublicMeckyEvidenceMode {
  const requestedMode = environment.STADTSTACK_E2E_MODE?.trim() ?? "";
  const syntheticPermission =
    environment.STADTSTACK_E2E_SYNTHETIC_EVIDENCE_ALLOWED?.trim() ?? "";

  if (requestedMode && requestedMode !== "synthetic-reviewed") {
    throw new Error("Public Mecky evidence mode is invalid.");
  }
  if (
    syntheticPermission &&
    syntheticPermission !== "true" &&
    syntheticPermission !== "false"
  ) {
    throw new Error("Public Mecky synthetic evidence permission is invalid.");
  }

  if (
    requestedMode === "synthetic-reviewed" &&
    syntheticPermission === "true"
  ) {
    return {
      kind: "synthetic_reviewed",
      ignoredLegacySyntheticRequest: false,
    };
  }

  return {
    kind: "reviewed_public",
    ignoredLegacySyntheticRequest: requestedMode === "synthetic-reviewed",
  };
}
