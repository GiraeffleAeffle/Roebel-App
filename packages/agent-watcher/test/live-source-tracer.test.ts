import assert from "node:assert/strict";
import { it } from "node:test";

import {
  buildNoteEvent,
  deriveAgentIdentity,
  deriveNostrSecretKey,
  verifyEvent,
  type NostrEvent,
} from "@netizen-labs/nostr";
import { emptyHistory } from "../src/bounds";
import { createDirectMentionEvidence } from "../src/conversation-evidence";
import {
  createPublicMecky,
  createPublicMeckyEvidenceReply,
  createStadtstackPublicEvidenceRetriever,
} from "../src/public-mecky";
import { sealReviewedPublicKnowledgeProjection } from "../src/reviewed-public-knowledge";
import { watchOnce } from "../src/watcher";

const NOW = Math.floor(Date.parse("2026-08-31T19:00:00.000Z") / 1_000);
const POST_ID = "735187dc-d737-4e6c-bdd9-fe0792fec498";
const AGENT = deriveAgentIdentity(
  "roebel-live-source-tracer-agent-secret-with-enough-entropy-2026",
  "roebel",
  "mecky",
);
const CITIZEN = deriveNostrSecretKey(`0x${"73".repeat(65)}`);

const PROJECTIONS = {
  local_news: sealReviewedPublicKnowledgeProjection({
    schemaVersion: "reviewed_public_knowledge_projection_v1",
    municipalityId: "roebel-mueritz",
    sourceKind: "local_news",
    generatedAt: "2026-08-31T18:58:00.000Z",
    records: [{
      evidenceId: `sha256:${"a".repeat(64)}`,
      municipalityId: "roebel-mueritz",
      sourceKind: "local_news",
      authority: "editorial_report",
      title: "MV17a Dambeck–Bollewick (geplant: Stuer–Röbel)",
      summary:
        "Die Fachseite nennt belegte, prüfbare Anknüpfungspunkte für Bürger und zuständige Stellen.",
      publishedAt: "2022-06-06T00:00:00.000Z",
      admissionState: "admitted",
      lifecycle: "current",
      publisher: "Bahntrassenradeln",
      articleUrl: "https://www.bahntrassenradeln.de/details/mv17a.htm",
      reviewedAt: "2026-08-31T18:58:00.000Z",
    }],
  }),
  ratsinformation: sealReviewedPublicKnowledgeProjection({
    schemaVersion: "reviewed_public_knowledge_projection_v1",
    municipalityId: "roebel-mueritz",
    sourceKind: "ratsinformation",
    generatedAt: "2026-08-31T18:58:00.000Z",
    records: [{
      evidenceId: `sha256:${"b".repeat(64)}`,
      municipalityId: "roebel-mueritz",
      sourceKind: "ratsinformation",
      authority: "official_record",
      title: "Einwohnerfragestunde zur Verkehrssicherheit am Abzweig Bollewick",
      summary:
        "Das Protokoll dokumentiert, was zuständige Stellen prüfen könnten; es ist kein Beschluss.",
      publishedAt: "2025-12-17T00:00:00.000Z",
      admissionState: "admitted",
      lifecycle: "current",
      body: "Öffentliches Wortprotokoll eines Bürgeranliegens ohne Maßnahmenbeschluss.",
      recordId: "Amtsausschuss-2025-12-17-Oe7",
      recordUrl:
        "https://roebelmueritz.sitzung-mv.de/public/to020?SILFDNR=1000579&TOLFDNR=1014284",
      reviewedAt: "2026-08-31T18:58:00.000Z",
    }],
  }),
} as const;

