import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import {
  CIVIC_CASE_DETAIL_STAGE_IDS,
  CIVIC_CASE_MACRO_STAGE_IDS,
  CIVIC_CASE_MACRO_STAGE_LABELS,
} from "./contracts";
import {
  loadReviewedCivicCases,
  StadtstackFederationError,
} from "./client";

const BASE_URL = "https://stadtstack.example";
const NOW = "2026-07-18T12:00:00.000Z";
const SOURCE_HASH = `sha256:${"a".repeat(64)}`;
const CASE_PATH =
  "/api/federation/v1/municipalities/roebel-mueritz/cases/marienfelder-strasse";

const detailToMacro = {
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
} as const;

const detailRegistry = {
  candidate_selected: ["Fall ausgewählt", "Das lokale Problem ist als überprüfbarer Entscheidungsfall beschrieben.", true],
  evidence_baseline_ready: ["Evidenz und Ausgangslage", "Quellen, bekannte Einschränkungen und Datenlücken sind nachvollziehbar.", true],
  authority_and_contract: ["Mandat und Beteiligungsvertrag", "Zuständigkeit, offene Fragen, Antwortpflicht und Entscheidungsroute sind bestätigt.", true],
  round_a_experience: ["Runde A: Erfahrungen", "Betroffene Perspektiven werden online und offline gesammelt und geprüft.", true],
  feasible_alternatives: ["Machbare Alternativen", "Verwaltung und Planung überführen Erfahrungen in realisierbare Optionen.", true],
  round_b_advisory: ["Runde B: Optionen abwägen", "Machbare Optionen können in einer getrennten beratenden Runde verglichen werden.", false],
  administrative_synthesis: ["Verwaltungsprüfung und Entscheidungsbrief", "Evidenz, Beteiligung, Machbarkeit, Kosten und offene Konflikte werden zusammengeführt.", true],
  official_decision: ["Zuständige Entscheidung", "Die zuständige Stelle entscheidet oder leitet den Fall durch die formale Route.", true],
  institutional_response: ["Begründete institutionelle Antwort", "Die Entscheidung wird mit Gründen, Zusagen, Zuständigkeiten und Fristen veröffentlicht.", true],
  delivery: ["Umsetzung", "Zusagen, Meilensteine, Änderungen, Verzögerungen und Nachweise bleiben sichtbar.", true],
  outcome_evaluation: ["Wirkung auswerten", "Beobachtungen werden gegen die Ausgangslage geprüft, inklusive Unsicherheit.", true],
  impact_receipt_next_cycle: ["Wirkungsquittung und nächster Zyklus", "Bewohner sehen Antwort, Umsetzung, Wirkung und den nächsten Schritt.", true],
} as const;

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
    .join(",")}}`;
}

function stageHash<T extends { derivedAt: string }>(snapshot: T) {
  const { derivedAt: _derivedAt, ...stable } = snapshot;
  return `sha256:${createHash("sha256").update(canonicalJson(stable)).digest("hex")}`;
}

function reviewedSnapshot() {
  const currentOwner = {
    id: "bauamt-roebel",
    label: "Bauamt Röbel/Müritz",
    kind: "department" as const,
  };
  const detailStages = CIVIC_CASE_DETAIL_STAGE_IDS.map((id) => {
    const [label, summary, required] = detailRegistry[id];
    const isFact = id === "candidate_selected" || id === "evidence_baseline_ready";
    const isCurrent = id === "authority_and_contract";
    return {
      id,
      macroStageId: detailToMacro[id],
      label,
      summary,
      required,
      lifecycle: isFact ? ("completed" as const) : isCurrent ? ("blocked" as const) : ("not_started" as const),
      timeliness: "no_deadline" as const,
      attention: isCurrent ? ("action_required" as const) : ("normal" as const),
      truthState: isFact || isCurrent ? ("reviewed" as const) : ("missing" as const),
      authorityBinding: "not_applicable" as const,
      owner: isCurrent ? currentOwner : null,
      dueAt: null,
      lastReviewedAt: isFact || isCurrent ? NOW : null,
      startedAt: null,
      waitingSince: null,
      waitReason: null,
      completedAt: isFact ? NOW : null,
      nextAction: isCurrent ? "Zuständigkeit und Beteiligungsmandat bestätigen." : null,
      availablePublicAction: null,
      blocker: isCurrent ? "Das Beteiligungsmandat ist noch nicht bestätigt." : null,
      proofRefs: [],
    };
  });
  const macroStages = CIVIC_CASE_MACRO_STAGE_IDS.map((id, index) => ({
    id,
    position: index + 1,
    label: CIVIC_CASE_MACRO_STAGE_LABELS[id],
    lifecycle: id === "facts" ? ("completed" as const) : id === "mandate" ? ("blocked" as const) : ("not_started" as const),
    timeliness: "no_deadline" as const,
    attention: id === "mandate" ? ("action_required" as const) : ("normal" as const),
    detailStageIds: CIVIC_CASE_DETAIL_STAGE_IDS.filter(
      (detailId) => detailToMacro[detailId] === id,
    ),
  }));
  return {
    schemaVersion: "civic_case_stage_snapshot_v1" as const,
    algorithmVersion: "1.0.0" as const,
    caseKey: {
      municipalityId: "roebel-mueritz",
      decisionCaseSlug: "marienfelder-strasse",
    },
    sourceArtifactSetHash: SOURCE_HASH,
    decisionRouteVersion: null,
    truthState: "reviewed" as const,
    participationAuthorityState: "unconfirmed" as const,
    primaryCurrentMacroStageId: "mandate" as const,
    primaryCurrentDetailStageId: "authority_and_contract" as const,
    parallelActiveDetailStageIds: [],
    current: {
      macroStageId: "mandate" as const,
      detailStageId: "authority_and_contract" as const,
      position: 2,
      total: 7 as const,
      label: "Mandat klären",
      lifecycle: "blocked" as const,
      timeliness: "no_deadline" as const,
      truthState: "reviewed" as const,
      owner: currentOwner,
      dueAt: null,
      nextAction: "Zuständigkeit und Beteiligungsmandat bestätigen.",
      availablePublicAction: null,
      blocker: "Das Beteiligungsmandat ist noch nicht bestätigt.",
      waitReason: null,
      lastReviewedAt: NOW,
    },
    macroStages,
    detailStages,
    derivedAt: NOW,
  };
}

function fixtures() {
  const snapshot = reviewedSnapshot();
  const municipality = {
    id: "roebel-mueritz",
    name: "Röbel/Müritz",
    state: "Mecklenburg-Vorpommern",
    country: "DE",
  };
  const summary = {
    decisionCaseSlug: "marienfelder-strasse",
    title: "Ausbau der Marienfelder Straße",
    publicSummary: "Der Fall ist geprüft; das Beteiligungsmandat ist noch offen.",
    truthState: "reviewed",
    participationAuthorityState: "unconfirmed",
    currentStage: snapshot.current,
    manifestUrl: `${CASE_PATH}/manifest`,
    stageMapUrl: `${CASE_PATH}/stage-map`,
    publicCaseUrl:
      "/kommunen/roebel-mueritz/entscheidungen/marienfelder-strasse",
    updatedAt: NOW,
  };
  const index = {
    schemaVersion: "civic_federation_case_index_v1",
    municipality,
    generatedAt: NOW,
    cases: [summary],
  };
  const manifest = {
    schemaVersion: "civic_federation_manifest_v1",
    municipality,
    decisionCaseSlug: "marienfelder-strasse",
    generatedAt: NOW,
    publicCaseUrl: summary.publicCaseUrl,
    stageMap: {
      url: summary.stageMapUrl,
      contentSha256: stageHash(snapshot),
      snapshot,
    },
    artifacts: [
      {
        artifactType: "decision_case",
        artifactSchemaVersion: "decision_case_v1",
        artifactId: "decision-case:roebel-mueritz:marienfelder-strasse",
        artifactVersion: 1,
        contentSha256: SOURCE_HASH,
        status: "reviewed",
        url: "/api/federation/v1/municipalities/roebel-mueritz/artifacts/decision-case%3Aroebel-mueritz%3Amarienfelder-strasse/1",
        generatedAt: NOW,
      },
    ],
  };
  return { index, manifest, snapshot };
}

function json(value: unknown, init?: ResponseInit) {
  return new Response(JSON.stringify(value), {
    ...init,
    headers: { "content-type": "application/json", ...init?.headers },
  });
}

function fixtureFetch(overrides: Record<string, Response> = {}): typeof fetch {
  const { index, manifest, snapshot } = fixtures();
  const responses: Record<string, Response> = {
    "/api/federation/v1/municipalities/roebel-mueritz/cases": json(index),
    [`${CASE_PATH}/manifest`]: json(manifest),
    [`${CASE_PATH}/stage-map`]: json(snapshot),
    ...overrides,
  };
  return (async (input: RequestInfo | URL) => {
    const path = new URL(String(input)).pathname;
    const response = responses[path];
    return response ? response.clone() : json({ error: "missing" }, { status: 404 });
  }) as typeof fetch;
}

async function expectCode(promise: Promise<unknown>, code: string) {
  await assert.rejects(promise, (error: unknown) => {
    return error instanceof StadtstackFederationError && error.code === code;
  });
}

test("loads and cryptographically verifies one reviewed public case", async () => {
  const result = await loadReviewedCivicCases({ baseUrl: BASE_URL, fetch: fixtureFetch() });
  assert.equal(result.cases.length, 1);
  assert.equal(result.cases[0].stageMap.current.position, 2);
  assert.equal(result.cases[0].summary.publicCaseUrl, `${BASE_URL}/kommunen/roebel-mueritz/entscheidungen/marienfelder-strasse`);
});

test("accepts an overall reviewed case whose current stage is truthfully missing", async () => {
  const { index, manifest, snapshot } = fixtures();
  const current = { ...snapshot.current, truthState: "missing" as const };
  const missingCurrentSnapshot = {
    ...snapshot,
    current,
    detailStages: snapshot.detailStages.map((stage) =>
      stage.id === "authority_and_contract"
        ? { ...stage, truthState: "missing" as const }
        : stage,
    ),
  };
  const result = await loadReviewedCivicCases({
    baseUrl: BASE_URL,
    fetch: fixtureFetch({
      "/api/federation/v1/municipalities/roebel-mueritz/cases": json({
        ...index,
        cases: [{ ...index.cases[0], currentStage: current }],
      }),
      [`${CASE_PATH}/manifest`]: json({
        ...manifest,
        stageMap: {
          ...manifest.stageMap,
          contentSha256: stageHash(missingCurrentSnapshot),
          snapshot: missingCurrentSnapshot,
        },
      }),
      [`${CASE_PATH}/stage-map`]: json(missingCurrentSnapshot),
    }),
  });
  assert.equal(result.cases[0].stageMap.current.truthState, "missing");
});

test("treats only a valid 200 empty index as an honest empty state", async () => {
  const { index } = fixtures();
  const result = await loadReviewedCivicCases({
    baseUrl: BASE_URL,
    fetch: fixtureFetch({
      "/api/federation/v1/municipalities/roebel-mueritz/cases": json({ ...index, cases: [] }),
    }),
  });
  assert.deepEqual(result.cases, []);

  await expectCode(
    loadReviewedCivicCases({
      baseUrl: BASE_URL,
      fetch: fixtureFetch({
        "/api/federation/v1/municipalities/roebel-mueritz/cases": json({}, { status: 404 }),
      }),
    }),
    "not_found",
  );
});

test("rejects unknown fields, cross-origin links and checksum drift", async () => {
  const { index, manifest } = fixtures();
  await expectCode(
    loadReviewedCivicCases({
      baseUrl: BASE_URL,
      fetch: fixtureFetch({
        "/api/federation/v1/municipalities/roebel-mueritz/cases": json({ ...index, privateReviewNote: "leak" }),
      }),
    }),
    "invalid_schema",
  );
  await expectCode(
    loadReviewedCivicCases({
      baseUrl: BASE_URL,
      fetch: fixtureFetch({
        "/api/federation/v1/municipalities/roebel-mueritz/cases": json({
          ...index,
          cases: [{ ...index.cases[0], stageMapUrl: "https://outside.example/stage-map" }],
        }),
      }),
    }),
    "unsafe_url",
  );
  await expectCode(
    loadReviewedCivicCases({
      baseUrl: BASE_URL,
      fetch: fixtureFetch({
        "/api/federation/v1/municipalities/roebel-mueritz/cases": json({
          ...index,
          cases: [{ ...index.cases[0], stageMapUrl: `${CASE_PATH}/../other/stage-map` }],
        }),
      }),
    }),
    "unsafe_url",
  );
  await expectCode(
    loadReviewedCivicCases({
      baseUrl: BASE_URL,
      fetch: fixtureFetch({
        [`${CASE_PATH}/manifest`]: json({
          ...manifest,
          stageMap: { ...manifest.stageMap, contentSha256: `sha256:${"b".repeat(64)}` },
        }),
      }),
    }),
    "checksum",
  );
});

test("rejects semantically forged stage projections even with a matching attacker hash", async () => {
  const { manifest, snapshot } = fixtures();
  const forged = {
    ...snapshot,
    detailStages: snapshot.detailStages.map((stage) =>
      stage.id === "authority_and_contract"
        ? { ...stage, label: "Manuell fortgeschrieben" }
        : stage,
    ),
  };
  await expectCode(
    loadReviewedCivicCases({
      baseUrl: BASE_URL,
      fetch: fixtureFetch({
        [`${CASE_PATH}/manifest`]: json({
          ...manifest,
          stageMap: {
            ...manifest.stageMap,
            contentSha256: stageHash(forged),
            snapshot: forged,
          },
        }),
        [`${CASE_PATH}/stage-map`]: json(forged),
      }),
    }),
    "invalid_schema",
  );
});

test("fails closed on 410, oversized bodies and request timeouts", async () => {
  await expectCode(
    loadReviewedCivicCases({
      baseUrl: BASE_URL,
      fetch: fixtureFetch({ [`${CASE_PATH}/stage-map`]: json({}, { status: 410 }) }),
    }),
    "withdrawn",
  );
  await expectCode(
    loadReviewedCivicCases({
      baseUrl: BASE_URL,
      maxResponseBytes: 1_024,
      fetch: fixtureFetch({
        "/api/federation/v1/municipalities/roebel-mueritz/cases": new Response("{}", {
          headers: { "content-type": "application/json", "content-length": "1025" },
        }),
      }),
    }),
    "too_large",
  );
  await expectCode(
    loadReviewedCivicCases({
      baseUrl: BASE_URL,
      timeoutMs: 100,
      fetch: (() => new Promise<Response>(() => {})) as typeof fetch,
    }),
    "timeout",
  );
  const slowBody = new ReadableStream<Uint8Array>({
    async pull(controller) {
      await new Promise((resolve) => setTimeout(resolve, 150));
      controller.enqueue(new TextEncoder().encode("{}"));
      controller.close();
    },
  });
  await expectCode(
    loadReviewedCivicCases({
      baseUrl: BASE_URL,
      timeoutMs: 100,
      fetch: (async () =>
        new Response(slowBody, {
          headers: { "content-type": "application/json" },
        })) as typeof fetch,
    }),
    "timeout",
  );
});
