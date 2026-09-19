import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { sealReviewedPublicKnowledgeProjection, type ReviewedPublicKnowledgeRecord } from "@roebel/stadtstack-federation-client/reviewed-public-knowledge";
import { GET } from "../src/app/api/federation/v1/municipalities/[municipalityId]/public-knowledge/[source]/route";
import { ROEBEL_REVIEWED_PUBLIC_KNOWLEDGE } from "../src/lib/mecky/reviewed-public-knowledge";
import { PUBLIC_KNOWLEDGE_FILE_MAX_BYTES } from "../src/lib/mecky/public-knowledge-file";
import { createPublicKnowledgeCatalog } from "../../../packages/agent-watcher/src/public-evidence";
import { createReviewedPublicKnowledgeSourceAdapter } from "../../../packages/agent-watcher/src/reviewed-public-knowledge";

const MUNICIPALITY = "roebel-mueritz";
const NOW = "2026-09-19T12:00:00.000Z";
const base = ROEBEL_REVIEWED_PUBLIC_KNOWLEDGE.ratsinformation;
const original = base.records[0];
const additional = {
  ...original,
  evidenceId: `sha256:${"a".repeat(64)}` as const,
  recordId: "library-opening-hours",
  recordUrl: "https://ris.example/library-opening-hours",
  title: "Bibliothek: Öffnungszeiten",
  summary: "Die Bibliothek öffnet dienstags bis 18 Uhr.",
  body: "TOP 4: Bibliothek und Öffnungszeiten.",
};

async function get(source = "ratsinformation", municipalityId = MUNICIPALITY) {
  return GET(new Request("https://roebel.example/"), {
    params: Promise.resolve({ municipalityId, source }),
  });
}

const catalog = () => createPublicKnowledgeCatalog([
  createReviewedPublicKnowledgeSourceAdapter({
    baseUrl: "https://roebel.example",
    sourceKind: "ratsinformation",
    fetch: async () => get(),
  }),
]);
const query = (question = "Wann öffnet die Bibliothek?") => ({
  municipalityId: MUNICIPALITY, now: NOW, question,
});

async function withDirectory(run: (path: string, directory: string) => Promise<void>) {
  const directory = await mkdtemp(join(tmpdir(), "roebel-public-knowledge-"));
  const previous = process.env.ROEBEL_PUBLIC_KNOWLEDGE_DIRECTORY;
  process.env.ROEBEL_PUBLIC_KNOWLEDGE_DIRECTORY = directory;
  try {
    await mkdir(join(directory, MUNICIPALITY));
    await run(join(directory, MUNICIPALITY, "ratsinformation.json"), directory);
  } finally {
    if (previous === undefined) delete process.env.ROEBEL_PUBLIC_KNOWLEDGE_DIRECTORY;
    else process.env.ROEBEL_PUBLIC_KNOWLEDGE_DIRECTORY = previous;
    await rm(directory, { recursive: true, force: true });
  }
}

async function replace(path: string, value: unknown) {
  await writeFile(`${path}.next`, JSON.stringify(value));
  await rename(`${path}.next`, path);
}

function edition(records: readonly ReviewedPublicKnowledgeRecord[]) {
  const { contentSha256: _digest, ...draft } = base;
  return sealReviewedPublicKnowledgeProjection({ ...draft, records });
}

