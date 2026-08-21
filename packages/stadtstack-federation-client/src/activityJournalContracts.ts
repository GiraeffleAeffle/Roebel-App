import { z } from "zod";

export const CIVIC_ACTIVITY_JOURNAL_CAPABILITIES_SCHEMA_VERSION =
  "civic_activity_journal_capabilities_v1" as const;
export const CIVIC_ACTIVITY_JOURNAL_EVENT_LIST_SCHEMA_VERSION =
  "civic_activity_journal_event_list_v1" as const;
export const CIVIC_ACTIVITY_JOURNAL_ACTION_TIMELINE_SCHEMA_VERSION =
  "civic_activity_journal_action_timeline_v1" as const;
export const CIVIC_ACTIVITY_JOURNAL_EVENT_SCHEMA_VERSION =
  "civic_activity_journal_event_v1" as const;
export const CIVIC_ACTIVITY_JOURNAL_SEGMENT_SEAL_SCHEMA_VERSION =
  "civic_activity_journal_segment_seal_v1" as const;

export const CIVIC_ACTIVITY_JOURNAL_EVENT_TYPES = [
  "proposal_recorded",
  "approval_requested",
  "approval_recorded",
  "approval_rejected",
  "agent_run_started",
  "agent_run_completed",
  "agent_run_failed",
  "integration_dispatch_requested",
  "integration_receipt_recorded",
  "department_handoff_recorded",
  "department_response_submitted",
  "decision_recorded",
  "delivery_event_recorded",
  "incident_recorded",
  "correction_recorded",
  "publication_recorded",
  "withdrawal_recorded",
] as const;

export const CIVIC_ACTIVITY_JOURNAL_STATUSES = [
  "proposed",
  "requested",
  "approved",
  "rejected",
  "running",
  "succeeded",
  "failed",
  "cancelled",
  "observed",
] as const;

export const ROEBEL_PUBLIC_SYNTHETIC_ACTIVITY_JOURNAL_EVENT_TYPES = [
  "proposal_recorded",
  "approval_recorded",
  "agent_run_started",
  "agent_run_completed",
  "department_handoff_recorded",
  "department_response_submitted",
  "publication_recorded",
] as const;

export const ROEBEL_PUBLIC_SYNTHETIC_ACTIVITY_JOURNAL_STATUSES = [
  "proposed",
  "approved",
  "running",
  "succeeded",
  "observed",
] as const;

export const CIVIC_ACTIVITY_JOURNAL_ACTOR_KINDS = [
  "human",
  "service",
  "agent",
] as const;

export const CIVIC_ACTIVITY_JOURNAL_ACTOR_REFS = [
  "role:synthetic-case-steward",
  "role:synthetic-workspace-coordinator",
  "role:synthetic-department-receiver",
  "role:synthetic-evidence-reviewer",
  "role:synthetic-publication-reviewer",
  "agent:synthetic-mecky-public",
  "service:stadtstack-synthetic-journal",
] as const;

export const CIVIC_ACTIVITY_JOURNAL_ACTOR_ROLE_CODES = [
  "case_steward",
  "workspace_coordinator",
  "department_receiver",
  "evidence_reviewer",
  "publication_reviewer",
  "public_city_companion",
  "journal_service",
] as const;

export const CIVIC_ACTIVITY_JOURNAL_ARTIFACT_KINDS = [
  "public_activity_receipt",
  "public_disposition",
  "public_projection",
] as const;

export const CIVIC_ACTIVITY_JOURNAL_DESCRIPTION_CODES = [
  "synthetic_case_registered",
  "synthetic_department_package_prepared",
  "synthetic_department_handoff_observed",
  "synthetic_companion_run_started",
  "synthetic_companion_run_completed",
  "synthetic_department_response_submitted",
  "synthetic_response_review_approved",
  "synthetic_public_return_recorded",
] as const;

export const ROEBEL_PUBLIC_SYNTHETIC_ACTIVITY_JOURNAL_EVENT_IDS = [
  "event:roebel-marienfelder:public:0001",
  "event:roebel-marienfelder:public:0002",
  "event:roebel-marienfelder:public:0003",
  "event:roebel-marienfelder:public:0004",
  "event:roebel-marienfelder:public:0005",
  "event:roebel-marienfelder:public:0006",
  "event:roebel-marienfelder:public:0007",
  "event:roebel-marienfelder:public:0008",
] as const;

