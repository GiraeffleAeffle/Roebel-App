import { z } from "zod";

export const CIVIC_FEDERATION_CASE_INDEX_SCHEMA_VERSION =
  "civic_federation_case_index_v1" as const;
export const CIVIC_FEDERATION_MANIFEST_SCHEMA_VERSION =
  "civic_federation_manifest_v1" as const;
export const CIVIC_CASE_STAGE_SNAPSHOT_SCHEMA_VERSION =
  "civic_case_stage_snapshot_v1" as const;
export const CIVIC_CASE_STAGE_ALGORITHM_VERSION = "1.0.0" as const;

export const CIVIC_CASE_MACRO_STAGE_IDS = [
  "facts",
  "mandate",
  "experience",
  "options",
  "decision",
  "delivery",
  "outcome",
] as const;

export const CIVIC_CASE_DETAIL_STAGE_IDS = [
  "candidate_selected",
  "evidence_baseline_ready",
  "authority_and_contract",
  "round_a_experience",
  "feasible_alternatives",
  "round_b_advisory",
  "administrative_synthesis",
  "official_decision",
  "institutional_response",
  "delivery",
  "outcome_evaluation",
  "impact_receipt_next_cycle",
] as const;

export const CIVIC_CASE_MACRO_STAGE_LABELS: Record<
  (typeof CIVIC_CASE_MACRO_STAGE_IDS)[number],
  string
> = {
  facts: "Fakten verstehen",
  mandate: "Mandat klären",
  experience: "Erfahrungen sammeln",
  options: "Optionen ausarbeiten und abwägen",
  decision: "Entscheiden und begründen",
  delivery: "Umsetzen",
  outcome: "Wirkung prüfen und zurückmelden",
};

const DETAIL_TO_MACRO: Record<
  (typeof CIVIC_CASE_DETAIL_STAGE_IDS)[number],
  (typeof CIVIC_CASE_MACRO_STAGE_IDS)[number]
> = {
  candidate_selected: "facts",
  evidence_baseline_ready: "facts",
  authority_and_contract: "mandate",
  round_a_experience: "experience",
  feasible_alternatives: "options",
  round_b_advisory: "options",
  administrative_synthesis: "options",
  official_decision: "decision",
  institutional_response: "decision",
  delivery: "delivery",
  outcome_evaluation: "outcome",
  impact_receipt_next_cycle: "outcome",
};

const DETAIL_REGISTRY: Record<
  (typeof CIVIC_CASE_DETAIL_STAGE_IDS)[number],
  { label: string; summary: string; required: boolean }
> = {
  candidate_selected: {
    label: "Fall ausgewählt",
    summary: "Das lokale Problem ist als überprüfbarer Entscheidungsfall beschrieben.",
    required: true,
  },
  evidence_baseline_ready: {
    label: "Evidenz und Ausgangslage",
    summary: "Quellen, bekannte Einschränkungen und Datenlücken sind nachvollziehbar.",
    required: true,
  },
  authority_and_contract: {
    label: "Mandat und Beteiligungsvertrag",
    summary: "Zuständigkeit, offene Fragen, Antwortpflicht und Entscheidungsroute sind bestätigt.",
    required: true,
  },
  round_a_experience: {
    label: "Runde A: Erfahrungen",
    summary: "Betroffene Perspektiven werden online und offline gesammelt und geprüft.",
    required: true,
  },
  feasible_alternatives: {
    label: "Machbare Alternativen",
    summary: "Verwaltung und Planung überführen Erfahrungen in realisierbare Optionen.",
    required: true,
  },
  round_b_advisory: {
    label: "Runde B: Optionen abwägen",
    summary: "Machbare Optionen können in einer getrennten beratenden Runde verglichen werden.",
    required: false,
  },
  administrative_synthesis: {
    label: "Verwaltungsprüfung und Entscheidungsbrief",
    summary: "Evidenz, Beteiligung, Machbarkeit, Kosten und offene Konflikte werden zusammengeführt.",
    required: true,
  },
  official_decision: {
    label: "Zuständige Entscheidung",
    summary: "Die zuständige Stelle entscheidet oder leitet den Fall durch die formale Route.",
    required: true,
  },
  institutional_response: {
    label: "Begründete institutionelle Antwort",
    summary: "Die Entscheidung wird mit Gründen, Zusagen, Zuständigkeiten und Fristen veröffentlicht.",
    required: true,
  },
  delivery: {
    label: "Umsetzung",
    summary: "Zusagen, Meilensteine, Änderungen, Verzögerungen und Nachweise bleiben sichtbar.",
    required: true,
  },
  outcome_evaluation: {
    label: "Wirkung auswerten",
    summary: "Beobachtungen werden gegen die Ausgangslage geprüft, inklusive Unsicherheit.",
    required: true,
  },
  impact_receipt_next_cycle: {
    label: "Wirkungsquittung und nächster Zyklus",
    summary: "Bewohner sehen Antwort, Umsetzung, Wirkung und den nächsten Schritt.",
    required: true,
  },
};

