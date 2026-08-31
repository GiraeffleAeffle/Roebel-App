import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { describe, it } from "node:test";

import {
  buildNoteEvent,
  deriveAgentIdentity,
  deriveNostrSecretKey,
  verifyEvent,
  type NostrEvent,
} from "@netizen-labs/nostr";
import { createDirectMentionEvidence } from "../src/conversation-evidence";
import {
  createPublicMecky,
  createPublicMeckyEvidenceReply,
  createStadtstackPublicEvidenceRetriever,
} from "../src/public-mecky";
import { emptyHistory } from "../src/bounds";
import { watchOnce } from "../src/watcher";
import { parsePublicMeckyReplyProjection } from "../../../apps/expo/supabase/functions/_shared/public-mecky-reply-projection";
import { GET as getReviewedProjection } from "../../../apps/web/src/app/api/federation/v1/municipalities/[municipalityId]/public-knowledge/[source]/route";
import {
  ROEBEL_REVIEWED_PUBLIC_KNOWLEDGE,
  type RoebelReviewedSourceKind,
} from "../../../apps/web/src/lib/mecky/reviewed-public-knowledge";
import {
  mergePublicMeckyThread,
} from "../../../apps/web/src/lib/public-mecky-thread";
import { publicEvidenceDestinationLabel } from "../../../apps/web/src/lib/public-evidence-url";

const NOW = Math.floor(Date.parse("2026-08-31T00:26:00.000Z") / 1_000);
const POST_ID = "735187dc-d737-4e6c-bdd9-fe0792fec498";
const AGENT = deriveAgentIdentity(
  "roebel-live-source-tracer-agent-secret-with-enough-entropy-2026",
  "roebel",
  "mecky",
);
const CITIZEN = deriveNostrSecretKey(`0x${"73".repeat(65)}`);

function sourceKindForUrl(value: string): RoebelReviewedSourceKind {
  return value.endsWith("/local-news") ? "local_news" : "ratsinformation";
}

function canonical(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonical(record[key])}`)
    .join(",")}}`;
}

