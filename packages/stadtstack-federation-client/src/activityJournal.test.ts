import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import {
  getRoebelActivityJournalActionTimeline,
  getRoebelActivityJournalEvent,
  listRoebelActivityJournalEvents,
  loadRoebelActivityJournalDemo,
  ROEBEL_PUBLIC_ACTIVITY_JOURNAL_SEGMENT_SEAL,
  ROEBEL_PUBLIC_SYNTHETIC_ACTIVITY_JOURNAL_EVENT_TYPES,
  ROEBEL_PUBLIC_SYNTHETIC_ACTIVITY_JOURNAL_STATUSES,
  StadtstackFederationError,
} from "./index";

const BASE_URL = "https://stadtstack.example";
const GENERATED_AT = "2026-07-20T11:15:00.000Z";
const JOURNAL_PATH = "/api/demo/roebel-marienfelder/activity-journal";
const SEGMENT_ID = "segment:roebel-marienfelder:public-reviewed:0001";

const scope = {
  municipalityId: "roebel-mueritz" as const,
  decisionCaseSlug: "marienfelder-strasse" as const,
  audienceBoundary: "public_reviewed" as const,
  workspaceRoomRef: null,
  coverageStartAt: "2026-07-20T07:55:00.000Z" as const,
};

const boundary = {
  truthState: "demo" as const,
  authorityBinding: "none" as const,
  historicalEvidence: true as const,
  currentStateVerified: false as const,
  backfilled: true as const,
  scope,
};

const producer = {
  serviceRef: "service:stadtstack-synthetic-journal" as const,
  serviceVersion: "1.0.0" as const,
};

