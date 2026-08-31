import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { describe, it } from "node:test";

import { GET } from "../src/app/api/federation/v1/municipalities/[municipalityId]/public-knowledge/[source]/route";
import { ROEBEL_REVIEWED_PUBLIC_KNOWLEDGE } from "../src/lib/mecky/reviewed-public-knowledge";
import { createPublicKnowledgeCatalog } from "../../../packages/agent-watcher/src/public-evidence";
import { createReviewedPublicKnowledgeSourceAdapter } from "../../../packages/agent-watcher/src/reviewed-public-knowledge";

function canonicalJson(value: unknown): string {
  if (value === null || typeof value === "string" || typeof value === "boolean") {
    return JSON.stringify(value);
  }
  if (typeof value === "number") return JSON.stringify(value);
  if (Array.isArray(value)) {
    return `[${value.map((entry) => canonicalJson(entry)).join(",")}]`;
  }
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
    .join(",")}}`;
}

function projectionDigest(projection: { contentSha256: string }) {
  const { contentSha256: _contentSha256, ...draft } = projection;
  return `sha256:${createHash("sha256").update(canonicalJson(draft), "utf8").digest("hex")}`;
}

describe("Röbel reviewed Radweg evidence projection", () => {
  it("publishes source-specific facts and keeps every authority boundary explicit", () => {
    const news = ROEBEL_REVIEWED_PUBLIC_KNOWLEDGE.local_news.records[0];
    const ris = ROEBEL_REVIEWED_PUBLIC_KNOWLEDGE.ratsinformation.records[0];

    assert.equal(news.authority, "editorial_report");
    assert.equal(news.publisher, "Bahntrassenradeln — Achim Bartoschek");
    assert.equal(news.articleUrl, "https://www.bahntrassenradeln.de/details/mv17a.htm");
    assert.match(news.summary, /4,6 km/);
    assert.match(news.summary, /weitere 15 km bis Röbel als geplant/);
    assert.match(news.summary, /keine beschlossene weitere Maßnahme/);

    assert.equal(ris.authority, "official_record");
    assert.equal(ris.recordId, "Amtsausschuss-2025-12-17-Oe7");
    assert.equal(
      ris.recordUrl,
      "https://roebelmueritz.sitzung-mv.de/public/to020?SILFDNR=1000579&TOLFDNR=1014284",
    );
    assert.match(ris.summary, /B 198/);
    assert.match(ris.summary, /zur Weitergabe mit/);
    assert.match(ris.summary, /kein Beschluss/);

    for (const projection of Object.values(ROEBEL_REVIEWED_PUBLIC_KNOWLEDGE)) {
      assert.equal(projection.contentSha256, projectionDigest(projection));
      assert.equal(projection.municipalityId, "roebel-mueritz");
      assert.ok(projection.records.every((record) =>
        record.admissionState === "admitted" && record.lifecycle === "current"
      ));
      assert.ok(projection.records.every((record) => !JSON.stringify(record).includes("example.invalid")));
    }
  });

  it("serves only the two credential-free, checksum-bound municipality routes", async () => {
    const response = await GET(new Request("https://roebel.example/ignored"), {
      params: Promise.resolve({
        municipalityId: "roebel-mueritz",
        source: "ratsinformation",
      }),
    });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.equal(
      response.headers.get("etag"),
      `\"${ROEBEL_REVIEWED_PUBLIC_KNOWLEDGE.ratsinformation.contentSha256}\"`,
    );

    const notFound = await GET(new Request("https://roebel.example/ignored"), {
      params: Promise.resolve({ municipalityId: "another-city", source: "local-news" }),
    });
    assert.equal(notFound.status, 404);
  });

  it("retrieves both records for the immutable live discussion question", async () => {
    const fetchProjection: typeof fetch = async (input) => {
      const source = String(input).endsWith("/local-news")
        ? "local_news"
        : "ratsinformation";
      return Response.json(ROEBEL_REVIEWED_PUBLIC_KNOWLEDGE[source]);
    };
    const catalog = createPublicKnowledgeCatalog([
      createReviewedPublicKnowledgeSourceAdapter({
        baseUrl: "https://roebel.example",
        sourceKind: "local_news",
        fetch: fetchProjection,
      }),
      createReviewedPublicKnowledgeSourceAdapter({
        baseUrl: "https://roebel.example",
        sourceKind: "ratsinformation",
        fetch: fetchProjection,
      }),
    ]);

    const packet = await catalog.retrieve({
      municipalityId: "roebel-mueritz",
      question:
        "@Mecky, Welche belegten, nicht bindenden Verbesserungsoptionen sollten Bürger und zuständige Stellen prüfen?",
      now: "2026-08-31T19:00:00.000Z",
    });

    assert.deepEqual(packet.passages.map(({ evidence }) => evidence.sourceKind).sort(), [
      "local_news",
      "ratsinformation",
    ]);
    assert.ok(packet.passages.every(({ evidence }) =>
      evidence.authority === "official_record" || evidence.authority === "editorial_report"
    ));
  });
});