const ISO_DATE_TIME = z.string().datetime({ offset: true });
const HASH = z.string().regex(/^sha256:[a-f0-9]{64}$/);
const IDENTIFIER = z.string().trim().min(1).max(240);
const LABEL = z.string().trim().min(1).max(500);
const TEXT = z.string().trim().min(1).max(20_000);
const OPTIONAL_TEXT = TEXT.nullable();
const CASE_SLUG = z
  .string()
  .regex(/^[a-z0-9][a-z0-9-]{0,119}$/);
const PUBLIC_URL_REF = z.string().trim().min(1).max(2_048).refine((value) => {
  if (value.startsWith("/") && !value.startsWith("//")) return true;
  try {
    const url = new URL(value);
    return (
      (url.protocol === "http:" || url.protocol === "https:") &&
      !url.username &&
      !url.password
    );
  } catch {
    return false;
  }
}, "Expected a root-relative or public HTTP(S) URL.");

const macroStageIdSchema = z.enum(CIVIC_CASE_MACRO_STAGE_IDS);
const detailStageIdSchema = z.enum(CIVIC_CASE_DETAIL_STAGE_IDS);
const lifecycleSchema = z.enum([
  "not_started",
  "ready",
  "active",
  "waiting_external",
  "blocked",
  "completed",
  "not_applicable",
  "cancelled",
]);
const timelinessSchema = z.enum([
  "no_deadline",
  "on_track",
  "due_soon",
  "overdue",
]);
const truthStateSchema = z.enum([
  "reviewed",
  "pending_review",
  "review_due",
  "stale",
  "missing",
  "fallback",
  "demo",
]);
const participationAuthoritySchema = z.enum([
  "unconfirmed",
  "declared",
  "confirmed",
  "formal",
]);
const attentionSchema = z.enum([
  "normal",
  "watch",
  "action_required",
  "critical",
]);
const authorityBindingSchema = z.enum([
  "not_applicable",
  "declared",
  "confirmed",
  "formal_source",
]);

const municipalitySchema = z
  .object({
    id: CASE_SLUG,
    name: LABEL,
    state: LABEL,
    country: z.string().regex(/^[A-Z]{2}$/),
  })
  .strict();

const ownerSchema = z
  .object({
    id: IDENTIFIER,
    label: LABEL,
    kind: z.enum([
      "municipal_body",
      "committee",
      "local_advisory_board",
      "department",
      "operator_role",
      "independent_evaluator",
      "other",
    ]),
  })
  .strict();

const publicActionSchema = z
  .object({ label: LABEL, href: PUBLIC_URL_REF })
  .strict();

const currentStageSchema = z
  .object({
    macroStageId: macroStageIdSchema,
    detailStageId: detailStageIdSchema,
    position: z.number().int().min(1).max(7),
    total: z.literal(7),
    label: LABEL,
    lifecycle: lifecycleSchema,
    timeliness: timelinessSchema,
    truthState: truthStateSchema,
    owner: ownerSchema.nullable(),
    dueAt: ISO_DATE_TIME.nullable(),
    nextAction: OPTIONAL_TEXT,
    availablePublicAction: publicActionSchema.nullable(),
    blocker: OPTIONAL_TEXT,
    waitReason: OPTIONAL_TEXT,
    lastReviewedAt: ISO_DATE_TIME.nullable(),
  })
  .strict();