const eventInputs = [
  {
    eventId: "event:roebel-marienfelder:public:0001",
    occurredAt: "2026-07-20T07:56:00.000Z",
    recordedAt: "2026-07-20T07:56:30.000Z",
    correlationId: "action:roebel-marienfelder:case-intake:v1",
    actor: {
      kind: "human",
      actorRef: "role:synthetic-case-steward",
      roleCode: "case_steward",
    },
    eventType: "proposal_recorded",
    status: "proposed",
    descriptionCode: "synthetic_case_registered",
    descriptionParameters: {
      caseCode: "marienfelder_strasse",
      municipalityCode: "roebel_mueritz",
    },
    artifactRefs: [
      {
        artifactId: "public-receipt:roebel-marienfelder:case-registered:v1",
        artifactKind: "public_activity_receipt",
        checksum:
          "sha256:5f5cea124604b90b110bf9b19b9ac665933b06f0af159030104574dc2f59498f",
      },
    ],
  },
  {
    eventId: "event:roebel-marienfelder:public:0002",
    occurredAt: "2026-07-20T07:58:00.000Z",
    recordedAt: "2026-07-20T07:58:30.000Z",
    correlationId: "action:roebel-marienfelder:planning-handoff:v1",
    actor: {
      kind: "human",
      actorRef: "role:synthetic-workspace-coordinator",
      roleCode: "workspace_coordinator",
    },
    eventType: "proposal_recorded",
    status: "proposed",
    descriptionCode: "synthetic_department_package_prepared",
    descriptionParameters: {
      departmentFamily: "planning_engineering",
      packageVersion: "v1",
    },
    artifactRefs: [
      {
        artifactId:
          "public-receipt:roebel-marienfelder:department-package-prepared:v1",
        artifactKind: "public_activity_receipt",
        checksum:
          "sha256:5466ea1189433aaaa4dea61fdba853e4897d0b02abb58a5a37ff9639e52f9e12",
      },
    ],
  },
  {
    eventId: "event:roebel-marienfelder:public:0003",
    occurredAt: "2026-07-20T08:10:00.000Z",
    recordedAt: "2026-07-20T08:11:00.000Z",
    correlationId: "action:roebel-marienfelder:planning-handoff:v1",
    actor: {
      kind: "human",
      actorRef: "role:synthetic-department-receiver",
      roleCode: "department_receiver",
    },
    eventType: "department_handoff_recorded",
    status: "observed",
    descriptionCode: "synthetic_department_handoff_observed",
    descriptionParameters: {
      departmentFamily: "planning_engineering",
      handoffMode: "synthetic_walkthrough",
    },
    artifactRefs: [
      {
        artifactId:
          "public-receipt:roebel-marienfelder:department-handoff-observed:v1",
        artifactKind: "public_activity_receipt",
        checksum:
          "sha256:c4cabad31a8446296d4351058c8407b6d1841fc163b7d7134e575617a21cb49a",
      },
    ],
  },
  {
    eventId: "event:roebel-marienfelder:public:0004",
    occurredAt: "2026-07-20T08:30:00.000Z",
    recordedAt: "2026-07-20T08:30:01.000Z",
    correlationId: "action:roebel-marienfelder:mecky-context:v1",
    actor: {
      kind: "agent",
      actorRef: "agent:synthetic-mecky-public",
      roleCode: "public_city_companion",
    },
    eventType: "agent_run_started",
    status: "running",
    descriptionCode: "synthetic_companion_run_started",
    descriptionParameters: {
      companionProfile: "mecky_public",
      taskKind: "case_context_summary",
    },
    artifactRefs: [],
  },
  {
    eventId: "event:roebel-marienfelder:public:0005",
    occurredAt: "2026-07-20T08:30:05.000Z",
    recordedAt: "2026-07-20T08:30:06.000Z",
    correlationId: "action:roebel-marienfelder:mecky-context:v1",
    actor: {
      kind: "agent",
      actorRef: "agent:synthetic-mecky-public",
      roleCode: "public_city_companion",
    },
    eventType: "agent_run_completed",
    status: "succeeded",
    descriptionCode: "synthetic_companion_run_completed",
    descriptionParameters: {
      companionProfile: "mecky_public",
      resultKind: "review_required_draft",
    },
    artifactRefs: [
      {
        artifactId:
          "public-receipt:roebel-marienfelder:mecky-run-completed:v1",
        artifactKind: "public_activity_receipt",
        checksum:
          "sha256:d6e1a6a00c038a889265eca24f0e1c36d097cf0a210c43641de06b1ed12e6f75",
      },
    ],
  },
  {
    eventId: "event:roebel-marienfelder:public:0006",
    occurredAt: "2026-07-20T10:00:00.000Z",
    recordedAt: "2026-07-20T10:01:00.000Z",
    correlationId: "action:roebel-marienfelder:planning-response:v1",
    actor: {
      kind: "human",
      actorRef: "role:synthetic-department-receiver",
      roleCode: "department_receiver",
    },
    eventType: "department_response_submitted",
    status: "observed",
    descriptionCode: "synthetic_department_response_submitted",
    descriptionParameters: {
      departmentFamily: "planning_engineering",
      responseKind: "synthetic_complete_answer_set",
    },
    artifactRefs: [
      {
        artifactId:
          "public-receipt:roebel-marienfelder:department-response-submitted:v1",
        artifactKind: "public_activity_receipt",
        checksum:
          "sha256:66652c2c2c2390513d498a3223960964c6d94f482fea66542524c0a81ab450ca",
      },
    ],
  },
  {
    eventId: "event:roebel-marienfelder:public:0007",
    occurredAt: "2026-07-20T11:00:00.000Z",
    recordedAt: "2026-07-20T11:00:00.000Z",
    correlationId: "action:roebel-marienfelder:planning-response:v1",
    actor: {
      kind: "human",
      actorRef: "role:synthetic-evidence-reviewer",
      roleCode: "evidence_reviewer",
    },
    eventType: "approval_recorded",
    status: "approved",
    descriptionCode: "synthetic_response_review_approved",
    descriptionParameters: {
      reviewKind: "independent_public_safety_review",
      reviewResult: "approved_for_synthetic_projection",
    },
    artifactRefs: [
      {
        artifactId:
          "public-receipt:roebel-marienfelder:response-review-approved:v1",
        artifactKind: "public_activity_receipt",
        checksum:
          "sha256:b36c5328b12faa8afffe537cc76b219645ee28d3a7801adab1b81b265e8d2e1c",
      },
    ],
  },
  {
    eventId: "event:roebel-marienfelder:public:0008",
    occurredAt: "2026-07-20T11:10:00.000Z",
    recordedAt: "2026-07-20T11:11:00.000Z",
    correlationId: "action:roebel-marienfelder:planning-response:v1",
    actor: {
      kind: "human",
      actorRef: "role:synthetic-publication-reviewer",
      roleCode: "publication_reviewer",
    },
    eventType: "publication_recorded",
    status: "observed",
    descriptionCode: "synthetic_public_return_recorded",
    descriptionParameters: {
      projectionKind: "roebel_mini_app_case_status",
      publicationMode: "synthetic_reviewed_demo",
    },
    artifactRefs: [
      {
        artifactId: "public-disposition:roebel-marienfelder:planning:v1",
        artifactKind: "public_disposition",
        checksum:
          "sha256:afc8c91cd701b1f89b4c258becf3750427b71463aa30fdf09966984dfd2ff972",
      },
      {
        artifactId:
          "public-projection:roebel-marienfelder:mini-app-status:v1",
        artifactKind: "public_projection",
        checksum:
          "sha256:beddd16a9f95a68365076358fa03b2762aaf44d8a48174da88d2f86f0a3281ac",
      },
    ],
  },
] as const;

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
    .join(",")}}`;
}

function signEvent<T extends Record<string, unknown>>(unsignedEvent: T) {
  return {
    ...unsignedEvent,
    eventSha256: `sha256:${createHash("sha256")
      .update(canonicalJson(unsignedEvent))
      .digest("hex")}`,
  };
}

function events() {
  let previousEventSha256: string | null = null;
  return eventInputs.map((input, index) => {
    const event = signEvent({
      schemaVersion: "civic_activity_journal_event_v1" as const,
      ...boundary,
      ...input,
      scopeSequence: index + 1,
      previousEventSha256,
      segmentId: SEGMENT_ID,
      producer,
      visibility: "public_reviewed" as const,
      retentionClass: "synthetic_case_lifetime_plus_12_months" as const,
    });
    previousEventSha256 = event.eventSha256;
    return event;
  });
}

function resignEvent<T extends ReturnType<typeof events>[number]>(
  event: T,
  patch: Record<string, unknown>,
) {
  const { eventSha256: _eventSha256, ...unsignedEvent } = event;
  return signEvent({ ...unsignedEvent, ...patch });
}

function capabilities() {
  return {
    schemaVersion: "civic_activity_journal_capabilities_v1",
    eventSchemaVersion: "civic_activity_journal_event_v1",
    ...boundary,
    supportedEventTypes: [
      ...ROEBEL_PUBLIC_SYNTHETIC_ACTIVITY_JOURNAL_EVENT_TYPES,
    ],
    supportedStatuses: [
      ...ROEBEL_PUBLIC_SYNTHETIC_ACTIVITY_JOURNAL_STATUSES,
    ],
    maxPageSize: 50,
    activeQuotaBytes: 67_108_864,
    retentionClass: "synthetic_case_lifetime_plus_12_months",
    segmentSeal: { ...ROEBEL_PUBLIC_ACTIVITY_JOURNAL_SEGMENT_SEAL },
    readCapabilities: {
      getCapabilities: true,
      listEvents: true,
      getActionTimeline: true,
      getEvent: true,
      append: false,
      update: false,
      delete: false,
    },
  };
}

function eventList(
  eventValues: readonly unknown[] = events(),
  page: Partial<{ limit: number; returned: number; nextCursor: string | null }> =
    {},
) {
  return {
    schemaVersion: "civic_activity_journal_event_list_v1",
    ...boundary,
    generatedAt: GENERATED_AT,
    page: {
      limit: page.limit ?? 8,
      returned: page.returned ?? eventValues.length,
      nextCursor: page.nextCursor ?? null,
    },
    events: eventValues,
  };
}

const requiredHeaders = {
  "content-type": "application/json",
  "x-stadtstack-truth-state": "demo",
  "x-stadtstack-authority": "none",
  "x-stadtstack-demo-scenario": "walkthrough",
  "x-stadtstack-visibility": "public_reviewed",
  "x-stadtstack-historical-evidence": "true",
  "x-stadtstack-current-state-verified": "false",
  "x-stadtstack-backfilled": "true",
};

function response(value: unknown, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(value), {
    headers: { ...requiredHeaders, ...headers },
  });
}

async function expectCode(promise: Promise<unknown>, code: string) {
  await assert.rejects(promise, (error: unknown) => {
    return error instanceof StadtstackFederationError && error.code === code;
  });
}

test("loads the exact sealed eight-event reconstructed public demo", async () => {
  const expectedHashes = [
    "sha256:7d72a8cfdad9b6074dc20f1352d9dac60334fa168d9c9fb18fa0635404d188c4",
    "sha256:3e45cdd76873d09bd49f1d29ccfcadb6557e1e8e824f3aedc0ecab981ce8b1ed",
    "sha256:65c5c80fe352ea134d678d19700bfcf6fc54e6a91a8cde0f5c08f251dcdd80ff",
    "sha256:922c134130f614384904b5fe243d7bbf7741cb9a5c9b6600773bdacd223d6324",
    "sha256:4f6e6bcafe89bd742e4c1e0f737f73fa2bc5896bfd00f0fec5c5f6f12ad2d439",
    "sha256:7e3235f7a46dc60278da2c38660477211c21a1444b4cd2e04413904961a6432c",
    "sha256:946fba87722739b3b7b38995db10ce649d2db0ff1dc7499f03cae42d92d08bea",
    "sha256:24dd20904e4b49aa0a1e986b51b045583dcf484a07d1c5107c1a47fa5872b346",
  ];
  assert.deepEqual(
    events().map((event) => event.eventSha256),
    expectedHashes,
  );

  const requested: string[] = [];
  const result = await loadRoebelActivityJournalDemo({
    baseUrl: BASE_URL,
    fetch: (async (input: RequestInfo | URL) => {
      const url = new URL(String(input));
      requested.push(`${url.pathname}${url.search}`);
      return url.pathname.endsWith("/capabilities")
        ? response(capabilities())
        : response(eventList());
    }) as typeof fetch,
  });

  assert.deepEqual(requested, [
    `${JOURNAL_PATH}/capabilities`,
    `${JOURNAL_PATH}/events?limit=8`,
  ]);
  assert.equal(result.capabilities.historicalEvidence, true);
  assert.equal(result.capabilities.currentStateVerified, false);
  assert.equal(result.capabilities.backfilled, true);
  assert.equal(result.eventList.events.length, 8);
});

test("rejects content changed without a new event checksum", async () => {
  const values = events();
  const changed = {
    ...values[4],
    artifactRefs: [
      {
        ...values[4]!.artifactRefs[0],
        checksum: `sha256:${"b".repeat(64)}`,
      },
    ],
  };
  await expectCode(
    listRoebelActivityJournalEvents({
      baseUrl: BASE_URL,
      fetch: (async () =>
        response(eventList([changed]))) as typeof fetch,
    }),
    "checksum",
  );
});

test("rejects event-template and provenance-bound actor mismatches", async () => {
  const [first] = events();
  await expectCode(
    listRoebelActivityJournalEvents({
      baseUrl: BASE_URL,
      fetch: (async () =>
        response(
          eventList([
            resignEvent(first!, { eventType: "publication_recorded" }),
          ]),
        )) as typeof fetch,
    }),
    "invalid_schema",
  );
  await expectCode(
    listRoebelActivityJournalEvents({
      baseUrl: BASE_URL,
      fetch: (async () =>
        response(
          eventList([
            resignEvent(first!, {
              actor: { ...first!.actor, roleCode: "publication_reviewer" },
            }),
          ]),
        )) as typeof fetch,
    }),
    "invalid_schema",
  );
});

test("rejects a widened boundary, write capability and unexpected content", async () => {
  await expectCode(
    listRoebelActivityJournalEvents({
      baseUrl: BASE_URL,
      fetch: (async () =>
        response(eventList(), {
          "x-stadtstack-current-state-verified": "true",
        })) as typeof fetch,
    }),
    "contract_mismatch",
  );
  await expectCode(
    loadRoebelActivityJournalDemo({
      baseUrl: BASE_URL,
      fetch: (async (input: RequestInfo | URL) =>
        String(input).includes("capabilities")
          ? response({
              ...capabilities(),
              readCapabilities: {
                ...capabilities().readCapabilities,
                append: true,
              },
            })
          : response(eventList())) as typeof fetch,
    }),
    "invalid_schema",
  );
  const [first] = events();
  await expectCode(
    listRoebelActivityJournalEvents({
      baseUrl: BASE_URL,
      fetch: (async () =>
        response(eventList([{ ...first, prompt: "must never render" }]))) as typeof fetch,
    }),
    "invalid_schema",
  );
});

test("rejects unsafe cursors, arbitrary identities and broken hash chains", async () => {
  for (const cursor of [
    "../protected",
    "sequence:9007199254740993",
    "sequence:9",
  ]) {
    await expectCode(
      listRoebelActivityJournalEvents({
        baseUrl: BASE_URL,
        cursor,
        fetch: (async () => response(eventList())) as typeof fetch,
      }),
      "configuration",
    );
  }
  await expectCode(
    getRoebelActivityJournalEvent(
      { baseUrl: BASE_URL, fetch: (async () => response({})) as typeof fetch },
      "event:someone-else",
    ),
    "configuration",
  );

  const [first, second] = events();
  const broken = resignEvent(second!, {
    previousEventSha256: `sha256:${"a".repeat(64)}`,
  });
  await expectCode(
    listRoebelActivityJournalEvents({
      baseUrl: BASE_URL,
      fetch: (async () =>
        response(eventList([first!, broken]))) as typeof fetch,
    }),
    "invalid_schema",
  );
});

test("reads one exact event and one exact action timeline without widening paths", async () => {
  const values = events();
  const first = values[0]!;
  let eventPath = "";
  const event = await getRoebelActivityJournalEvent(
    {
      baseUrl: BASE_URL,
      fetch: (async (input: RequestInfo | URL) => {
        eventPath = new URL(String(input)).pathname;
        return response(first);
      }) as typeof fetch,
    },
    first.eventId,
  );
  assert.equal(event.eventId, first.eventId);
  assert.equal(
    eventPath,
    `${JOURNAL_PATH}/events/event%3Aroebel-marienfelder%3Apublic%3A0001`,
  );

  const actionEvents = [values[3]!, values[4]!];
  const correlationId = "action:roebel-marienfelder:mecky-context:v1";
  let actionPath = "";
  const timeline = await getRoebelActivityJournalActionTimeline(
    {
      baseUrl: BASE_URL,
      fetch: (async (input: RequestInfo | URL) => {
        actionPath = new URL(String(input)).pathname;
        return response({
          schemaVersion: "civic_activity_journal_action_timeline_v1",
          ...boundary,
          generatedAt: GENERATED_AT,
          correlationId,
          eventCount: actionEvents.length,
          events: actionEvents,
        });
      }) as typeof fetch,
    },
    correlationId,
  );
  assert.equal(timeline.eventCount, 2);
  assert.equal(
    actionPath,
    `${JOURNAL_PATH}/actions/action%3Aroebel-marienfelder%3Amecky-context%3Av1`,
  );
});

test("fails closed when the page is partial or the reviewed seal differs", async () => {
  await expectCode(
    loadRoebelActivityJournalDemo({
      baseUrl: BASE_URL,
      fetch: (async (input: RequestInfo | URL) =>
        String(input).includes("capabilities")
          ? response(capabilities())
          : response(eventList(events().slice(0, 7)))) as typeof fetch,
    }),
    "contract_mismatch",
  );
  await expectCode(
    loadRoebelActivityJournalDemo({
      baseUrl: BASE_URL,
      fetch: (async (input: RequestInfo | URL) =>
        String(input).includes("capabilities")
          ? response({
              ...capabilities(),
              segmentSeal: {
                ...capabilities().segmentSeal,
                headEventSha256: `sha256:${"f".repeat(64)}`,
              },
            })
          : response(eventList())) as typeof fetch,
    }),
    "invalid_schema",
  );
});