export const ROEBEL_PUBLIC_SYNTHETIC_ACTIVITY_JOURNAL_CORRELATION_IDS = [
  "action:roebel-marienfelder:case-intake:v1",
  "action:roebel-marienfelder:planning-handoff:v1",
  "action:roebel-marienfelder:mecky-context:v1",
  "action:roebel-marienfelder:planning-response:v1",
] as const;

export const ROEBEL_PUBLIC_SYNTHETIC_ACTIVITY_JOURNAL_ARTIFACT_IDS = [
  "public-receipt:roebel-marienfelder:case-registered:v1",
  "public-receipt:roebel-marienfelder:department-package-prepared:v1",
  "public-receipt:roebel-marienfelder:department-handoff-observed:v1",
  "public-receipt:roebel-marienfelder:mecky-run-completed:v1",
  "public-receipt:roebel-marienfelder:department-response-submitted:v1",
  "public-receipt:roebel-marienfelder:response-review-approved:v1",
  "public-disposition:roebel-marienfelder:planning:v1",
  "public-projection:roebel-marienfelder:mini-app-status:v1",
] as const;

export const CIVIC_ACTIVITY_JOURNAL_RETENTION_CLASS =
  "synthetic_case_lifetime_plus_12_months" as const;
export const CIVIC_ACTIVITY_JOURNAL_ACTIVE_QUOTA_BYTES = 67_108_864 as const;
export const CIVIC_ACTIVITY_JOURNAL_MAX_PAGE_SIZE = 50 as const;
export const ROEBEL_PUBLIC_SYNTHETIC_ACTIVITY_JOURNAL_LAST_SEQUENCE =
  8 as const;

const CANONICAL_RFC3339_UTC =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const ISO_DATE_TIME = z
  .string()
  .regex(CANONICAL_RFC3339_UTC)
  .refine((value) => {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) && new Date(parsed).toISOString() === value;
  });
const HASH = z.string().regex(/^sha256:[a-f0-9]{64}$/);
export const civicActivityJournalCursorSchema = z
  .string()
  .regex(/^sequence:(0|[1-9][0-9]*)$/)
  .refine((value) => {
    const sequence = Number(value.slice("sequence:".length));
    return (
      Number.isSafeInteger(sequence) &&
      sequence <= ROEBEL_PUBLIC_SYNTHETIC_ACTIVITY_JOURNAL_LAST_SEQUENCE
    );
  });

const eventTypeSchema = z.enum(
  ROEBEL_PUBLIC_SYNTHETIC_ACTIVITY_JOURNAL_EVENT_TYPES,
);
const eventStatusSchema = z.enum(
  ROEBEL_PUBLIC_SYNTHETIC_ACTIVITY_JOURNAL_STATUSES,
);
const actorKindSchema = z.enum(CIVIC_ACTIVITY_JOURNAL_ACTOR_KINDS);
const actorRefSchema = z.enum(CIVIC_ACTIVITY_JOURNAL_ACTOR_REFS);
const actorRoleCodeSchema = z.enum(CIVIC_ACTIVITY_JOURNAL_ACTOR_ROLE_CODES);
const artifactKindSchema = z.enum(CIVIC_ACTIVITY_JOURNAL_ARTIFACT_KINDS);
export const civicActivityJournalEventIdSchema = z.enum(
  ROEBEL_PUBLIC_SYNTHETIC_ACTIVITY_JOURNAL_EVENT_IDS,
);
export const civicActivityJournalCorrelationIdSchema = z.enum(
  ROEBEL_PUBLIC_SYNTHETIC_ACTIVITY_JOURNAL_CORRELATION_IDS,
);
const artifactIdSchema = z.enum(
  ROEBEL_PUBLIC_SYNTHETIC_ACTIVITY_JOURNAL_ARTIFACT_IDS,
);
const descriptionCodeSchema = z.enum(CIVIC_ACTIVITY_JOURNAL_DESCRIPTION_CODES);

