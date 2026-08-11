import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  createOpenAICompatiblePublicMeckyInference,
  createPublicMecky,
  createStadtstackReviewedEvidenceReader,
} from "../src/public-mecky";

const EVIDENCE_ID = `sha256:${"a".repeat(64)}`;

describe("Public Mecky", () => {
  it("answers a public mention from reviewed Stadtstack evidence and cites it", async () => {
    const mecky = createPublicMecky({
      readReviewedEvidence: async () => [
        {
          evidenceId: EVIDENCE_ID,
          title: "Marienfelder Straße",
          publicSummary:
            "Der Fall befindet sich in der Verwaltungsprüfung. Eine Abstimmung ist noch nicht eröffnet.",
          currentStageLabel: "Verwaltungsprüfung und Entscheidungsbrief",
          nextAction: "Die geprüfte öffentliche Kurzfassung veröffentlichen.",
          participationAuthorityState: "unconfirmed",
          reviewedAt: "2026-08-10T12:00:00.000Z",
          publicCaseUrl:
            "https://stadtstack.example/kommunen/roebel-mueritz/entscheidungen/marienfelder-strasse",
        },
      ],
      infer: async ({ question, evidence }) => {
        assert.equal(question, "Kann ich über die Marienfelder Straße schon abstimmen?");
        assert.equal(evidence.length, 1);
        assert.equal(evidence[0].evidenceId, EVIDENCE_ID);
        return {
          answer:
            "Noch nicht. Der geprüfte Stand nennt die Verwaltungsprüfung; eine Abstimmung ist noch nicht eröffnet.",
          evidenceIds: [EVIDENCE_ID],
        };
      },
    });

    const result = await mecky.answerMention(
      "Kann ich über die Marienfelder Straße schon abstimmen?",
    );

    assert.deepEqual(result, {
      status: "answered",
      content:
        "KI-Zusammenfassung: Noch nicht. Der geprüfte Stand nennt die Verwaltungsprüfung; eine Abstimmung ist noch nicht eröffnet.\n\nGeprüfte Quelle: Marienfelder Straße – https://stadtstack.example/kommunen/roebel-mueritz/entscheidungen/marienfelder-strasse",
      evidenceRefs: [
        {
          evidenceId: EVIDENCE_ID,
          title: "Marienfelder Straße",
          publicCaseUrl:
            "https://stadtstack.example/kommunen/roebel-mueritz/entscheidungen/marienfelder-strasse",
        },
      ],
    });
  });

  it("refuses before inference when no reviewed public evidence exists", async () => {
    let inferenceCalls = 0;
    const mecky = createPublicMecky({
      readReviewedEvidence: async () => [],
      infer: async () => {
        inferenceCalls += 1;
        return { answer: "Erfundene Antwort", evidenceIds: [] };
      },
    });

    const result = await mecky.answerMention(
      "Was hat die Verwaltung beschlossen?",
    );

    assert.deepEqual(result, {
      status: "refused",
      reason: "no_reviewed_evidence",
    });
    assert.equal(inferenceCalls, 0);
  });

  it("reads only checksum-bound public fields from the Stadtstack federation client", async () => {
    const readReviewedEvidence = createStadtstackReviewedEvidenceReader({
      baseUrl: "https://stadtstack.example",
      municipalityId: "roebel-mueritz",
      loadReviewedCases: async (options) => {
        assert.equal(options.baseUrl, "https://stadtstack.example");
        assert.equal(options.municipalityId, "roebel-mueritz");
        return {
          municipality: {
            id: "roebel-mueritz",
            name: "Röbel/Müritz",
            state: "Mecklenburg-Vorpommern",
            country: "DE",
          },
          generatedAt: "2026-08-10T12:00:00.000Z",
          cases: [
            {
              summary: {
                decisionCaseSlug: "marienfelder-strasse",
                title: "Marienfelder Straße",
                publicSummary:
                  "Der Fall befindet sich in der Verwaltungsprüfung.",
                truthState: "reviewed",
                participationAuthorityState: "unconfirmed",
                currentStage: {
                  label: "Verwaltungsprüfung und Entscheidungsbrief",
                },
                publicCaseUrl:
                  "https://stadtstack.example/kommunen/roebel-mueritz/entscheidungen/marienfelder-strasse",
                updatedAt: "2026-08-10T11:30:00.000Z",
              },
              manifest: {
                stageMap: { contentSha256: EVIDENCE_ID },
              },
              stageMap: {
                participationAuthorityState: "unconfirmed",
                current: {
                  label: "Verwaltungsprüfung und Entscheidungsbrief",
                  nextAction: "Öffentliche Kurzfassung prüfen.",
                },
              },
            },
          ],
        } as never;
      },
    });

    assert.deepEqual(await readReviewedEvidence(), [
      {
        evidenceId: EVIDENCE_ID,
        title: "Marienfelder Straße",
        publicSummary:
          "Der Fall befindet sich in der Verwaltungsprüfung.",
        currentStageLabel: "Verwaltungsprüfung und Entscheidungsbrief",
        nextAction: "Öffentliche Kurzfassung prüfen.",
        participationAuthorityState: "unconfirmed",
        reviewedAt: "2026-08-10T11:30:00.000Z",
        publicCaseUrl:
          "https://stadtstack.example/kommunen/roebel-mueritz/entscheidungen/marienfelder-strasse",
      },
    ]);
  });

  it("uses an OpenAI-compatible provider with only the question and reviewed evidence", async () => {
    let observedUrl = "";
    let observedAuthorization = "";
    let observedBody: Record<string, unknown> | null = null;
    const infer = createOpenAICompatiblePublicMeckyInference({
      baseUrl: "https://inference.hetzner.com/api/v1",
      apiKey: "test-token",
      model: "DeepSeek-V4-Flash-0731",
      fetch: async (input, init) => {
        observedUrl = String(input);
        observedAuthorization = new Headers(init?.headers).get("authorization") ?? "";
        observedBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
        return Response.json({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  answer: "Eine Abstimmung ist noch nicht eröffnet.",
                  evidenceIds: [EVIDENCE_ID],
                }),
              },
            },
          ],
        });
      },
    });

    const result = await infer({
      question: "Kann ich schon abstimmen?",
      evidence: [
        {
          evidenceId: EVIDENCE_ID,
          title: "Marienfelder Straße",
          publicSummary: "Eine Abstimmung ist noch nicht eröffnet.",
          currentStageLabel: "Verwaltungsprüfung",
          nextAction: null,
          participationAuthorityState: "unconfirmed",
          reviewedAt: "2026-08-10T12:00:00.000Z",
          publicCaseUrl:
            "https://stadtstack.example/kommunen/roebel-mueritz/entscheidungen/marienfelder-strasse",
        },
      ],
    });

    assert.equal(
      observedUrl,
      "https://inference.hetzner.com/api/v1/chat/completions",
    );
    assert.equal(observedAuthorization, "Bearer test-token");
    const requestBody = observedBody as Record<string, unknown> | null;
    assert.ok(requestBody);
    assert.equal(requestBody.model, "DeepSeek-V4-Flash-0731");
    assert.match(JSON.stringify(requestBody), /Kann ich schon abstimmen/);
    assert.match(JSON.stringify(requestBody), new RegExp(EVIDENCE_ID));
    assert.deepEqual(result, {
      answer: "Eine Abstimmung ist noch nicht eröffnet.",
      evidenceIds: [EVIDENCE_ID],
    });
  });

  it("refuses rather than publishing when inference fails", async () => {
    const mecky = createPublicMecky({
      readReviewedEvidence: async () => [
        {
          evidenceId: EVIDENCE_ID,
          title: "Marienfelder Straße",
          publicSummary: "Geprüfter Stand",
          currentStageLabel: "Verwaltungsprüfung",
          nextAction: null,
          participationAuthorityState: "unconfirmed",
          reviewedAt: "2026-08-10T12:00:00.000Z",
          publicCaseUrl:
            "https://stadtstack.example/kommunen/roebel-mueritz/entscheidungen/marienfelder-strasse",
        },
      ],
      infer: async () => {
        throw new Error("provider unavailable");
      },
    });

    assert.deepEqual(await mecky.answerMention("Was ist der Stand?"), {
      status: "refused",
      reason: "inference_unavailable",
    });
  });

  it("refuses before inference when reviewed evidence is unavailable", async () => {
    let inferenceCalls = 0;
    const mecky = createPublicMecky({
      readReviewedEvidence: async () => {
        throw new Error("stadtstack unavailable");
      },
      infer: async () => {
        inferenceCalls += 1;
        return { answer: "Nicht belegt", evidenceIds: [EVIDENCE_ID] };
      },
    });

    assert.deepEqual(await mecky.answerMention("Was ist der Stand?"), {
      status: "refused",
      reason: "evidence_unavailable",
    });
    assert.equal(inferenceCalls, 0);
  });

  it("refuses a fluent answer that cites no reviewed evidence", async () => {
    const mecky = createPublicMecky({
      readReviewedEvidence: async () => [
        {
          evidenceId: EVIDENCE_ID,
          title: "Marienfelder Straße",
          publicSummary: "Geprüfter Stand",
          currentStageLabel: "Verwaltungsprüfung",
          nextAction: null,
          participationAuthorityState: "unconfirmed",
          reviewedAt: "2026-08-10T12:00:00.000Z",
          publicCaseUrl:
            "https://stadtstack.example/kommunen/roebel-mueritz/entscheidungen/marienfelder-strasse",
        },
      ],
      infer: async () => ({
        answer: "Das ist bestimmt schon beschlossen.",
        evidenceIds: [],
      }),
    });

    assert.deepEqual(await mecky.answerMention("Ist das beschlossen?"), {
      status: "refused",
      reason: "unverified_evidence_reference",
    });
  });
});
