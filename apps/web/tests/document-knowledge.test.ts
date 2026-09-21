import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rename, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { it } from "node:test";
import { GET } from "../src/app/api/federation/v1/municipalities/[municipalityId]/public-knowledge/[source]/route";
import { readDocumentKnowledge } from "../src/lib/mecky/document-knowledge";
import { createPublicKnowledgeCatalog } from "../../../packages/agent-watcher/src/public-evidence";
import { createReviewedPublicKnowledgeSourceAdapter } from "../../../packages/agent-watcher/src/reviewed-public-knowledge";
import { documentEdition, documentSection, DOCUMENT_NOW } from "../../../packages/agent-watcher/test/fixtures/community-document";

it("serves maintained document pages and gives fresh citations after correction, withdrawal and source failure", async () => {
  const directory = await mkdtemp(join(tmpdir(), "roebel-documents-"));
  const before = process.env.ROEBEL_PUBLIC_KNOWLEDGE_DIRECTORY;
  process.env.ROEBEL_PUBLIC_KNOWLEDGE_DIRECTORY = directory;
  const path = join(directory, "example-city", "community-documents.json");
  const source = documentSection();
  const sectionTwo = documentSection({ sectionId: "empfehlung-2", title: "Leerstand", summary: "Zwischennutzung von Leerstand ermöglichen.", printedPageLabel: "21–22", pageEnd: 12 });
  const get = (kind = "community-documents") => GET(new Request("https://app.example/"), {
    params: Promise.resolve({ municipalityId: "example-city", source: kind }),
  });
  const reader = createPublicKnowledgeCatalog([createReviewedPublicKnowledgeSourceAdapter({
    baseUrl: "https://app.example", sourceKind: "community_document", fetch: async () => get(),
  })]);
  const query = () => reader.retrieve({ municipalityId: "example-city", question: "Begegnungsort", now: DOCUMENT_NOW });
  const page = (version = source.evidenceId.slice(7)) => readDocumentKnowledge("example-city", "buergerrat-2026", "empfehlung-1", version);
  const replace = async (value: unknown) => { await writeFile(`${path}.next`, JSON.stringify(value)); await rename(`${path}.next`, path); };
  try {
    await mkdir(join(directory, "example-city"));
    await replace(documentEdition([source, sectionTwo]));
    const response = await get();
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.equal(response.headers.get("etag"), `"${documentEdition([source, sectionTwo]).contentSha256}"`);
    const result = await page();
    assert.equal(result.status, "current");
    if (result.status !== "current") throw new Error(result.status);
    assert.deepEqual(result.sections.map((record) => record.sectionId), ["empfehlung-1", "empfehlung-2"]);
    assert.equal(result.record.publishedAt, null);
    assert.equal((await query()).passages[0].evidence.evidenceId, source.evidenceId);

    const correction = documentSection({ summary: "Der Bürgerrat empfiehlt einen Begegnungsort mit Zugang am Abend." });
    await replace(documentEdition([correction, sectionTwo]));
    assert.deepEqual(await page(), { status: "changed", title: source.title, currentUrl: correction.recordUrl });
    assert.equal((await page(correction.evidenceId.slice(7))).status, "current");
    assert.equal((await query()).passages[0].evidence.evidenceId, correction.evidenceId);

    await replace(documentEdition([documentSection({ lifecycle: "withdrawn" }), sectionTwo]));
    assert.equal((await page()).status, "withdrawn");
    assert.equal((await query()).passages.length, 0);
    await replace(documentEdition([]));
    assert.equal((await page()).status, "not_found");
    await writeFile(path, "broken edition");
    assert.equal((await page()).status, "unavailable");
    assert.equal((await get()).status, 503);
    assert.equal((await query()).passages.length, 0);
    assert.equal((await readDocumentKnowledge("../private", "buergerrat-2026", "empfehlung-1")).status, "not_found");
    assert.equal((await page("untrusted-version")).status, "not_found");
  } finally {
    if (before === undefined) delete process.env.ROEBEL_PUBLIC_KNOWLEDGE_DIRECTORY;
    else process.env.ROEBEL_PUBLIC_KNOWLEDGE_DIRECTORY = before;
    await rm(directory, { recursive: true, force: true });
  }
});