const descriptionParametersByCode = {
  synthetic_case_registered: z
    .object({
      caseCode: z.literal("marienfelder_strasse"),
      municipalityCode: z.literal("roebel_mueritz"),
    })
    .strict(),
  synthetic_department_package_prepared: z
    .object({
      departmentFamily: z.literal("planning_engineering"),
      packageVersion: z.literal("v1"),
    })
    .strict(),
  synthetic_department_handoff_observed: z
    .object({
      departmentFamily: z.literal("planning_engineering"),
      handoffMode: z.literal("synthetic_walkthrough"),
    })
    .strict(),
  synthetic_companion_run_started: z
    .object({
      companionProfile: z.literal("mecky_public"),
      taskKind: z.literal("case_context_summary"),
    })
    .strict(),
  synthetic_companion_run_completed: z
    .object({
      companionProfile: z.literal("mecky_public"),
      resultKind: z.literal("review_required_draft"),
    })
    .strict(),
  synthetic_department_response_submitted: z
    .object({
      departmentFamily: z.literal("planning_engineering"),
      responseKind: z.literal("synthetic_complete_answer_set"),
    })
    .strict(),
  synthetic_response_review_approved: z
    .object({
      reviewKind: z.literal("independent_public_safety_review"),
      reviewResult: z.literal("approved_for_synthetic_projection"),
    })
    .strict(),
  synthetic_public_return_recorded: z
    .object({
      projectionKind: z.literal("roebel_mini_app_case_status"),
      publicationMode: z.literal("synthetic_reviewed_demo"),
    })
    .strict(),
} as const;

const descriptionParametersSchema = z.union([
  descriptionParametersByCode.synthetic_case_registered,
  descriptionParametersByCode.synthetic_department_package_prepared,
  descriptionParametersByCode.synthetic_department_handoff_observed,
  descriptionParametersByCode.synthetic_companion_run_started,
  descriptionParametersByCode.synthetic_companion_run_completed,
  descriptionParametersByCode.synthetic_department_response_submitted,
  descriptionParametersByCode.synthetic_response_review_approved,
  descriptionParametersByCode.synthetic_public_return_recorded,
]);

const eventContractByDescriptionCode = {
  synthetic_case_registered: {
    eventType: "proposal_recorded",
    status: "proposed",
  },
  synthetic_department_package_prepared: {
    eventType: "proposal_recorded",
    status: "proposed",
  },
  synthetic_department_handoff_observed: {
    eventType: "department_handoff_recorded",
    status: "observed",
  },
  synthetic_companion_run_started: {
    eventType: "agent_run_started",
    status: "running",
  },
  synthetic_companion_run_completed: {
    eventType: "agent_run_completed",
    status: "succeeded",
  },
  synthetic_department_response_submitted: {
    eventType: "department_response_submitted",
    status: "observed",
  },
  synthetic_response_review_approved: {
    eventType: "approval_recorded",
    status: "approved",
  },
  synthetic_public_return_recorded: {
    eventType: "publication_recorded",
    status: "observed",
  },
} as const;

const actorContractByRef = {
  "role:synthetic-case-steward": {
    kind: "human",
    roleCode: "case_steward",
  },
  "role:synthetic-workspace-coordinator": {
    kind: "human",
    roleCode: "workspace_coordinator",
  },
  "role:synthetic-department-receiver": {
    kind: "human",
    roleCode: "department_receiver",
  },
  "role:synthetic-evidence-reviewer": {
    kind: "human",
    roleCode: "evidence_reviewer",
  },
  "role:synthetic-publication-reviewer": {
    kind: "human",
    roleCode: "publication_reviewer",
  },
  "agent:synthetic-mecky-public": {
    kind: "agent",
    roleCode: "public_city_companion",
  },
  "service:stadtstack-synthetic-journal": {
    kind: "service",
    roleCode: "journal_service",
  },
} as const;

export const civicActivityJournalScopeSchema = z
  .object({
    municipalityId: z.literal("roebel-mueritz"),
    decisionCaseSlug: z.literal("marienfelder-strasse"),
    audienceBoundary: z.literal("public_reviewed"),
    workspaceRoomRef: z.null(),
    coverageStartAt: z.literal("2026-07-20T07:55:00.000Z"),
  })
  .strict();

