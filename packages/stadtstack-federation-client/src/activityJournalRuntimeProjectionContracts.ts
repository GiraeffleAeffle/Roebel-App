import { z } from "zod";

/**
 * A public-safe, historical receipt about the private Activity Journal
 * checkpoint. This is intentionally not the private Journal schema and never
 * contains Journal events, workspace identifiers, MCP inputs/outputs, or
 * current municipal state.
 */
export const ROEBEL_ACTIVITY_JOURNAL_RUNTIME_PROJECTION_SCHEMA_VERSION =
  "roebel_activity_journal_runtime_projection_v1" as const;

export const roebelActivityJournalRuntimeProjectionSchema = z
  .object({
    schemaVersion: z.literal(
      ROEBEL_ACTIVITY_JOURNAL_RUNTIME_PROJECTION_SCHEMA_VERSION
    ),
    projectionId: z.literal(
      "demo:roebel-mueritz:marienfelder-strasse:activity-journal-runtime:v1"
    ),
    caseKey: z
      .object({
        municipalityId: z.literal("roebel-mueritz"),
        decisionCaseSlug: z.literal("marienfelder-strasse"),
        topicRef: z.literal("topic:roebel-mueritz:marienfelder-strasse"),
        caseRef: z.literal("case:roebel-mueritz:marienfelder-strasse:v1"),
      })
      .strict(),
    truthState: z.literal("demo"),
    authority: z.literal("none"),
    checkpointObservedAt: z.literal("2026-07-24T08:27:35.000Z"),
    checkpointFreshness: z.literal(
      "historical_verified_receipt_not_live_health"
    ),
    notice: z.literal(
      "Ein privates, metadata-only Activity Journal wurde für den synthetischen Demo-Fall technisch nachgewiesen. Dieser Nachweis ist kein aktueller Status der Verwaltung und veröffentlicht weder interne Ereignisinhalte noch Arbeitsräume."
    ),
    runtime: z
      .object({
        state: z.literal("technically_verified_synthetic"),
        visibility: z.literal("administration_internal"),
        metadataOnly: z.literal(true),
        forwardOnly: z.literal(true),
        backfilled: z.literal(false),
        eventCount: z.literal(2),
        currentStateVerified: z.literal(false),
        mcpReadOnlyToolCount: z.literal(4),
        publicProjectionState: z.literal("candidate_not_publicly_routed"),
        publicEventCount: z.literal(0),
      })
      .strict(),
    durability: z
      .object({
        backupCompleted: z.literal(true),
        restorePerformed: z.literal(false),
      })
      .strict(),
    boundary: z
      .object({
        internalEventContentPublic: z.literal(false),
        internalMcpPublic: z.literal(false),
        openProjectDataPublic: z.literal(false),
        matrixDataPublic: z.literal(false),
        civicEffect: z.literal(false),
      })
      .strict(),
  })
  .strict();

export type RoebelActivityJournalRuntimeProjectionV1 = z.infer<
  typeof roebelActivityJournalRuntimeProjectionSchema
>;
