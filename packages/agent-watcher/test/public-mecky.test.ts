import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { describe, it } from "node:test";
import { buildCivicDiscussionEvent } from "@netizen-labs/nostr";
import {
  createStaticReviewedEvidenceReader,
  createOpenAICompatiblePublicMeckyInference,
  createPiPublicMeckyInference,
  createPublicMecky,
  createPublicMeckyEvidenceReply,
  createPublicMeckyRelayReply,
  createStadtstackPublicEvidenceRetriever,
  createStadtstackReviewedEvidenceReader,
  toPublicMeckyWatcherReply,
} from "../src/public-mecky";

const EVIDENCE_ID = `sha256:${"a".repeat(64)}`;

it("adds evidence tags to an ordinary Mecky reply without civic authority", () => {
  const reply = createPublicMeckyEvidenceReply({
    status: "answered",
    content: "KI-Zusammenfassung: Geprüfte Einordnung.",
    evidenceRefs: [{
      evidenceId: EVIDENCE_ID,
      title: "Öffentliche Quelle",
      publicCaseUrl: "https://roebel.example/quelle",
    }],
  });
  assert.deepEqual(reply, {
    content: "KI-Zusammenfassung: Geprüfte Einordnung.",
    tags: [["evidence", EVIDENCE_ID, "https://roebel.example/quelle"]],
  });
  assert.equal(reply.tags.some((tag) => ["case", "topic", "municipality", "mecky-receipt"].includes(tag[0]!)), false);
});

it("loads only an exact checksum-bound synthetic reviewed snapshot", async () => {
  const snapshot = JSON.stringify([{
    evidenceId: EVIDENCE_ID,
    title: "Marienfelder Straße",
    publicSummary: "Geprüfte Ausgangslage für den synthetischen Test.",
    currentStageLabel: "Evidenz geprüft",
    nextAction: "Varianten transparent abwägen",
    participationAuthorityState: "unconfirmed",
    reviewedAt: "2026-08-12T08:00:00.000Z",
    publicCaseUrl: "https://e2e.roebel.invalid/mitmachen/marienfelder-strasse",
  }]);
  const digest = `sha256:${createHash("sha256").update(snapshot).digest("hex")}`;
  const reader = createStaticReviewedEvidenceReader(snapshot, digest);
  assert.deepEqual(await reader(), JSON.parse(snapshot));
  assert.throws(() => createStaticReviewedEvidenceReader(snapshot, `sha256:${"0".repeat(64)}`), /digest mismatch/);
  assert.throws(() => createStaticReviewedEvidenceReader(JSON.stringify([{ ...JSON.parse(snapshot)[0], extra: true }]), digest));
});