const historicalDemoBoundaryShape = {
  truthState: z.literal("demo"),
  authorityBinding: z.literal("none"),
  historicalEvidence: z.literal(true),
  currentStateVerified: z.literal(false),
  backfilled: z.literal(true),
  scope: civicActivityJournalScopeSchema,
};

const actorSchema = z
  .object({
    kind: actorKindSchema,
    actorRef: actorRefSchema,
    roleCode: actorRoleCodeSchema,
  })
  .strict();

const producerSchema = z
  .object({
    serviceRef: z.literal("service:stadtstack-synthetic-journal"),
    serviceVersion: z.literal("1.0.0"),
  })
  .strict();

const artifactRefSchema = z
  .object({
    artifactId: artifactIdSchema,
    artifactKind: artifactKindSchema,
    checksum: HASH,
  })
  .strict();

const artifactKindById: Record<
  (typeof ROEBEL_PUBLIC_SYNTHETIC_ACTIVITY_JOURNAL_ARTIFACT_IDS)[number],
  (typeof CIVIC_ACTIVITY_JOURNAL_ARTIFACT_KINDS)[number]
> = {
  "public-receipt:roebel-marienfelder:case-registered:v1":
    "public_activity_receipt",
  "public-receipt:roebel-marienfelder:department-package-prepared:v1":
    "public_activity_receipt",
  "public-receipt:roebel-marienfelder:department-handoff-observed:v1":
    "public_activity_receipt",
  "public-receipt:roebel-marienfelder:mecky-run-completed:v1":
    "public_activity_receipt",
  "public-receipt:roebel-marienfelder:department-response-submitted:v1":
    "public_activity_receipt",
  "public-receipt:roebel-marienfelder:response-review-approved:v1":
    "public_activity_receipt",
  "public-disposition:roebel-marienfelder:planning:v1": "public_disposition",
  "public-projection:roebel-marienfelder:mini-app-status:v1":
    "public_projection",
};

export const ROEBEL_PUBLIC_ACTIVITY_JOURNAL_SEGMENT_SEAL = {
  schemaVersion: CIVIC_ACTIVITY_JOURNAL_SEGMENT_SEAL_SCHEMA_VERSION,
  segmentId: "segment:roebel-marienfelder:public-reviewed:0001",
  eventCount: ROEBEL_PUBLIC_SYNTHETIC_ACTIVITY_JOURNAL_LAST_SEQUENCE,
  firstSequence: 1,
  lastSequence: ROEBEL_PUBLIC_SYNTHETIC_ACTIVITY_JOURNAL_LAST_SEQUENCE,
  genesisEventSha256:
    "sha256:7d72a8cfdad9b6074dc20f1352d9dac60334fa168d9c9fb18fa0635404d188c4",
  headEventSha256:
    "sha256:24dd20904e4b49aa0a1e986b51b045583dcf484a07d1c5107c1a47fa5872b346",
  sealedAt: "2026-07-23T20:45:00.000Z",
  fixtureMode: "reconstructed_synthetic_demo",
  sealSha256:
    "sha256:5fae50f57182b94263af2b1c379b8372c3de9ba63b8eec5278376582c5899b20",
} as const;

export const civicActivityJournalSegmentSealSchema = z
  .object({
    schemaVersion: z.literal(
      ROEBEL_PUBLIC_ACTIVITY_JOURNAL_SEGMENT_SEAL.schemaVersion,
    ),
    segmentId: z.literal(ROEBEL_PUBLIC_ACTIVITY_JOURNAL_SEGMENT_SEAL.segmentId),
    eventCount: z.literal(
      ROEBEL_PUBLIC_ACTIVITY_JOURNAL_SEGMENT_SEAL.eventCount,
    ),
    firstSequence: z.literal(
      ROEBEL_PUBLIC_ACTIVITY_JOURNAL_SEGMENT_SEAL.firstSequence,
    ),
    lastSequence: z.literal(
      ROEBEL_PUBLIC_ACTIVITY_JOURNAL_SEGMENT_SEAL.lastSequence,
    ),
    genesisEventSha256: z.literal(
      ROEBEL_PUBLIC_ACTIVITY_JOURNAL_SEGMENT_SEAL.genesisEventSha256,
    ),
    headEventSha256: z.literal(
      ROEBEL_PUBLIC_ACTIVITY_JOURNAL_SEGMENT_SEAL.headEventSha256,
    ),
    sealedAt: z.literal(ROEBEL_PUBLIC_ACTIVITY_JOURNAL_SEGMENT_SEAL.sealedAt),
    fixtureMode: z.literal(
      ROEBEL_PUBLIC_ACTIVITY_JOURNAL_SEGMENT_SEAL.fixtureMode,
    ),
    sealSha256: z.literal(
      ROEBEL_PUBLIC_ACTIVITY_JOURNAL_SEGMENT_SEAL.sealSha256,
    ),
  })
  .strict();

