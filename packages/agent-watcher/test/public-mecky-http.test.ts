import assert from "node:assert/strict";
import { test } from "node:test";

import {
  createPublicMeckyHttpHandler,
} from "../src/public-mecky-http";
import type { PublicMecky } from "../src/public-mecky";

const EVIDENCE_ID = `sha256:${"a".repeat(64)}`;
const NOW = new Date("2026-08-22T12:00:00.000Z");

function request(body: unknown): Request {
  return new Request("http://public-mecky.internal/v1/answer", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

test("answers one stateless chat turn through the reviewed Public Mecky engine", async () => {
  const mentions: Parameters<PublicMecky["answerMention"]>[0][] = [];
  const publicMecky: PublicMecky = {
    async answerMention(mention) {
      mentions.push(mention);
      return {
        status: "answered",
        content: "KI-Zusammenfassung: Der geprüfte Stand ist begrenzt.",
        evidenceRefs: [{
          evidenceId: EVIDENCE_ID,
          title: "Geprüfte Ausgangslage",
          publicCaseUrl: "https://stadtstack.example/case",
        }],
      };
    },
  };
  const handle = createPublicMeckyHttpHandler({
    publicMecky,
    municipalityId: "roebel-mueritz",
    now: () => NOW,
  });

  const response = await handle(request({
    schemaVersion: "public_mecky_chat_request_v1",
    question: "Welche geprüften Informationen liegen vor?",
  }));

  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.deepEqual(mentions, [{
    municipalityId: "roebel-mueritz",
    question: "Welche geprüften Informationen liegen vor?",
    now: NOW.toISOString(),
  }]);
  assert.deepEqual(await response.json(), {
    schemaVersion: "public_mecky_chat_response_v1",
    status: "answered",
    content: "KI-Zusammenfassung: Der geprüfte Stand ist begrenzt.",
    evidenceRefs: [{
      evidenceId: EVIDENCE_ID,
      title: "Geprüfte Ausgangslage",
      publicCaseUrl: "https://stadtstack.example/case",
    }],
    authorityBinding: "none",
    effects: {
      civicStateMutation: false,
      suggestionSubmission: false,
      vote: false,
    },
  });
});

test("returns a structured refusal without manufacturing an answer", async () => {
  const handle = createPublicMeckyHttpHandler({
    municipalityId: "roebel-mueritz",
    now: () => NOW,
    publicMecky: {
      async answerMention() {
        return {
          status: "refused",
          reason: "insufficient_evidence",
          retryable: false,
          diagnosticCode: "no_admitted_public_evidence",
        };
      },
    },
  });

  const response = await handle(request({
    schemaVersion: "public_mecky_chat_request_v1",
    question: "Was ist beschlossen?",
  }));

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    schemaVersion: "public_mecky_chat_response_v1",
    status: "refused",
    reason: "insufficient_evidence",
    retryable: false,
    diagnosticCode: "no_admitted_public_evidence",
    authorityBinding: "none",
    effects: {
      civicStateMutation: false,
      suggestionSubmission: false,
      vote: false,
    },
  });
});

test("rejects caller-controlled evidence, clocks, municipalities and oversized input", async () => {
  let calls = 0;
  const handle = createPublicMeckyHttpHandler({
    municipalityId: "roebel-mueritz",
    publicMecky: {
      async answerMention() {
        calls += 1;
        throw new Error("must_not_call");
      },
    },
  });

  for (const body of [
    {
      schemaVersion: "public_mecky_chat_request_v1",
      question: "Frage",
      municipalityId: "other",
    },
    {
      schemaVersion: "public_mecky_chat_request_v1",
      question: "Frage",
      now: NOW.toISOString(),
    },
    {
      schemaVersion: "public_mecky_chat_request_v1",
      question: "Frage",
      evidence: [],
    },
    {
      schemaVersion: "public_mecky_chat_request_v1",
      question: `x${"ä".repeat(1_100)}`,
    },
  ]) {
    assert.equal((await handle(request(body))).status, 400);
  }
  assert.equal(calls, 0);
});

test("exposes only a health check and the exact answer route", async () => {
  const handle = createPublicMeckyHttpHandler({
    municipalityId: "roebel-mueritz",
    publicMecky: {
      async answerMention() {
        throw new Error("must_not_call");
      },
    },
  });

  const health = await handle(new Request("http://public-mecky.internal/healthz"));
  assert.equal(health.status, 200);
  assert.deepEqual(await health.json(), { status: "ok" });
  assert.equal(
    (await handle(new Request("http://public-mecky.internal/v1/answer"))).status,
    405,
  );
  assert.equal(
    (await handle(new Request("http://public-mecky.internal/other"))).status,
    404,
  );
  assert.equal(
    (await handle(new Request("http://public-mecky.internal/healthz?debug=1"))).status,
    404,
  );
  assert.equal(
    (await handle(new Request(
      "http://public-mecky.internal/v1/answer?municipality=other",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          schemaVersion: "public_mecky_chat_request_v1",
          question: "Frage",
        }),
      },
    ))).status,
    404,
  );
});

test("reserves a bounded global inference budget before concurrent answers", async () => {
  let now = new Date(NOW);
  let calls = 0;
  const handle = createPublicMeckyHttpHandler({
    municipalityId: "roebel-mueritz",
    now: () => now,
    bounds: { perMinute: 2, perDay: 3 },
    publicMecky: {
      async answerMention() {
        calls += 1;
        return {
          status: "refused",
          reason: "insufficient_evidence",
          retryable: false,
          diagnosticCode: "no_admitted_public_evidence",
        };
      },
    },
  });
  const body = {
    schemaVersion: "public_mecky_chat_request_v1",
    question: "Was ist geprüft?",
  };

  assert.equal((await handle(request(body))).status, 200);
  assert.equal((await handle(request(body))).status, 200);
  const minuteLimited = await handle(request(body));
  assert.equal(minuteLimited.status, 429);
  assert.equal(minuteLimited.headers.get("retry-after"), "60");

  now = new Date(NOW.getTime() + 60_000);
  assert.equal((await handle(request(body))).status, 200);
  const dayLimited = await handle(request(body));
  assert.equal(dayLimited.status, 429);
  assert.equal(calls, 3);
});

test("fails closed when inference throws and rejects unsafe bounds", async () => {
  const handle = createPublicMeckyHttpHandler({
    municipalityId: "roebel-mueritz",
    publicMecky: {
      async answerMention() {
        throw new Error("provider_unavailable");
      },
    },
  });
  assert.equal((await handle(request({
    schemaVersion: "public_mecky_chat_request_v1",
    question: "Was ist geprüft?",
  }))).status, 503);
  assert.throws(() => createPublicMeckyHttpHandler({
    municipalityId: "roebel-mueritz",
    bounds: { perMinute: 5, perDay: 4 },
    publicMecky: { async answerMention() { throw new Error("unused"); } },
  }), /bounds_invalid/);
});