it("binds a civic Mecky reply to the signed discussion, Case and reviewed evidence", () => {
  const discussion = buildCivicDiscussionEvent(new Uint8Array(32).fill(42), {
    municipalityId: "roebel-mueritz",
    sourceCaseId: "marienfelder-strasse",
    canonicalCaseId:
      "urn:stadtstack:case:municipality:roebel-mueritz:018f0000-0000-7000-8000-000000000001",
    agentPubkey: "c".repeat(64),
    content: "@Mecky Kann hier eine sichere Querung geprüft werden?",
    createdAt: 1_786_464_000,
  });
  const reply = createPublicMeckyRelayReply({
    discussion,
    binding: {
      municipalityId: "roebel-mueritz",
      sourceCaseId: "marienfelder-strasse",
      canonicalCaseId:
        "urn:stadtstack:case:municipality:roebel-mueritz:018f0000-0000-7000-8000-000000000001",
    },
    result: {
      status: "answered",
      content:
        "KI-Zusammenfassung: Eine Prüfung ist möglich.\n\nGeprüfte Quelle: Marienfelder Straße – https://stadtstack.example/case",
      evidenceRefs: [
        {
          evidenceId: EVIDENCE_ID,
          title: "Marienfelder Straße",
          publicCaseUrl: "https://stadtstack.example/case",
        },
      ],
    },
  });

  assert.match(reply.receiptId, /^urn:stadtstack:mecky-answer:[0-9a-f]{64}$/);
  const watcherReply = toPublicMeckyWatcherReply(reply);
  assert.deepEqual(Object.keys(watcherReply).sort(), ["content", "tags"]);
  assert.equal(watcherReply.content, reply.content);
  assert.deepEqual(watcherReply.tags, reply.tags);
  assert.notEqual(watcherReply.tags, reply.tags);
  assert.deepEqual(reply.tags, [
    ["mecky-receipt", reply.receiptId],
    ["municipality", "roebel-mueritz"],
    ["case", "marienfelder-strasse"],
    [
      "stadtstack-case",
      "urn:stadtstack:case:municipality:roebel-mueritz:018f0000-0000-7000-8000-000000000001",
    ],
    ["evidence", EVIDENCE_ID, "https://stadtstack.example/case"],
  ]);
  assert.deepEqual(
    createPublicMeckyRelayReply({
      discussion,
      binding: {
        municipalityId: "roebel-mueritz",
        sourceCaseId: "marienfelder-strasse",
        canonicalCaseId:
          "urn:stadtstack:case:municipality:roebel-mueritz:018f0000-0000-7000-8000-000000000001",
      },
      result: {
        status: "answered",
        content: reply.content,
        evidenceRefs: [
          {
            evidenceId: EVIDENCE_ID,
            title: "Marienfelder Straße",
            publicCaseUrl: "https://stadtstack.example/case",
          },
        ],
      },
    }),
    reply
  );
});

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
        assert.equal(
          question,
          "Kann ich über die Marienfelder Straße schon abstimmen?"
        );
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
      "Kann ich über die Marienfelder Straße schon abstimmen?"
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
      "Was hat die Verwaltung beschlossen?"
    );

    assert.deepEqual(result, {
      status: "refused",
      reason: "no_reviewed_evidence",
      retryable: false,
      diagnosticCode: "no_reviewed_evidence",
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
        assert.equal(options.allowClusterInternalHttp, true);
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
        publicSummary: "Der Fall befindet sich in der Verwaltungsprüfung.",
        currentStageLabel: "Verwaltungsprüfung und Entscheidungsbrief",
        nextAction: "Öffentliche Kurzfassung prüfen.",
        participationAuthorityState: "unconfirmed",
        reviewedAt: "2026-08-10T11:30:00.000Z",
        publicCaseUrl:
          "https://stadtstack.example/kommunen/roebel-mueritz/entscheidungen/marienfelder-strasse",
      },
    ]);
  });

  it("retrieves only question-relevant minimized Stadtstack evidence", async () => {
    const retrieve = createStadtstackPublicEvidenceRetriever({
      baseUrl: "https://stadtstack.example",
      municipalityId: "roebel-mueritz",
      loadReviewedCases: async () => ({
        municipality: {
          id: "roebel-mueritz",
          name: "Röbel/Müritz",
          state: "Mecklenburg-Vorpommern",
          country: "DE",
        },
        generatedAt: "2026-08-10T12:00:00.000Z",
        cases: [{
          summary: {
            decisionCaseSlug: "marienfelder-strasse",
            title: "Marienfelder Straße",
            publicSummary: "Geprüfter Stand zur geplanten Querung.",
            updatedAt: "2026-08-10T11:30:00.000Z",
            publicCaseUrl: "https://stadtstack.example/kommunen/roebel-mueritz/entscheidungen/marienfelder-strasse",
          },
          manifest: { stageMap: { contentSha256: EVIDENCE_ID } },
          stageMap: { current: { label: "Fakten verstehen", nextAction: null } },
        }],
      } as never),
    });

    const selected = await retrieve("Was ist zur Querung der Marienfelder Straße belegt?");
    assert.equal(selected.passages.length, 1);
    assert.equal(selected.passages[0]!.prompt.evidenceId, EVIDENCE_ID);
    assert.equal(Object.hasOwn(selected.passages[0]!.prompt, "caseUrl"), false);
    assert.deepEqual(
      (await retrieve("Wann öffnet das Schwimmbad?")).passages,
      [],
    );
  });

  it("distinguishes an unavailable reviewed source from a truthful empty result", async () => {
    let inferenceCalls = 0;
    const mecky = createPublicMecky({
      retrieveEvidence: async () => ({
        schemaVersion: "public_evidence_packet_v1",
        packetId: `sha256:${"f".repeat(64)}`,
        municipalityId: "roebel-mueritz",
        generatedAt: "2026-08-21T12:00:00.000Z",
        passages: [],
        omissions: [{ sourceKind: "reviewed_civic_case", reason: "source_unavailable", count: 1 }],
      }),
      infer: async () => {
        inferenceCalls += 1;
        return { answer: "Nicht belegt", evidenceIds: [EVIDENCE_ID] };
      },
    });

    assert.deepEqual(await mecky.answerMention("Was ist der Stand?"), {
      status: "refused",
      reason: "evidence_unavailable",
      retryable: true,
      diagnosticCode: "evidence_source_unavailable",
    });
    assert.equal(inferenceCalls, 0);
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
        observedAuthorization =
          new Headers(init?.headers).get("authorization") ?? "";
        observedBody = JSON.parse(String(init?.body)) as Record<
          string,
          unknown
        >;
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
      omissions: [{ sourceKind: "local_news", reason: "source_unavailable", count: 1 }],
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
      "https://inference.hetzner.com/api/v1/chat/completions"
    );
    assert.equal(observedAuthorization, "Bearer test-token");
    const requestBody = observedBody as Record<string, unknown> | null;
    assert.ok(requestBody);
    assert.equal(requestBody.model, "DeepSeek-V4-Flash-0731");
    assert.match(JSON.stringify(requestBody), /Kann ich schon abstimmen/);
    assert.match(JSON.stringify(requestBody), new RegExp(EVIDENCE_ID));
    assert.match(JSON.stringify(requestBody), /source_unavailable/);
    assert.match(JSON.stringify(requestBody), /community_statement/);
    assert.match(JSON.stringify(requestBody), /publicEvidence/);
    assert.doesNotMatch(JSON.stringify(requestBody), /reviewedEvidence/);
    assert.deepEqual(result, {
      answer: "Eine Abstimmung ist noch nicht eröffnet.",
      evidenceIds: [EVIDENCE_ID],
    });
  });

  it("runs reviewed evidence through a zero-tool Pi agent", async () => {
    let observedUrl = "";
    let observedAuthorization = "";
    let observedBody: Record<string, unknown> | null = null;
    const infer = createPiPublicMeckyInference({
      baseUrl: "https://inference.hetzner.com/api/v1",
      apiKey: "test-token",
      model: "DeepSeek-V4-Flash-0731",
      fetch: async (input, init) => {
        observedUrl = String(input);
        observedAuthorization =
          new Headers(init?.headers).get("authorization") ?? "";
        observedBody = JSON.parse(String(init?.body)) as Record<
          string,
          unknown
        >;
        const content = JSON.stringify({
          answer: "Eine Abstimmung ist noch nicht eröffnet.",
          evidenceIds: [EVIDENCE_ID],
        });
        return Response.json({
          id: "chatcmpl-stadtstack",
          object: "chat.completion",
          created: 1_786_464_000,
          model: "DeepSeek-V4-Flash-0731",
          choices: [{
            index: 0,
            message: { role: "assistant", content },
            finish_reason: "stop",
          }],
          usage: {
            prompt_tokens: 100,
            completion_tokens: 20,
            total_tokens: 120,
          },
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
      "https://inference.hetzner.com/api/v1/chat/completions"
    );
    assert.equal(observedAuthorization, "Bearer test-token");
    const requestBody = observedBody as Record<string, unknown> | null;
    assert.ok(requestBody);
    assert.equal(requestBody.model, "DeepSeek-V4-Flash-0731");
    assert.equal(requestBody.stream, false);
    assert.equal(requestBody.temperature, 0);
    assert.equal(requestBody.max_tokens, 500);
    assert.deepEqual(requestBody.response_format, { type: "json_object" });
    assert.deepEqual(requestBody.chat_template_kwargs, {
      enable_thinking: false,
    });
    assert.ok(!("tools" in requestBody));
    assert.match(JSON.stringify(requestBody), /Kann ich schon abstimmen/);
    assert.match(JSON.stringify(requestBody), new RegExp(EVIDENCE_ID));
    assert.deepEqual(result, {
      answer: "Eine Abstimmung ist noch nicht eröffnet.",
      evidenceIds: [EVIDENCE_ID],
    });
  });

  it("aborts a Pi provider request at the public deadline", async () => {
    let aborted = false;
    const infer = createPiPublicMeckyInference({
      baseUrl: "https://inference.hetzner.com/api/v1",
      apiKey: "test-token",
      model: "DeepSeek-V4-Flash-0731",
      timeoutMs: 1_000,
      fetch: async (_input, init) =>
        await new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener(
            "abort",
            () => {
              aborted = true;
              reject(new DOMException("aborted", "AbortError"));
            },
            { once: true }
          );
        }),
    });

    await assert.rejects(
      infer({
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
            publicCaseUrl: "https://stadtstack.example/case",
          },
        ],
      }),
      /Public Mecky Pi run timed out/
    );
    assert.equal(aborted, true);
  });

  it("fails closed on a malformed Pi provider result", async () => {
    const infer = createPiPublicMeckyInference({
      baseUrl: "https://inference.hetzner.com/api/v1",
      apiKey: "test-token",
      model: "DeepSeek-V4-Flash-0731",
      fetch: async () => Response.json({
        id: "chatcmpl-malformed",
        model: "DeepSeek-V4-Flash-0731",
        choices: [{
          index: 0,
          message: { role: "assistant", content: '{"answer":' },
          finish_reason: "stop",
        }],
      }),
    });

    await assert.rejects(
      infer({ question: "Frage", evidence: [] }),
      /Public Mecky provider returned invalid JSON/
    );
  });

  it("preserves only a provider HTTP status for retry diagnostics", async () => {
    const infer = createPiPublicMeckyInference({
      baseUrl: "https://inference.hetzner.com/api/v1",
      apiKey: "test-token",
      model: "Qwen/Qwen3.6-35B-A3B-FP8",
      fetch: async () => new Response("not exposed", { status: 403 }),
    });

    await assert.rejects(
      infer({ question: "Frage", evidence: [] }),
      /Public Mecky provider failed with HTTP 403/
    );
  });

  it("fails closed when a Pi provider attempts a tool call", async () => {
    const infer = createPiPublicMeckyInference({
      baseUrl: "https://inference.hetzner.com/api/v1",
      apiKey: "test-token",
      model: "DeepSeek-V4-Flash-0731",
      fetch: async () => Response.json({
        id: "chatcmpl-tool",
        model: "DeepSeek-V4-Flash-0731",
        choices: [{
          index: 0,
          message: {
            role: "assistant",
            content: null,
            tool_calls: [{
              id: "call_forbidden",
              type: "function",
              function: { name: "fetch", arguments: '{"url":"https://example.com"}' },
            }],
          },
          finish_reason: "tool_calls",
        }],
      }),
    });

    await assert.rejects(
      infer({ question: "Frage", evidence: [] }),
      /failed to complete the Pi run|invalid Pi result/
    );
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
      retryable: true,
      diagnosticCode: "provider_transport_unavailable",
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
      retryable: true,
      diagnosticCode: "evidence_reader_unavailable",
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
      retryable: false,
      diagnosticCode: "unverified_evidence_reference",
    });
  });
});