const macroStageSchema = z
  .object({
    id: macroStageIdSchema,
    position: z.number().int().min(1).max(7),
    label: LABEL,
    lifecycle: lifecycleSchema,
    timeliness: timelinessSchema,
    attention: attentionSchema,
    detailStageIds: z.array(detailStageIdSchema).min(1).max(4),
  })
  .strict();

const proofRefSchema = z
  .object({
    id: IDENTIFIER,
    label: LABEL,
    uri: PUBLIC_URL_REF.nullable(),
    checksum: HASH,
    reviewedAt: ISO_DATE_TIME.nullable(),
  })
  .strict();

const detailStageSchema = z
  .object({
    id: detailStageIdSchema,
    macroStageId: macroStageIdSchema,
    label: LABEL,
    summary: TEXT,
    required: z.boolean(),
    lifecycle: lifecycleSchema,
    timeliness: timelinessSchema,
    attention: attentionSchema,
    truthState: truthStateSchema,
    authorityBinding: authorityBindingSchema,
    owner: ownerSchema.nullable(),
    dueAt: ISO_DATE_TIME.nullable(),
    lastReviewedAt: ISO_DATE_TIME.nullable(),
    startedAt: ISO_DATE_TIME.nullable(),
    waitingSince: ISO_DATE_TIME.nullable(),
    waitReason: OPTIONAL_TEXT,
    completedAt: ISO_DATE_TIME.nullable(),
    nextAction: OPTIONAL_TEXT,
    availablePublicAction: publicActionSchema.nullable(),
    blocker: OPTIONAL_TEXT,
    proofRefs: z.array(proofRefSchema).max(100),
  })
  .strict();

function sequenceMatches(actual: readonly string[], expected: readonly string[]) {
  return (
    actual.length === expected.length &&
    actual.every((entry, index) => entry === expected[index])
  );
}

function jsonEqual(left: unknown, right: unknown) {
  return JSON.stringify(left) === JSON.stringify(right);
}

