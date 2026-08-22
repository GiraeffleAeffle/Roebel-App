import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  createReviewedPublicKnowledgeSourceAdapter,
  parseReviewedPublicKnowledgeSourceKinds,
  ReviewedPublicKnowledgeError,
  sealReviewedPublicKnowledgeProjection,
  type ReviewedPublicKnowledgeProjection,
} from "../src/reviewed-public-knowledge";
import {
  createPublicKnowledgeCatalog,
  type LocalNewsEvidence,
  type RatsinformationEvidence,
} from "../src/public-evidence";

const id = (digit: string) => `sha256:${digit.repeat(64)}` as const;
const QUERY = {
  municipalityId: "roebel-mueritz",
  question: "Was ist zur Marienfelder Straße belegt?",
  now: "2026-08-22T12:00:00.000Z",
} as const;

const news = (overrides: Partial<LocalNewsEvidence> = {}): LocalNewsEvidence => ({
  evidenceId: id("a"),
  municipalityId: "roebel-mueritz",
  sourceKind: "local_news",
  authority: "editorial_report",
  title: "Bericht zur Marienfelder Straße",
  summary: "Die Redaktion berichtet über Vorschläge für eine sicherere Querung.",
  publishedAt: "2026-08-20T08:00:00.000Z",
  admissionState: "admitted",
  lifecycle: "current",
  publisher: "Röbel Kurier",
  articleUrl: "https://news.example/roebel/marienfelder-strasse",
  reviewedAt: "2026-08-21T09:00:00.000Z",
  ...overrides,
});

const ris = (overrides: Partial<RatsinformationEvidence> = {}): RatsinformationEvidence => ({
  evidenceId: id("b"),
  municipalityId: "roebel-mueritz",
  sourceKind: "ratsinformation",
  authority: "official_record",
  title: "Ausschussvorlage zur Marienfelder Straße",
  summary: "Die Vorlage dokumentiert einen Prüfauftrag zur Querung.",
  publishedAt: "2026-08-19T08:00:00.000Z",
  admissionState: "admitted",
  lifecycle: "current",
  body: "Beratungsgegenstand ist die Prüfung einer sicheren Querung.",
  recordId: "RIS-2026-42",
  recordUrl: "https://ris.example/roebel/vorlagen/2026-42",
  reviewedAt: "2026-08-21T10:00:00.000Z",
  ...overrides,
});