export const civicActivityJournalEventSchema = z
  .object({
    schemaVersion: z.literal(CIVIC_ACTIVITY_JOURNAL_EVENT_SCHEMA_VERSION),
    ...historicalDemoBoundaryShape,
    eventId: civicActivityJournalEventIdSchema,
    scopeSequence: z
      .number()
      .int()
      .min(1)
      .max(ROEBEL_PUBLIC_SYNTHETIC_ACTIVITY_JOURNAL_LAST_SEQUENCE),
    previousEventSha256: HASH.nullable(),
    eventSha256: HASH,
    segmentId: z.literal("segment:roebel-marienfelder:public-reviewed:0001"),
    occurredAt: ISO_DATE_TIME,
    recordedAt: ISO_DATE_TIME,
    correlationId: civicActivityJournalCorrelationIdSchema,
    actor: actorSchema,
    producer: producerSchema,
    eventType: eventTypeSchema,
    status: eventStatusSchema,
    descriptionCode: descriptionCodeSchema,
    descriptionParameters: descriptionParametersSchema,
    visibility: z.literal("public_reviewed"),
    retentionClass: z.literal(CIVIC_ACTIVITY_JOURNAL_RETENTION_CLASS),
    artifactRefs: z.array(artifactRefSchema).max(8),
  })
  .strict()
  .superRefine((event, context) => {
    const expectedEvent = eventContractByDescriptionCode[event.descriptionCode];
    if (
      event.eventType !== expectedEvent.eventType ||
      event.status !== expectedEvent.status
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["eventType"],
        message:
          "Event type and status must match the exact description contract.",
      });
    }
    const expectedParameters =
      descriptionParametersByCode[event.descriptionCode];
    if (!expectedParameters.safeParse(event.descriptionParameters).success) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["descriptionParameters"],
        message:
          "Description parameters must match the exact allowlist for the template.",
      });
    }
    const expectedActor = actorContractByRef[event.actor.actorRef];
    if (
      event.actor.kind !== expectedActor.kind ||
      event.actor.roleCode !== expectedActor.roleCode
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["actor"],
        message: "Actor reference, kind and role must stay provenance-bound.",
      });
    }
    const expectedSequence =
      ROEBEL_PUBLIC_SYNTHETIC_ACTIVITY_JOURNAL_EVENT_IDS.indexOf(
        event.eventId,
      ) + 1;
    if (event.scopeSequence !== expectedSequence) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["scopeSequence"],
        message: "Pinned public event identity must match its exact sequence.",
      });
    }
    const artifactIds = new Set<string>();
    event.artifactRefs.forEach((artifact, index) => {
      if (
        artifactKindById[artifact.artifactId] !== artifact.artifactKind ||
        artifactIds.has(artifact.artifactId)
      ) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["artifactRefs", index],
          message:
            "Public surrogate artifact identity, kind and uniqueness must agree.",
        });
      }
      artifactIds.add(artifact.artifactId);
    });
    if (event.scopeSequence === 1 && event.previousEventSha256 !== null) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["previousEventSha256"],
        message: "The first event cannot name a predecessor.",
      });
    }
    const coverageStart = Date.parse(event.scope.coverageStartAt);
    const occurred = Date.parse(event.occurredAt);
    const recorded = Date.parse(event.recordedAt);
    if (occurred < coverageStart || recorded < occurred) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["recordedAt"],
        message:
          "Event timestamps fall outside the declared reconstructed-demo coverage.",
      });
    }
  });

