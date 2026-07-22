import assert from "node:assert/strict";
import test from "node:test";

import { loadRoebelDepartmentDemo, StadtstackFederationError } from "./index";

const BASE_URL = "https://stadtstack.example";

function projection() {
  return {
    schemaVersion: "roebel_department_connection_projection_v1",
    caseKey: {
      municipalityId: "roebel-mueritz",
      decisionCaseSlug: "marienfelder-strasse",
    },
    truthState: "demo",
    answeredCount: 1,
    totalCount: 1,
    departments: [
      {
        family: "planning_engineering",
        label: "Planung und Tiefbau",
        primaryQuestion: "Welche Variante ist fachlich machbar?",
        axes: {
          transfer: "acknowledged",
          work: "submitted",
          review: "reviewed",
          public: "published",
        },
        summaryLabel: "Fachantwort veröffentlicht",
        transferLabel: "Empfang bestätigt",
        workLabel: "Fachantwort eingereicht",
        reviewLabel: "Menschlich geprüft",
        publicLabel: "Öffentlich sichtbar",
        publicAnswer: "Synthetische Beispielantwort.",
        nextAction: "Nächsten Fachbereich einbinden.",
      },
    ],
    boundary: {
      stageTransition: false,
      authorityConfirmation: false,
      publication: false,
      workspaceWrite: false,
      councilSubmission: false,
      citizenNotification: false,
    },
  };
}

function response(value: unknown, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(value), {
    headers: {
      "content-type": "application/json",
      "x-stadtstack-truth-state": "demo",
      "x-stadtstack-authority": "none",
      "x-stadtstack-demo-scenario": "walkthrough",
      ...headers,
    },
  });
}

test("loads only the explicitly labelled synthetic department walkthrough", async () => {
  let requestedUrl = "";
  const result = await loadRoebelDepartmentDemo({
    baseUrl: BASE_URL,
    fetch: (async (input: RequestInfo | URL) => {
      requestedUrl = String(input);
      return response(projection());
    }) as typeof fetch,
  });

  assert.equal(
    requestedUrl,
    `${BASE_URL}/api/demo/roebel-marienfelder/department-status?scenario=walkthrough`,
  );
  assert.equal(result.truthState, "demo");
  assert.equal(result.departments[0].axes.public, "published");
});

test("fails closed when the server does not assert the demo boundary", async () => {
  await assert.rejects(
    loadRoebelDepartmentDemo({
      baseUrl: BASE_URL,
      fetch: (async () =>
        response(projection(), { "x-stadtstack-authority": "municipal" })) as typeof fetch,
    }),
    (error: unknown) =>
      error instanceof StadtstackFederationError && error.code === "contract_mismatch",
  );
});

test("rejects a projection whose published-answer count is inconsistent", async () => {
  await assert.rejects(
    loadRoebelDepartmentDemo({
      baseUrl: BASE_URL,
      fetch: (async () =>
        response({ ...projection(), answeredCount: 0 })) as typeof fetch,
    }),
    (error: unknown) =>
      error instanceof StadtstackFederationError && error.code === "invalid_schema",
  );
});