it("grounds and signs an ordinary Röbel mention across the three no-authority evidence kinds", async () => {
  const question =
    "@Mecky, Welche belegten, nicht bindenden Verbesserungsoptionen sollten Bürger und zuständige Stellen prüfen?";
  const mention = buildNoteEvent(CITIZEN, question, {
    createdAt: NOW - 5,
    tags: [
      ["p", AGENT.publicKey],
      ["source-app-post", POST_ID],
    ],
  });
  const requestedKnowledgeUrls: string[] = [];
  let civicReads = 0;
  const retrieveEvidence = createStadtstackPublicEvidenceRetriever({
    baseUrl: "https://cases.stadtstack.example",
    reviewedKnowledgeBaseUrl: "https://knowledge.roebel.example",
    municipalityId: "roebel-mueritz",
    reviewedSourceKinds: ["local_news", "ratsinformation"],
    loadReviewedCases: async (options) => {
      civicReads += 1;
      assert.equal(options.baseUrl, "https://cases.stadtstack.example");
      return { municipality: { id: "roebel-mueritz" }, cases: [] } as never;
    },
    reviewedSourceFetch: async (input, init) => {
      const requested = String(input);
      requestedKnowledgeUrls.push(requested);
      assert.equal(new URL(requested).origin, "https://knowledge.roebel.example");
      assert.equal(init?.method, "GET");
      assert.equal(init?.credentials, "omit");
      const source = requested.endsWith("/local-news")
        ? "local_news"
        : "ratsinformation";
      return Response.json(PROJECTIONS[source]);
    },
  });
  const mecky = createPublicMecky({
    retrieveEvidence,
    infer: async ({ evidence }) => {
      assert.deepEqual(
        evidence.map((entry) => [
          "sourceKind" in entry ? entry.sourceKind : "",
          "authority" in entry ? entry.authority : "",
        ]).sort(),
        [
          ["local_news", "editorial_report"],
          ["nostr_post", "community_statement"],
          ["ratsinformation", "official_record"],
        ],
      );
      return {
        answer:
          "Belegt sind prüfbare Ansatzpunkte. Das ist eine beratende Einordnung, keine Entscheidung.",
        evidenceIds: evidence.map((entry) => entry.evidenceId),
      };
    },
  });

  const published: NostrEvent[] = [];
  const result = await watchOnce({
    agent: AGENT,
    history: emptyHistory(),
    relayUrl: "ws://relay.invalid",
    now: () => NOW,
    makeClient: () => ({
      query: async (filters) => {
        const filter = filters[0] as Record<string, unknown> | undefined;
        return filter && Object.hasOwn(filter, "authors") ? [] : [mention];
      },
      publish: async (event) => {
        published.push(event);
        return { ok: true, message: "" };
      },
      close: () => {},
    }),
    think: async (_content, event) => {
      const answer = await mecky.answerMention({
        municipalityId: "roebel-mueritz",
        question: event.content,
        now: new Date(NOW * 1_000).toISOString(),
        conversationEvidence: [createDirectMentionEvidence(event, {
          municipalityId: "roebel-mueritz",
          agentPubkey: AGENT.publicKey,
          publicIndexBaseUrl: "https://index.roebel.app",
        })],
      });
      assert.equal(answer.status, "answered");
      return answer.status === "answered"
        ? createPublicMeckyEvidenceReply(answer)
        : null;
    },
  });

  assert.equal(result.answered, 1);
  assert.equal(civicReads, 1);
  assert.deepEqual(requestedKnowledgeUrls.sort(), [
    "https://knowledge.roebel.example/api/federation/v1/municipalities/roebel-mueritz/public-knowledge/local-news",
    "https://knowledge.roebel.example/api/federation/v1/municipalities/roebel-mueritz/public-knowledge/ratsinformation",
  ]);
  assert.equal(published.length, 1);
  const signedReply = published[0]!;
  assert.equal(verifyEvent(signedReply), true);
  assert.equal(signedReply.pubkey, AGENT.publicKey);
  assert.ok(signedReply.tags.some((tag) => tag.join(":") === `e:${mention.id}::reply`));
  assert.ok(signedReply.tags.some((tag) => tag.join(":") === `p:${mention.pubkey}`));
  assert.ok(signedReply.tags.some((tag) => tag.join(":") === `source-app-post:${POST_ID}`));
  assert.deepEqual(
    signedReply.tags.filter((tag) => tag[0] === "evidence").map((tag) => tag[2]).sort(),
    [
      "https://www.bahntrassenradeln.de/details/mv17a.htm",
      "https://roebelmueritz.sitzung-mv.de/public/to020?SILFDNR=1000579&TOLFDNR=1014284",
      `https://index.roebel.app/events?ids=${mention.id}`,
    ].sort(),
  );
  for (const forbidden of ["municipality", "topic", "case", "stadtstack-case", "mecky-receipt"]) {
    assert.equal(signedReply.tags.some((tag) => tag[0] === forbidden), false);
  }
});
