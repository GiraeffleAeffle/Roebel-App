import { z } from "zod";

export const CIVIC_TOPIC_CONTEXT_SCHEMA_VERSION =
  "civic_topic_context_v1" as const;

export const civicTopicContextSchema = z
  .object({
    schemaVersion: z.literal(CIVIC_TOPIC_CONTEXT_SCHEMA_VERSION),
    topic: z
      .object({
        topicId: z.literal(
          "topic:roebel-mueritz:marienfelder-strasse",
        ),
        municipalityId: z.literal("roebel-mueritz"),
        decisionCaseSlug: z.literal("marienfelder-strasse"),
        title: z.literal("Marienfelder Straße"),
        classification: z.literal("synthetic_demo_only"),
        truthState: z.literal("demo"),
        authority: z.literal("none"),
      })
      .strict(),
    externalProposalBinding: z
      .object({
        system: z.literal("roebel_app_governance"),
        status: z.literal("not_linked"),
        proposalId: z.null(),
        proposalNumber: z.null(),
        reviewedBindingArtifactRef: z.null(),
      })
      .strict(),
    modules: z
      .object({
        citizenVote: z
          .object({
            status: z.literal("not_opened"),
            method: z.null(),
            result: z.null(),
          })
          .strict(),
        treasury: z
          .object({
            status: z.literal("not_linked"),
            currency: z.null(),
            amount: z.null(),
            snapshotAt: z.null(),
          })
          .strict(),
        councilRecord: z
          .object({
            status: z.literal("source_records_unreviewed"),
            formalDecisionEffect: z.literal(false),
          })
          .strict(),
        administration: z
          .object({
            status: z.literal("synthetic_walkthrough_available"),
            currentStateVerified: z.literal(false),
          })
          .strict(),
        activityJournal: z
          .object({
            status: z.literal("reconstructed_synthetic_demo"),
            historicalEvidence: z.literal(true),
            currentStateVerified: z.literal(false),
            backfilled: z.literal(true),
            eventCount: z.literal(8),
          })
          .strict(),
      })
      .strict(),
    effects: z
      .object({
        citizenWrite: z.literal(false),
        voteWrite: z.literal(false),
        treasuryWrite: z.literal(false),
        workspaceWrite: z.literal(false),
        councilWrite: z.literal(false),
        publication: z.literal(false),
        civicCaseMutation: z.literal(false),
        stageTransition: z.literal(false),
        authorityConfirmation: z.literal(false),
      })
      .strict(),
  })
  .strict();

export type CivicTopicContextV1 = z.infer<typeof civicTopicContextSchema>;