describe("normal-feed @Mecky live-source tracer", () => {
  it("serves the exact checksum-bound public projections and nothing outside Röbel", async () => {
    for (const [source, sourceKind] of [
      ["local-news", "local_news"],
      ["ratsinformation", "ratsinformation"],
    ] as const) {
      const response = await getReviewedProjection(
        new Request(`https://www.roebel.app/${source}`),
        { params: Promise.resolve({ municipalityId: "roebel-mueritz", source }) },
      );
      assert.equal(response.status, 200);
      assert.equal(response.headers.get("cache-control"), "no-store");
      assert.equal(
        response.headers.get("etag"),
        `"${ROEBEL_REVIEWED_PUBLIC_KNOWLEDGE[sourceKind].contentSha256}"`,
      );
      assert.deepEqual(
        await response.json(),
        ROEBEL_REVIEWED_PUBLIC_KNOWLEDGE[sourceKind],
      );
      const { evidenceId, ...reviewedCapture } =
        ROEBEL_REVIEWED_PUBLIC_KNOWLEDGE[sourceKind].records[0];
      assert.equal(
        evidenceId,
        `sha256:${createHash("sha256")
          .update(canonical(reviewedCapture), "utf8")
          .digest("hex")}`,
      );
    }

    const missing = await getReviewedProjection(
      new Request("https://www.roebel.app/other-town"),
      {
        params: Promise.resolve({
          municipalityId: "other-town",
          source: "local-news",
        }),
      },
    );
    assert.equal(missing.status, 404);
  });

  it("grounds, signs, projects and renders one ordinary mention with exact source provenance", async () => {
    const question =
      "@Mecky Was belegen Müritz Tipp und das Ratsinformationssystem zum Haushalt 2026 der Stadt Röbel/Müritz?";
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
      baseUrl: "https://roebel-stadtstack.agentcart.eu",
      reviewedKnowledgeBaseUrl: "https://www.roebel.app",
      municipalityId: "roebel-mueritz",
      reviewedSourceKinds: ["local_news", "ratsinformation"],
      loadReviewedCases: async (options) => {
        civicReads += 1;
        assert.equal(options.baseUrl, "https://roebel-stadtstack.agentcart.eu");
        return {
          municipality: { id: "roebel-mueritz" },
          cases: [],
        } as never;
      },
      reviewedSourceFetch: async (input, init) => {
        const requested = String(input);
        requestedKnowledgeUrls.push(requested);
        assert.equal(new URL(requested).origin, "https://www.roebel.app");
        assert.equal(init?.method, "GET");
        assert.equal(init?.credentials, "omit");
        return Response.json(
          ROEBEL_REVIEWED_PUBLIC_KNOWLEDGE[sourceKindForUrl(requested)],
        );
      },
    });
    const mecky = createPublicMecky({
      retrieveEvidence,
      infer: async ({ evidence }) => {
        const sourceAuthorities = evidence.map((entry) => {
          assert.equal("sourceKind" in entry, true);
          return [
            "sourceKind" in entry ? entry.sourceKind : "",
            "authority" in entry ? entry.authority : "",
          ];
        });
        assert.deepEqual(sourceAuthorities.sort(), [
          ["local_news", "editorial_report"],
          ["nostr_post", "community_statement"],
          ["ratsinformation", "official_record"],
        ]);
        return {
          answer:
            "Der Bericht und die öffentliche ALLRIS-Vorlage stimmen darin überein, dass der Haushalt 2026 beschlossen wurde. Der erwähnende Beitrag ist nur die zugeordnete Bürgerfrage, keine amtliche Feststellung.",
          evidenceIds: evidence.map((entry) => entry.evidenceId),
        };
      },
    });

    const published: NostrEvent[] = [];
    const projected: ReturnType<typeof parsePublicMeckyReplyProjection>[] = [];
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
        const conversationEvidence = createDirectMentionEvidence(event, {
          municipalityId: "roebel-mueritz",
          agentPubkey: AGENT.publicKey,
          publicIndexBaseUrl: "https://index.roebel.app",
        });
        const answer = await mecky.answerMention({
          municipalityId: "roebel-mueritz",
          question: event.content,
          now: new Date(NOW * 1_000).toISOString(),
          conversationEvidence: [conversationEvidence],
        });
        assert.equal(answer.status, "answered");
        if (answer.status !== "answered") return null;
        return createPublicMeckyEvidenceReply(answer);
      },
      projectReply: async (event) => {
        projected.push(parsePublicMeckyReplyProjection(event, {
          expectedPubkey: AGENT.publicKey,
          verifyEvent,
        }));
      },
    });

    assert.equal(result.answered, 1);
    assert.equal(result.projected, 1);
    assert.equal(civicReads, 1);
    assert.deepEqual(requestedKnowledgeUrls.sort(), [
      "https://www.roebel.app/api/federation/v1/municipalities/roebel-mueritz/public-knowledge/local-news",
      "https://www.roebel.app/api/federation/v1/municipalities/roebel-mueritz/public-knowledge/ratsinformation",
    ]);
    assert.equal(published.length, 1);
    const signedReply = published[0]!;
    assert.equal(verifyEvent(signedReply), true);
    assert.equal(signedReply.pubkey, AGENT.publicKey);
    assert.ok(signedReply.tags.some((tag) => tag.join(":") === `e:${mention.id}::reply`));
    assert.ok(signedReply.tags.some((tag) => tag.join(":") === `p:${mention.pubkey}`));
    assert.ok(signedReply.tags.some((tag) => tag.join(":") === `source-app-post:${POST_ID}`));
    for (const forbidden of [
      "municipality",
      "topic",
      "case",
      "stadtstack-case",
      "mecky-receipt",
    ]) {
      assert.equal(signedReply.tags.some((tag) => tag[0] === forbidden), false);
    }

    assert.equal(projected.length, 1);
    const projectedReply = projected[0]!;
    assert.equal(projectedReply.authority_binding, "none");
    assert.deepEqual(projectedReply.signed_event, signedReply);
    const expectedUrls = [
      ROEBEL_REVIEWED_PUBLIC_KNOWLEDGE.local_news.records[0].articleUrl,
      ROEBEL_REVIEWED_PUBLIC_KNOWLEDGE.ratsinformation.records[0].recordUrl,
      `https://index.roebel.app/events?ids=${mention.id}`,
    ].sort();
    assert.deepEqual(
      projectedReply.evidence_refs.map((entry) => entry.url).sort(),
      expectedUrls,
    );

    const comments = mergePublicMeckyThread({
      humanComments: [],
      projectedRows: [projectedReply],
      postId: POST_ID,
      offset: 0,
      limit: 20,
    });
    assert.equal(comments.length, 1);
    assert.deepEqual(
      comments[0]?.agent?.evidenceRefs.map((entry) => entry.url).sort(),
      expectedUrls,
    );
    assert.deepEqual(
      comments[0]?.agent?.evidenceRefs
        .map((entry) => publicEvidenceDestinationLabel(entry.url))
        .sort(),
      [
        "index.roebel.app",
        "ol.wittich.de",
        "roebelmueritz.sitzung-mv.de",
      ],
    );
  });
});