export const civicCaseStageSnapshotSchema = z
  .object({
    schemaVersion: z.literal(CIVIC_CASE_STAGE_SNAPSHOT_SCHEMA_VERSION),
    algorithmVersion: z.literal(CIVIC_CASE_STAGE_ALGORITHM_VERSION),
    caseKey: z
      .object({ municipalityId: CASE_SLUG, decisionCaseSlug: CASE_SLUG })
      .strict(),
    sourceArtifactSetHash: HASH,
    decisionRouteVersion: z.number().int().min(1).nullable(),
    truthState: truthStateSchema,
    participationAuthorityState: participationAuthoritySchema,
    primaryCurrentMacroStageId: macroStageIdSchema,
    primaryCurrentDetailStageId: detailStageIdSchema,
    parallelActiveDetailStageIds: z.array(detailStageIdSchema).max(11),
    current: currentStageSchema,
    macroStages: z.array(macroStageSchema).length(7),
    detailStages: z.array(detailStageSchema).length(12),
    derivedAt: ISO_DATE_TIME,
  })
  .strict()
  .superRefine((snapshot, context) => {
    if (
      !sequenceMatches(
        snapshot.macroStages.map((stage) => stage.id),
        CIVIC_CASE_MACRO_STAGE_IDS,
      )
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["macroStages"],
        message: "Macro stages must use the pinned v1 order.",
      });
    }
    if (
      !sequenceMatches(
        snapshot.detailStages.map((stage) => stage.id),
        CIVIC_CASE_DETAIL_STAGE_IDS,
      )
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["detailStages"],
        message: "Detail stages must use the pinned v1 order.",
      });
    }
    snapshot.macroStages.forEach((stage, index) => {
      const expectedChildren = CIVIC_CASE_DETAIL_STAGE_IDS.filter(
        (id) => DETAIL_TO_MACRO[id] === stage.id,
      );
      if (
        stage.position !== index + 1 ||
        stage.label !== CIVIC_CASE_MACRO_STAGE_LABELS[stage.id] ||
        !sequenceMatches(stage.detailStageIds, expectedChildren)
      ) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["macroStages", index],
          message: "Macro stage does not match the pinned v1 registry.",
        });
      }
    });
    snapshot.detailStages.forEach((stage, index) => {
      const definition = DETAIL_REGISTRY[stage.id];
      if (
        stage.macroStageId !== DETAIL_TO_MACRO[stage.id] ||
        stage.label !== definition.label ||
        stage.summary !== definition.summary ||
        stage.required !== definition.required
      ) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["detailStages", index],
          message: "Detail stage does not match the pinned v1 registry.",
        });
      }
    });
    const currentMacro = snapshot.macroStages.find(
      (stage) => stage.id === snapshot.primaryCurrentMacroStageId,
    );
    if (
      snapshot.current.macroStageId !== snapshot.primaryCurrentMacroStageId ||
      snapshot.current.detailStageId !== snapshot.primaryCurrentDetailStageId ||
      !currentMacro ||
      snapshot.current.position !== currentMacro.position ||
      snapshot.current.label !== currentMacro.label ||
      DETAIL_TO_MACRO[snapshot.primaryCurrentDetailStageId] !==
        snapshot.primaryCurrentMacroStageId
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["current"],
        message: "Current stage must match the pinned stage projections.",
      });
    }

    const primaryDetail = snapshot.detailStages.find(
      (stage) => stage.id === snapshot.primaryCurrentDetailStageId,
    );
    if (
      !primaryDetail ||
      primaryDetail.lifecycle !== snapshot.current.lifecycle ||
      primaryDetail.timeliness !== snapshot.current.timeliness ||
      primaryDetail.truthState !== snapshot.current.truthState ||
      !jsonEqual(primaryDetail.owner, snapshot.current.owner) ||
      primaryDetail.dueAt !== snapshot.current.dueAt ||
      primaryDetail.nextAction !== snapshot.current.nextAction ||
      !jsonEqual(
        primaryDetail.availablePublicAction,
        snapshot.current.availablePublicAction,
      ) ||
      primaryDetail.blocker !== snapshot.current.blocker ||
      primaryDetail.waitReason !== snapshot.current.waitReason ||
      primaryDetail.lastReviewedAt !== snapshot.current.lastReviewedAt
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["current"],
        message: "Current state must project the primary detail stage.",
      });
    }

    const expectedPrimary =
      snapshot.detailStages.find(
        (stage) =>
          stage.required &&
          stage.lifecycle !== "completed" &&
          stage.lifecycle !== "not_applicable",
      ) ?? snapshot.detailStages.at(-1);
    if (expectedPrimary?.id !== snapshot.primaryCurrentDetailStageId) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["primaryCurrentDetailStageId"],
        message: "Primary stage must be the earliest unfinished required stage.",
      });
    }

    const expectedParallel = snapshot.detailStages
      .filter(
        (stage) =>
          stage.id !== snapshot.primaryCurrentDetailStageId &&
          ["active", "waiting_external", "blocked"].includes(stage.lifecycle),
      )
      .map((stage) => stage.id);
    if (!sequenceMatches(snapshot.parallelActiveDetailStageIds, expectedParallel)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["parallelActiveDetailStageIds"],
        message: "Parallel stage ids must derive from the detail stages.",
      });
    }

    const attentionRank = {
      normal: 0,
      watch: 1,
      action_required: 2,
      critical: 3,
    } as const;
    snapshot.macroStages.forEach((macro, index) => {
      const children = snapshot.detailStages.filter(
        (stage) => stage.macroStageId === macro.id,
      );
      const expectedLifecycle = children.every(
        (stage) =>
          stage.lifecycle === "completed" || stage.lifecycle === "not_applicable",
      )
        ? "completed"
        : (children.find(
            (stage) =>
              stage.lifecycle !== "completed" &&
              stage.lifecycle !== "not_applicable",
          )?.lifecycle ?? "not_started");
      const expectedTimeliness = children.some(
        (stage) => stage.timeliness === "overdue",
      )
        ? "overdue"
        : children.some((stage) => stage.timeliness === "due_soon")
          ? "due_soon"
          : children.some((stage) => stage.timeliness === "on_track")
            ? "on_track"
            : "no_deadline";
      const expectedAttention = children.reduce<(typeof macro)["attention"]>(
        (highest, stage) =>
          attentionRank[stage.attention] > attentionRank[highest]
            ? stage.attention
            : highest,
        "normal",
      );
      if (
        macro.lifecycle !== expectedLifecycle ||
        macro.timeliness !== expectedTimeliness ||
        macro.attention !== expectedAttention
      ) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["macroStages", index],
          message: "Macro state must derive from its detail stages.",
        });
      }
    });
  });