describe("maintained public knowledge through the served catalogue", () => {
  it("discovers a newly added topic and its correction without rebuilding or restarting", async () => {
    await withDirectory(async (path) => {
      await replace(path, base);
      const reader = catalog();
      assert.equal((await reader.retrieve(query())).passages.length, 0);

      await replace(path, edition([original, additional]));
      const added = await reader.retrieve(query());
      assert.deepEqual(added.passages.map(({ evidence }) => evidence.evidenceId), [additional.evidenceId]);
      assert.equal(added.passages[0].prompt.summary, additional.summary);

      const corrected = { ...additional, evidenceId: `sha256:${"b".repeat(64)}` as const,
        summary: "Die Bibliothek öffnet dienstags bis 19 Uhr." };
      await replace(path, edition([original, corrected]));
      const updated = await reader.retrieve(query());
      assert.equal(updated.passages[0].evidence.evidenceId, corrected.evidenceId);
      assert.equal(updated.passages[0].prompt.summary, corrected.summary);
      assert.notEqual(updated.packetId, added.packetId);
      const response = await get();
      assert.equal(response.headers.get("etag"), `"${edition([original, corrected]).contentSha256}"`);
    });
  });

  it("withdraws a previously retrieved source on the next request without bundled fallback", async () => {
    await withDirectory(async (path) => {
      const reader = catalog();
      await replace(path, base);
      assert.equal((await reader.retrieve(query("Verkehrssicherheit B 198"))).passages.length, 1);
      await replace(path, edition([{ ...original, lifecycle: "withdrawn" }]));
      const withdrawn = await reader.retrieve(query("Verkehrssicherheit B 198"));
      assert.equal(withdrawn.passages.length, 0);
      assert.deepEqual(withdrawn.omissions, [{ sourceKind: "ratsinformation", reason: "withdrawn", count: 1 }]);
      await rm(path);
      const unavailable = await reader.retrieve(query("Verkehrssicherheit B 198"));
      assert.equal(unavailable.passages.length, 0);
      assert.deepEqual(unavailable.omissions, [{ sourceKind: "ratsinformation", reason: "source_unavailable", count: 1 }]);
    });
  });

  it("rejects a whole invalid snapshot and does not expose unknown fields or source paths", async () => {
    await withDirectory(async (path) => {
      const privateText = "internal private review notes";
      const bad = [
        { ...base, privateNotes: privateText },
        { ...base, records: [{ ...original, privateNotes: privateText }] },
        { ...base, municipalityId: "another-city" },
        { ...base, sourceKind: "local_news" },
        { ...base, contentSha256: `sha256:${"0".repeat(64)}` },
        { ...base, records: [{ ...original, admissionState: "pending_review" }] },
        { ...base, records: [original, original] },
        { ...base, generatedAt: "2999-01-01T00:00:00.000Z" },
      ];
      for (const value of bad) {
        await replace(path, value);
        const response = await get();
        assert.equal(response.status, 503);
        assert.equal(response.headers.get("cache-control"), "no-store");
        assert.deepEqual(await response.json(), { error: "source_unavailable" });
      }
    });
  });

  it("bounds file reads and refuses invalid JSON, encoding and non-files", async () => {
    await withDirectory(async (path) => {
      for (const content of ["{", Buffer.from([0xff, 0xfe]), " ".repeat(PUBLIC_KNOWLEDGE_FILE_MAX_BYTES + 1)]) {
        await writeFile(path, content);
        assert.equal((await get()).status, 503);
      }
      await rm(path);
      await mkdir(path);
      assert.equal((await get()).status, 503);
    });
  });

  it("keeps source outages independent and rejects path traversal before reading", async () => {
    await withDirectory(async (path, directory) => {
      await replace(path, base);
      assert.equal((await get()).status, 200);
      assert.equal((await get("local-news")).status, 503);
      for (const municipality of ["../roebel-mueritz", "roebel-mueritz/../../private", "", "x".repeat(81)]) {
        assert.equal((await get("ratsinformation", municipality)).status, 404);
      }
      assert.equal((await get("../private")).status, 404);
      process.env.ROEBEL_PUBLIC_KNOWLEDGE_DIRECTORY = "relative/path";
      assert.equal((await get()).status, 503);
      process.env.ROEBEL_PUBLIC_KNOWLEDGE_DIRECTORY = directory;
    });
  });

  it("prepares a reader-compatible edition without overwriting a prior file or admitting a pending record", async () => {
    await withDirectory(async (path, directory) => {
      const input = join(directory, "draft.json");
      const { contentSha256: _digest, ...draft } = base;
      await writeFile(input, JSON.stringify(draft));
      const prepare = () => spawnSync(process.execPath, [
        "--import", "tsx",
        fileURLToPath(new URL("../scripts/prepare-public-knowledge.ts", import.meta.url)),
        input, path,
      ], { encoding: "utf8" });
      const result = prepare();
      assert.equal(result.status, 0, result.stderr);
      assert.equal(JSON.parse(result.stdout).contentSha256, base.contentSha256);
      assert.deepEqual(await (await get()).json(), base);
      const before = await readFile(path, "utf8");
      assert.notEqual(prepare().status, 0);
      assert.equal(await readFile(path, "utf8"), before);
      await rm(path);
      await writeFile(input, JSON.stringify({ ...draft, records: [{ ...original, admissionState: "pending_review" }] }));
      assert.notEqual(prepare().status, 0);
      assert.equal((await get()).status, 503);
    });
  });
});
