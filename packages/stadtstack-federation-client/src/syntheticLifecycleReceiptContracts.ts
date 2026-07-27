import { z } from "zod";

export const ROEBEL_PUBLIC_SYNTHETIC_LIFECYCLE_RECEIPT_SCHEMA_VERSION =
  "roebel_public_synthetic_lifecycle_receipt_v1" as const;

export const ROEBEL_R4_PUBLIC_RESPONSE_SHA256 =
  "sha256:7cdd507f5b201385839e6310594b7a87c6de26c1a63269fdc46c7c50a11ae66e" as const;

export const ROEBEL_R4_PRIVATE_RECEIPT_PAYLOAD_SHA256 =
  "sha256:11d0ff91e3a0b2267c1825b2a4893ccffe90da4f20269c25c4aa0f22bdcb3f3c" as const;

export const ROEBEL_SYNTHETIC_LIFECYCLE_STAGE_IDS = [
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

const CHECKSUM = /^sha256:[a-f0-9]{64}$/u;

const reviewedArtifactRefSchema = z
  .object({
    id: z.string().min(1),
    kind: z.string().min(1),
    uri: z.string().regex(/^urn:stadtstack:roebel-mueritz:marienfelder-strasse:/u),
    checksum: z.string().regex(CHECKSUM),
    reviewedAt: z.string().datetime(),
  })
  .strict();

const effectsSchema = z
  .object({
    publication: z.literal(false),
    authority: z.literal(false),
    liveMutation: z.literal(false),
    stageTransition: z.literal(false),
    citizenNotification: z.literal(false),
    workspaceWrite: z.literal(false),
    councilSubmission: z.literal(false),
  })
  .strict();

const stageStatusSchema = z.enum([
  "captured_unreviewed",
  "partial_unreviewed",
  "awaiting_input",
  "not_started",
]);

export const roebelPublicSyntheticLifecycleReceiptSchema = z
  .object({
    schemaVersion: z.literal(
      ROEBEL_PUBLIC_SYNTHETIC_LIFECYCLE_RECEIPT_SCHEMA_VERSION
    ),
    receiptId: z.literal(
      "receipt:roebel-mueritz:marienfelder-strasse:synthetic-lifecycle:v1"
    ),
    caseKey: z
      .object({
        municipalityId: z.literal("roebel-mueritz"),
        decisionCaseSlug: z.literal("marienfelder-strasse"),
      })
      .strict(),
    truthState: z.literal("demo"),
    authority: z.literal("none"),
    notice: z.literal(
      "Synthetische, wirkungsfreie Demo-Quittung; keine reale Beteiligung oder Entscheidung."
    ),
    integrity: z
      .object({
        algorithm: z.literal("sha256"),
        canonicalization: z.literal("stadtstack_stable_json_v1"),
        payloadSha256: z.literal(
          ROEBEL_R4_PRIVATE_RECEIPT_PAYLOAD_SHA256
        ),
      })
      .strict(),
    stages: z.array(
      z
        .object({
          id: z.enum(ROEBEL_SYNTHETIC_LIFECYCLE_STAGE_IDS),
          owner: z.string().min(1),
          status: stageStatusSchema,
          timestamp: z.literal("2026-07-19T12:00:00.000Z"),
          blocker: z.string().min(1),
          nextAction: z.string().min(1),
          artifactRefs: z.array(reviewedArtifactRefSchema).length(1),
        })
        .strict()
    ),
    sourceRefs: z.array(reviewedArtifactRefSchema).length(3),
    publicProjection: z
      .object({
        truthState: z.literal("demo"),
        authority: z.literal("none"),
        lifecycleStatus: z.literal("synthetic_historical_demo"),
        sourceRefs: z.array(reviewedArtifactRefSchema).length(2),
        commitmentIds: z
          .array(
            z.literal(
              "commitment:roebel-mueritz:marienfelder-strasse:synthetic-evidence:v1"
            )
          )
          .length(1),
        nextStep: z.literal(
          "Durch geprüfte reale Quellen, Zuständigkeit und einen menschlich verantworteten Prozess ersetzen."
        ),
        scenarioCount: z.literal(3),
        recommendation: z.null(),
        departmentAnswerState: z.literal("synthetic_public_answer"),
      })
      .strict(),
    participation: z
      .object({
        totalAccepted: z.literal(0),
        totalStarted: z.literal(0),
        totalCompleted: z.literal(0),
        onlineCompleted: z.literal(0),
        offlineCompleted: z.literal(0),
        aggregateCount: z.literal(0),
        summary: z.literal(
          "Keine Beteiligung wurde geöffnet; das Ergebnis enthält keine Rohstimmen, Personen oder Identitäten."
        ),
      })
      .strict(),
    scenarios: z
      .object({
        ids: z.tuple([
          z.literal("maintain"),
          z.literal("targeted"),
          z.literal("integrated"),
        ]),
        recommendation: z.null(),
      })
      .strict(),
    commitment: z
      .object({
        ids: z
          .array(
            z.literal(
              "commitment:roebel-mueritz:marienfelder-strasse:synthetic-evidence:v1"
            )
          )
          .length(1),
        summary: z.literal(
          "Synthetische Beispielantwort ohne institutionelle Zustimmung, Außenwirkung oder reale Verpflichtung."
        ),
      })
      .strict(),
    delivery: z
      .object({
        id: z.literal(
          "delivery-event:roebel-mueritz:marienfelder-strasse:synthetic:v1"
        ),
        status: z.literal("Demo: nicht beauftragt und nicht live."),
        summary: z.literal(
          "Synthetischer, nicht ausführbarer Prüfmeilenstein."
        ),
      })
      .strict(),
    outcome: z
      .object({
        planId: z.literal(
          "outcome-plan:roebel-mueritz:marienfelder-strasse:synthetic:v1"
        ),
        evaluationId: z.literal(
          "outcome-evaluation:roebel-mueritz:marienfelder-strasse:synthetic:v1"
        ),
        summary: z.literal("Keine reale Veränderung bewertet."),
        uncertainty: z.literal(
          "Maximal: dies ist eine reine lokale Demo ohne Beobachtungsdaten."
        ),
        nextStep: z.literal(
          "Durch geprüfte reale Quellen, Zuständigkeit und einen menschlich verantworteten Prozess ersetzen."
        ),
      })
      .strict(),
    effects: effectsSchema,
  })
  .strict()
  .superRefine((receipt, context) => {
    const expectedStatuses = [
      "captured_unreviewed",
      "partial_unreviewed",
      "awaiting_input",
      ...Array.from({ length: 9 }, () => "not_started" as const),
    ];
    if (receipt.stages.length !== ROEBEL_SYNTHETIC_LIFECYCLE_STAGE_IDS.length) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["stages"],
        message: "The exact 12-stage synthetic lifecycle is required.",
      });
      return;
    }
    receipt.stages.forEach((stage, index) => {
      if (
        stage.id !== ROEBEL_SYNTHETIC_LIFECYCLE_STAGE_IDS[index] ||
        stage.status !== expectedStatuses[index]
      ) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["stages", index],
          message: "Synthetic lifecycle stage identity or status drifted.",
        });
      }
      if (
        stage.artifactRefs[0]?.id !== `simulation-stage:${stage.id}` ||
        stage.artifactRefs[0]?.kind !== "synthetic_lifecycle_stage"
      ) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["stages", index, "artifactRefs"],
          message: "Synthetic lifecycle stage artifact binding drifted.",
        });
      }
    });
  });

export type RoebelPublicSyntheticLifecycleReceiptV1 = z.infer<
  typeof roebelPublicSyntheticLifecycleReceiptSchema
>;