const caseSummarySchema = z
  .object({
    decisionCaseSlug: CASE_SLUG,
    title: LABEL,
    publicSummary: TEXT,
    truthState: truthStateSchema,
    participationAuthorityState: participationAuthoritySchema,
    currentStage: currentStageSchema,
    manifestUrl: PUBLIC_URL_REF,
    stageMapUrl: PUBLIC_URL_REF,
    publicCaseUrl: PUBLIC_URL_REF,
    updatedAt: ISO_DATE_TIME,
  })
  .strict();

export const civicFederationCaseIndexSchema = z
  .object({
    schemaVersion: z.literal(CIVIC_FEDERATION_CASE_INDEX_SCHEMA_VERSION),
    municipality: municipalitySchema,
    generatedAt: ISO_DATE_TIME,
    cases: z.array(caseSummarySchema).max(100),
  })
  .strict()
  .superRefine((index, context) => {
    const slugs = new Set<string>();
    index.cases.forEach((entry, caseIndex) => {
      if (slugs.has(entry.decisionCaseSlug)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["cases", caseIndex, "decisionCaseSlug"],
          message: "Case slugs must be unique.",
        });
      }
      slugs.add(entry.decisionCaseSlug);
    });
  });

const artifactTypeSchema = z.enum([
  "decision_case",
  "participation_contract",
  "participation_result",
  "representation_audit",
  "institutional_response",
  "delivery_event",
  "outcome_plan",
  "outcome_observation",
  "outcome_evaluation",
  "impact_receipt",
  "forecast_question_contract",
  "forecast_aggregate",
  "decision_use_statement",
  "forecast_resolution_certificate",
  "forecast_scorecard",
]);

const manifestArtifactSchema = z
  .object({
    artifactType: artifactTypeSchema,
    artifactSchemaVersion: IDENTIFIER,
    artifactId: IDENTIFIER,
    artifactVersion: z.number().int().min(1),
    contentSha256: HASH,
    status: z.literal("reviewed"),
    url: PUBLIC_URL_REF,
    generatedAt: ISO_DATE_TIME,
  })
  .strict();

export const civicFederationCaseManifestSchema = z
  .object({
    schemaVersion: z.literal(CIVIC_FEDERATION_MANIFEST_SCHEMA_VERSION),
    municipality: municipalitySchema,
    decisionCaseSlug: CASE_SLUG,
    generatedAt: ISO_DATE_TIME,
    publicCaseUrl: PUBLIC_URL_REF,
    stageMap: z
      .object({
        url: PUBLIC_URL_REF,
        contentSha256: HASH,
        snapshot: civicCaseStageSnapshotSchema,
      })
      .strict(),
    artifacts: z.array(manifestArtifactSchema).min(1).max(100),
  })
  .strict()
  .superRefine((manifest, context) => {
    const snapshot = manifest.stageMap.snapshot;
    if (
      snapshot.caseKey.municipalityId !== manifest.municipality.id ||
      snapshot.caseKey.decisionCaseSlug !== manifest.decisionCaseSlug
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["stageMap", "snapshot", "caseKey"],
        message: "Stage map and manifest case identity must agree.",
      });
    }
    const logicalIds = new Set<string>();
    manifest.artifacts.forEach((artifact, index) => {
      const id = `${artifact.artifactType}:${artifact.artifactId}`;
      if (logicalIds.has(id)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["artifacts", index, "artifactId"],
          message: "Manifest cannot contain duplicate logical artifacts.",
        });
      }
      logicalIds.add(id);
    });
  });

export type CivicCaseStageSnapshotV1 = z.infer<
  typeof civicCaseStageSnapshotSchema
>;
export type CivicCaseCurrentStageSnapshot = z.infer<
  typeof currentStageSchema
>;
export type CivicFederationCaseIndexV1 = z.infer<
  typeof civicFederationCaseIndexSchema
>;
export type CivicFederationCaseSummaryV1 = z.infer<
  typeof caseSummarySchema
>;
export type CivicFederationCaseManifestV1 = z.infer<
  typeof civicFederationCaseManifestSchema
>;