const readCapabilitiesSchema = z
  .object({
    getCapabilities: z.literal(true),
    listEvents: z.literal(true),
    getActionTimeline: z.literal(true),
    getEvent: z.literal(true),
    append: z.literal(false),
    update: z.literal(false),
    delete: z.literal(false),
  })
  .strict();

function rejectDuplicates(
  values: readonly string[],
  context: z.RefinementCtx,
  path: string,
) {
  if (new Set(values).size !== values.length) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: [path],
      message: "Capability lists cannot contain duplicates.",
    });
  }
}

export const civicActivityJournalCapabilitiesSchema = z
  .object({
    schemaVersion: z.literal(
      CIVIC_ACTIVITY_JOURNAL_CAPABILITIES_SCHEMA_VERSION,
    ),
    eventSchemaVersion: z.literal(CIVIC_ACTIVITY_JOURNAL_EVENT_SCHEMA_VERSION),
    ...historicalDemoBoundaryShape,
    supportedEventTypes: z
      .array(eventTypeSchema)
      .min(1)
      .max(ROEBEL_PUBLIC_SYNTHETIC_ACTIVITY_JOURNAL_EVENT_TYPES.length),
    supportedStatuses: z
      .array(eventStatusSchema)
      .min(1)
      .max(ROEBEL_PUBLIC_SYNTHETIC_ACTIVITY_JOURNAL_STATUSES.length),
    maxPageSize: z.literal(CIVIC_ACTIVITY_JOURNAL_MAX_PAGE_SIZE),
    activeQuotaBytes: z.literal(CIVIC_ACTIVITY_JOURNAL_ACTIVE_QUOTA_BYTES),
    retentionClass: z.literal(CIVIC_ACTIVITY_JOURNAL_RETENTION_CLASS),
    segmentSeal: civicActivityJournalSegmentSealSchema,
    readCapabilities: readCapabilitiesSchema,
  })
  .strict()
  .superRefine((capabilities, context) => {
    rejectDuplicates(
      capabilities.supportedEventTypes,
      context,
      "supportedEventTypes",
    );
    rejectDuplicates(
      capabilities.supportedStatuses,
      context,
      "supportedStatuses",
    );
    if (
      capabilities.supportedEventTypes.length !==
        ROEBEL_PUBLIC_SYNTHETIC_ACTIVITY_JOURNAL_EVENT_TYPES.length ||
      capabilities.supportedEventTypes.some(
        (eventType, index) =>
          eventType !==
          ROEBEL_PUBLIC_SYNTHETIC_ACTIVITY_JOURNAL_EVENT_TYPES[index],
      ) ||
      capabilities.supportedStatuses.length !==
        ROEBEL_PUBLIC_SYNTHETIC_ACTIVITY_JOURNAL_STATUSES.length ||
      capabilities.supportedStatuses.some(
        (status, index) =>
          status !== ROEBEL_PUBLIC_SYNTHETIC_ACTIVITY_JOURNAL_STATUSES[index],
      )
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["supportedEventTypes"],
        message:
          "Pinned v1 capabilities must expose the exact event and status registries in order.",
      });
    }
  });

const pageSchema = z
  .object({
    limit: z
      .number()
      .int()
      .min(1)
      .max(CIVIC_ACTIVITY_JOURNAL_MAX_PAGE_SIZE),
    returned: z
      .number()
      .int()
      .min(0)
      .max(CIVIC_ACTIVITY_JOURNAL_MAX_PAGE_SIZE),
    nextCursor: civicActivityJournalCursorSchema.nullable(),
  })
  .strict();

function sameScope(
  left: z.infer<typeof civicActivityJournalScopeSchema>,
  right: z.infer<typeof civicActivityJournalScopeSchema>,
) {
  return (
    left.municipalityId === right.municipalityId &&
    left.decisionCaseSlug === right.decisionCaseSlug &&
    left.audienceBoundary === right.audienceBoundary &&
    left.workspaceRoomRef === right.workspaceRoomRef &&
    left.coverageStartAt === right.coverageStartAt
  );
}