function projectionResponse(projection: ReviewedPublicKnowledgeProjection): Response {
  return new Response(JSON.stringify(projection), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

describe("reviewed public knowledge projection", () => {
  it("parses only the canonical explicit runtime source declaration", () => {
    assert.deepEqual(parseReviewedPublicKnowledgeSourceKinds(undefined), []);
    assert.deepEqual(parseReviewedPublicKnowledgeSourceKinds(""), []);
    assert.deepEqual(parseReviewedPublicKnowledgeSourceKinds("local_news"), ["local_news"]);
    assert.deepEqual(parseReviewedPublicKnowledgeSourceKinds("ratsinformation"), ["ratsinformation"]);
    assert.deepEqual(
      parseReviewedPublicKnowledgeSourceKinds("local_news,ratsinformation"),
      ["local_news", "ratsinformation"],
    );
    for (const invalid of [
      "local_news,local_news",
      "ratsinformation,local_news",
      "raw_news",
      " local_news",
      "local_news,",
    ]) {
      assert.throws(() => parseReviewedPublicKnowledgeSourceKinds(invalid));
    }
  });

  it("loads a sealed source-specific projection over one credential-free GET", async () => {
    const projection = sealReviewedPublicKnowledgeProjection({
      schemaVersion: "reviewed_public_knowledge_projection_v1",
      municipalityId: "roebel-mueritz",
      sourceKind: "local_news",
      generatedAt: "2026-08-22T11:00:00.000Z",
      records: [news()],
    });
    const requests: Array<{ url: string; init?: RequestInit }> = [];
    const adapter = createReviewedPublicKnowledgeSourceAdapter({
      baseUrl: "https://stadtstack.example",
      sourceKind: "local_news",
      fetch: async (input, init) => {
        requests.push({ url: String(input), init });
        return projectionResponse(projection);
      },
    });

    assert.deepEqual(await adapter.load(QUERY), [news()]);
    assert.equal(requests.length, 1);
    assert.equal(
      requests[0].url,
      "https://stadtstack.example/api/federation/v1/municipalities/roebel-mueritz/public-knowledge/local-news",
    );
    assert.deepEqual(requests[0].init, {
      method: "GET",
      headers: { Accept: "application/json" },
      credentials: "omit",
      redirect: "error",
      cache: "no-store",
      referrerPolicy: "no-referrer",
      signal: requests[0].init?.signal,
    });
    assert.ok(requests[0].init?.signal instanceof AbortSignal);
    assert.equal(Object.hasOwn(requests[0].init?.headers as object, "Authorization"), false);
  });

  it("isolates the sealed record snapshot from later producer mutations", () => {
    const mutable = { ...news() };
    const projection = sealReviewedPublicKnowledgeProjection({
      schemaVersion: "reviewed_public_knowledge_projection_v1",
      municipalityId: "roebel-mueritz",
      sourceKind: "local_news",
      generatedAt: "2026-08-22T11:00:00.000Z",
      records: [mutable],
    });
    mutable.title = "Changed after sealing";
    assert.equal(projection.records[0].title, "Bericht zur Marienfelder Straße");
    assert.ok(Object.isFrozen(projection.records[0]));
  });

  it("composes reviewed news and council records without flattening authority", async () => {
    const newsProjection = sealReviewedPublicKnowledgeProjection({
      schemaVersion: "reviewed_public_knowledge_projection_v1",
      municipalityId: "roebel-mueritz",
      sourceKind: "local_news",
      generatedAt: "2026-08-22T11:00:00.000Z",
      records: [news()],
    });
    const risProjection = sealReviewedPublicKnowledgeProjection({
      schemaVersion: "reviewed_public_knowledge_projection_v1",
      municipalityId: "roebel-mueritz",
      sourceKind: "ratsinformation",
      generatedAt: "2026-08-22T11:00:00.000Z",
      records: [ris()],
    });
    const catalog = createPublicKnowledgeCatalog([
      createReviewedPublicKnowledgeSourceAdapter({
        baseUrl: "https://stadtstack.example",
        sourceKind: "local_news",
        fetch: async () => projectionResponse(newsProjection),
      }),
      createReviewedPublicKnowledgeSourceAdapter({
        baseUrl: "https://stadtstack.example",
        sourceKind: "ratsinformation",
        fetch: async () => projectionResponse(risProjection),
      }),
    ]);

    const packet = await catalog.retrieve(QUERY);
    assert.deepEqual(packet.passages.map(({ evidence }) => [
      evidence.sourceKind,
      evidence.authority,
    ]), [
      ["ratsinformation", "official_record"],
      ["local_news", "editorial_report"],
    ]);
  });

  it("rejects checksum drift and unknown envelope fields", async () => {
    const valid = sealReviewedPublicKnowledgeProjection({
      schemaVersion: "reviewed_public_knowledge_projection_v1",
      municipalityId: "roebel-mueritz",
      sourceKind: "ratsinformation",
      generatedAt: "2026-08-22T11:00:00.000Z",
      records: [ris()],
    });
    const values = [
      { ...valid, records: [{ ...ris(), title: "Manipulierte Überschrift" }] },
      { ...valid, unexpectedAuthority: "formal_decision" },
    ];
    for (const value of values) {
      const adapter = createReviewedPublicKnowledgeSourceAdapter({
        baseUrl: "https://stadtstack.example",
        sourceKind: "ratsinformation",
        fetch: async () => projectionResponse(value as ReviewedPublicKnowledgeProjection),
      });
      await assert.rejects(() => adapter.load(QUERY), ReviewedPublicKnowledgeError);
    }
  });

  it("rejects pending review, cross-town records, future review, and duplicate source identity", () => {
    const invalidRecords: readonly RatsinformationEvidence[][] = [
      [ris({ admissionState: "pending_review" })],
      [ris({ municipalityId: "malchow" })],
      [ris({ reviewedAt: "2026-08-23T10:00:00.000Z" })],
      [ris(), ris({ evidenceId: id("c") })],
    ];
    for (const records of invalidRecords) {
      assert.throws(() => sealReviewedPublicKnowledgeProjection({
        schemaVersion: "reviewed_public_knowledge_projection_v1",
        municipalityId: "roebel-mueritz",
        sourceKind: "ratsinformation",
        generatedAt: "2026-08-22T11:00:00.000Z",
        records,
      }), ReviewedPublicKnowledgeError);
    }
  });

  it("preserves correction state so withdrawn records are omitted before ranking", async () => {
    const projection = sealReviewedPublicKnowledgeProjection({
      schemaVersion: "reviewed_public_knowledge_projection_v1",
      municipalityId: "roebel-mueritz",
      sourceKind: "local_news",
      generatedAt: "2026-08-22T11:00:00.000Z",
      records: [news({ lifecycle: "withdrawn" })],
    });
    const catalog = createPublicKnowledgeCatalog([
      createReviewedPublicKnowledgeSourceAdapter({
        baseUrl: "https://stadtstack.example",
        sourceKind: "local_news",
        fetch: async () => projectionResponse(projection),
      }),
    ]);
    const packet = await catalog.retrieve(QUERY);
    assert.deepEqual(packet.passages, []);
    assert.deepEqual(packet.omissions, [
      { sourceKind: "local_news", reason: "withdrawn", count: 1 },
    ]);
  });

  it("fails the entire source on cross-kind, duplicate evidence, or projection clock drift", async () => {
    const valid = sealReviewedPublicKnowledgeProjection({
      schemaVersion: "reviewed_public_knowledge_projection_v1",
      municipalityId: "roebel-mueritz",
      sourceKind: "local_news",
      generatedAt: "2026-08-22T11:00:00.000Z",
      records: [news()],
    });
    const forged = [
      { ...valid, sourceKind: "ratsinformation" },
      { ...valid, records: [news(), news()] },
      sealReviewedPublicKnowledgeProjection({
        schemaVersion: "reviewed_public_knowledge_projection_v1",
        municipalityId: "roebel-mueritz",
        sourceKind: "local_news",
        generatedAt: "2026-08-23T11:00:00.000Z",
        records: [news()],
      }),
    ];
    for (const value of forged) {
      const adapter = createReviewedPublicKnowledgeSourceAdapter({
        baseUrl: "https://stadtstack.example",
        sourceKind: "local_news",
        fetch: async () => projectionResponse(value as ReviewedPublicKnowledgeProjection),
      });
      await assert.rejects(() => adapter.load(QUERY), ReviewedPublicKnowledgeError);
    }
  });

  it("rejects redirects, non-JSON, oversized bodies, unsafe origins, and unbounded limits", async () => {
    const base = {
      baseUrl: "https://stadtstack.example",
      sourceKind: "local_news" as const,
    };
    const responses = [
      new Response("{}", { status: 200, headers: { "content-type": "text/html" } }),
      new Response("{}", { status: 200, headers: {
        "content-type": "application/json",
        "content-length": "2048",
      } }),
    ];
    for (const response of responses) {
      const adapter = createReviewedPublicKnowledgeSourceAdapter({
        ...base,
        maxResponseBytes: 1_024,
        fetch: async () => response,
      });
      await assert.rejects(() => adapter.load(QUERY), ReviewedPublicKnowledgeError);
    }
    const redirected = new Response("{}", {
      status: 200,
      headers: { "content-type": "application/json" },
    });
    Object.defineProperty(redirected, "redirected", { value: true });
    const redirectAdapter = createReviewedPublicKnowledgeSourceAdapter({
      ...base,
      fetch: async () => redirected,
    });
    await assert.rejects(() => redirectAdapter.load(QUERY), (error) =>
      error instanceof ReviewedPublicKnowledgeError && error.code === "unsafe_url");
    assert.throws(() => createReviewedPublicKnowledgeSourceAdapter({
      ...base,
      baseUrl: "http://stadtstack.example",
    }), ReviewedPublicKnowledgeError);
    assert.throws(() => createReviewedPublicKnowledgeSourceAdapter({
      ...base,
      baseUrl: "https://user:secret@stadtstack.example",
    }), ReviewedPublicKnowledgeError);
    assert.throws(() => createReviewedPublicKnowledgeSourceAdapter({
      ...base,
      maxRecords: 101,
    }), ReviewedPublicKnowledgeError);
  });

  it("aborts a source that exceeds its bounded deadline", async () => {
    let aborted = false;
    const adapter = createReviewedPublicKnowledgeSourceAdapter({
      baseUrl: "https://stadtstack.example",
      sourceKind: "local_news",
      timeoutMs: 100,
      fetch: async (_input, init) => new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => {
          aborted = true;
          reject(new DOMException("aborted", "AbortError"));
        });
      }),
    });
    await assert.rejects(() => adapter.load(QUERY), (error) =>
      error instanceof ReviewedPublicKnowledgeError && error.code === "timeout");
    assert.equal(aborted, true);
  });

  it("allows an explicitly opted-in exact cluster Service origin", async () => {
    const projection = sealReviewedPublicKnowledgeProjection({
      schemaVersion: "reviewed_public_knowledge_projection_v1",
      municipalityId: "roebel-mueritz",
      sourceKind: "local_news",
      generatedAt: "2026-08-22T11:00:00.000Z",
      records: [],
    });
    let requested = "";
    const adapter = createReviewedPublicKnowledgeSourceAdapter({
      baseUrl: "http://stadtstack-public.stadtstack.svc.cluster.local",
      allowClusterInternalHttp: true,
      sourceKind: "local_news",
      fetch: async (input) => {
        requested = String(input);
        return projectionResponse(projection);
      },
    });
    assert.deepEqual(await adapter.load(QUERY), []);
    assert.equal(
      requested,
      "http://stadtstack-public.stadtstack.svc.cluster.local/api/federation/v1/municipalities/roebel-mueritz/public-knowledge/local-news",
    );
  });
});
