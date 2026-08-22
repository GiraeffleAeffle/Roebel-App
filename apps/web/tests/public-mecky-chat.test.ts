import assert from "node:assert/strict";
import { test } from "node:test";

import {
  parsePublicMeckyChatQuestion,
  parsePublicMeckyChatResponse,
  publicMeckyChatEndpoint,
  requestPublicMeckyChat,
} from "../src/lib/public-mecky-chat";

const EVIDENCE_ID = `sha256:${"a".repeat(64)}`;
const ANSWER = {
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
};

test("accepts one bounded question and rejects client-controlled context", () => {
  assert.equal(parsePublicMeckyChatQuestion({
    schemaVersion: "public_mecky_chat_request_v1",
    question: "Welche geprüften Informationen liegen vor?",
  }), "Welche geprüften Informationen liegen vor?");
  for (const value of [
    { schemaVersion: "public_mecky_chat_request_v1", question: " Frage" },
    { schemaVersion: "public_mecky_chat_request_v1", question: "Frage", mode: "citizen" },
    { schemaVersion: "public_mecky_chat_request_v1", question: "Frage", messages: [] },
    { schemaVersion: "public_mecky_chat_request_v1", question: "Frage", evidence: [] },
  ]) {
    assert.throws(() => parsePublicMeckyChatQuestion(value), /request_invalid/);
  }
});

test("only permits the configured cluster-internal answer endpoint", () => {
  assert.equal(
    publicMeckyChatEndpoint(
      "http://public-mecky.stadtstack-roebel-staging-lab.svc.cluster.local:18084",
    ).href,
    "http://public-mecky.stadtstack-roebel-staging-lab.svc.cluster.local:18084/v1/answer",
  );
  assert.equal(
    publicMeckyChatEndpoint("http://127.0.0.1:18084").href,
    "http://127.0.0.1:18084/v1/answer",
  );
  for (const value of [
    "https://public-mecky.example",
    "http://public-mecky.example",
    "http://user:secret@public-mecky.staging.svc.cluster.local",
    "http://public-mecky.staging.svc.cluster.local/other",
  ]) {
    assert.throws(() => publicMeckyChatEndpoint(value), /url_invalid/);
  }
});

test("requires checksum-bound citations and explicit no-effect boundaries", () => {
  assert.deepEqual(parsePublicMeckyChatResponse(ANSWER), ANSWER);
  for (const value of [
    { ...ANSWER, evidenceRefs: [] },
    { ...ANSWER, authorityBinding: "municipality" },
    { ...ANSWER, effects: { ...ANSWER.effects, vote: true } },
    {
      ...ANSWER,
      evidenceRefs: [{ ...ANSWER.evidenceRefs[0], publicCaseUrl: "http://private.local" }],
    },
  ]) {
    assert.throws(() => parsePublicMeckyChatResponse(value), /response_invalid/);
  }
});

test("sends no transcript, mode, identity, evidence or provider credential", async () => {
  let sent: { url: string; init: RequestInit } | undefined;
  const result = await requestPublicMeckyChat({
    baseUrl:
      "http://public-mecky.stadtstack-roebel-staging-lab.svc.cluster.local:18084",
    question: "Was ist der geprüfte Stand?",
    fetch: async (input, init) => {
      sent = { url: String(input), init: init! };
      return Response.json(ANSWER);
    },
  });

  assert.deepEqual(result, ANSWER);
  assert.equal(sent?.url,
    "http://public-mecky.stadtstack-roebel-staging-lab.svc.cluster.local:18084/v1/answer");
  assert.deepEqual(JSON.parse(String(sent?.init.body)), {
    schemaVersion: "public_mecky_chat_request_v1",
    question: "Was ist der geprüfte Stand?",
  });
  assert.deepEqual(Object.keys(JSON.parse(String(sent?.init.body))).sort(), [
    "question", "schemaVersion",
  ]);
});