function validateEventSet(
  events: readonly z.infer<typeof civicActivityJournalEventSchema>[],
  scope: z.infer<typeof civicActivityJournalScopeSchema>,
  context: z.RefinementCtx,
  contiguous: boolean,
) {
  const ids = new Set<string>();
  const hashes = new Set<string>();
  for (let index = 0; index < events.length; index += 1) {
    const event = events[index];
    if (!sameScope(event.scope, scope)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["events", index, "scope"],
        message: "Every event must stay inside the response scope.",
      });
    }
    if (ids.has(event.eventId) || hashes.has(event.eventSha256)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["events", index, "eventId"],
        message: "A journal response cannot repeat an event identity or hash.",
      });
    }
    ids.add(event.eventId);
    hashes.add(event.eventSha256);

    const previous = events[index - 1];
    if (!previous) continue;
    if (event.scopeSequence <= previous.scopeSequence) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["events", index, "scopeSequence"],
        message: "Journal events must be ordered by increasing scope sequence.",
      });
    }
    if (
      contiguous &&
      (event.scopeSequence !== previous.scopeSequence + 1 ||
        event.previousEventSha256 !== previous.eventSha256)
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["events", index, "previousEventSha256"],
        message: "Unfiltered journal pages must have an unbroken hash chain.",
      });
    }
    if (
      !contiguous &&
      event.scopeSequence === previous.scopeSequence + 1 &&
      event.previousEventSha256 !== previous.eventSha256
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["events", index, "previousEventSha256"],
        message: "Adjacent timeline events must preserve the journal hash chain.",
      });
    }
  }
}

export const civicActivityJournalEventListSchema = z
  .object({
    schemaVersion: z.literal(CIVIC_ACTIVITY_JOURNAL_EVENT_LIST_SCHEMA_VERSION),
    ...historicalDemoBoundaryShape,
    generatedAt: ISO_DATE_TIME,
    page: pageSchema,
    events: z
      .array(civicActivityJournalEventSchema)
      .max(CIVIC_ACTIVITY_JOURNAL_MAX_PAGE_SIZE),
  })
  .strict()
  .superRefine((result, context) => {
    if (
      result.page.returned !== result.events.length ||
      result.events.length > result.page.limit ||
      (result.events.length === 0 && result.page.nextCursor !== null)
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["page"],
        message: "Journal pagination metadata does not match the bounded event page.",
      });
    }
    validateEventSet(result.events, result.scope, context, true);
  });

export const civicActivityJournalActionTimelineSchema = z
  .object({
    schemaVersion: z.literal(
      CIVIC_ACTIVITY_JOURNAL_ACTION_TIMELINE_SCHEMA_VERSION,
    ),
    ...historicalDemoBoundaryShape,
    generatedAt: ISO_DATE_TIME,
    correlationId: civicActivityJournalCorrelationIdSchema,
    eventCount: z
      .number()
      .int()
      .min(1)
      .max(CIVIC_ACTIVITY_JOURNAL_MAX_PAGE_SIZE),
    events: z
      .array(civicActivityJournalEventSchema)
      .min(1)
      .max(CIVIC_ACTIVITY_JOURNAL_MAX_PAGE_SIZE),
  })
  .strict()
  .superRefine((timeline, context) => {
    if (timeline.eventCount !== timeline.events.length) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["eventCount"],
        message: "Action timeline count must match the event array.",
      });
    }
    timeline.events.forEach((event, index) => {
      if (event.correlationId !== timeline.correlationId) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["events", index, "correlationId"],
          message: "Every action-timeline event must share one correlation id.",
        });
      }
    });
    validateEventSet(timeline.events, timeline.scope, context, false);
  });

export type CivicActivityJournalScopeV1 = z.infer<
  typeof civicActivityJournalScopeSchema
>;
export type CivicActivityJournalEventV1 = z.infer<
  typeof civicActivityJournalEventSchema
>;
export type CivicActivityJournalSegmentSealV1 = z.infer<
  typeof civicActivityJournalSegmentSealSchema
>;
export type CivicActivityJournalCapabilitiesV1 = z.infer<
  typeof civicActivityJournalCapabilitiesSchema
>;
export type CivicActivityJournalEventListV1 = z.infer<
  typeof civicActivityJournalEventListSchema
>;
export type CivicActivityJournalActionTimelineV1 = z.infer<
  typeof civicActivityJournalActionTimelineSchema
>;
