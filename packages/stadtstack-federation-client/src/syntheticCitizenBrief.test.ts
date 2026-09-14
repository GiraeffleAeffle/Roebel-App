import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import { verifySyntheticCitizenBrief, readSyntheticBriefResponse } from "./syntheticCitizenBrief";

const { returned } = JSON.parse(readFileSync(new URL("./fixtures/synthetic-citizen-brief-return-v1.json", import.meta.url), "utf8"));
function canonical(value: any): any {
  return Array.isArray(value) ? value.map(canonical) : value && typeof value === "object"
    ? Object.fromEntries(Object.keys(value).sort().map(k => [k, canonical(value[k])])) : value;
}
function seal(value: any) {
  const { returnChecksum: _, ...body } = value;
  return { ...body, returnChecksum: `sha256:${createHash("sha256").update(JSON.stringify(canonical(body))).digest("hex")}` };
}

test("the coordinator's exact public fixture verifies in browser-safe code", async () => {
  assert.deepEqual(await verifySyntheticCitizenBrief(returned, returned), returned);
  assert.deepEqual(await readSyntheticBriefResponse(Response.json(returned), returned), returned);
});

test("changed or private data, municipal relabelling and wrong origins cannot be admitted", async () => {
  const invalid = [
    { ...returned, status: "not_ready" },
    { ...returned, caseId: returned.caseId.replace(":synthetic-case:", ":case:") },
    { ...returned, testOnly: false },
    { ...returned, journalHeadChecksum: "private-canary" },
    { ...returned, brief: { ...returned.brief, summary: "An invented approval" } },
    { ...returned, brief: { ...returned.brief, privateEvidenceRefs: ["private-canary"] } },
    { ...returned, brief: { ...returned.brief, responses: returned.brief.responses.slice(0, 7) } },
  ];
  for (const value of invalid) await assert.rejects(verifySyntheticCitizenBrief(seal(value), returned));
  for (const key of ["caseId", "topicId", "discussionId"]) {
    await assert.rejects(verifySyntheticCitizenBrief(returned, { ...returned, [key]: "different" }));
  }
});

test("unavailable and withdrawn states cannot preserve the previous Brief", async () => {
  for (const status of ["not_ready", "withdrawn"]) {
    const value = seal({ ...returned, brief: null, status });
    assert.equal((await verifySyntheticCitizenBrief(value, returned)).brief, null);
  }
  await assert.rejects(readSyntheticBriefResponse(Response.json({ error: "unavailable" }, { status: 503 }), returned));
  await assert.rejects(readSyntheticBriefResponse(new Response("x".repeat(131073), { headers: { "content-type": "application/json" } }), returned));
});
