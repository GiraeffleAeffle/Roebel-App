import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildKieCreatePayload,
  parseKieTaskResponse,
  resolveKieModel,
  NANO_BANANA_2_LITE,
  A4_PORTRAIT_RATIO,
  MAX_KIE_REFERENCE_IMAGES,
} from "../src/lib/images/kie-payload";

test("defaults to nano-banana-2-lite", () => {
  assert.equal(resolveKieModel(), NANO_BANANA_2_LITE);
  assert.equal(resolveKieModel(null, null), "nano-banana-2-lite");
  assert.equal(resolveKieModel("", ""), "nano-banana-2-lite");
});

test("env model overrides the default, explicit override wins over env", () => {
  assert.equal(resolveKieModel("nano-banana-2"), "nano-banana-2");
  assert.equal(resolveKieModel("nano-banana-2", "seedream/4.5-text-to-image"), "seedream/4.5-text-to-image");
});

test("text-to-image payload carries an empty image_urls", () => {
  const payload = buildKieCreatePayload({ prompt: "Ein Flyer", aspectRatio: A4_PORTRAIT_RATIO });
  assert.equal(payload.model, "nano-banana-2-lite");
  assert.deepEqual(payload.input, {
    prompt: "Ein Flyer",
    image_urls: [],
    aspect_ratio: "2:3",
  });
});

test("reference urls are passed through as image_urls (same model id)", () => {
  const payload = buildKieCreatePayload({
    prompt: "Mit Logo",
    imageUrls: ["https://x.supabase.co/a.png"],
    aspectRatio: "2:3",
  });
  assert.equal(payload.model, "nano-banana-2-lite");
  assert.deepEqual((payload.input as { image_urls: string[] }).image_urls, [
    "https://x.supabase.co/a.png",
  ]);
});

test("references are capped and falsy entries dropped", () => {
  const many = Array.from({ length: 15 }, (_, i) => `https://x/${i}.png`);
  const payload = buildKieCreatePayload({ prompt: "p", imageUrls: [...many, ""] });
  assert.equal((payload.input as { image_urls: string[] }).image_urls.length, MAX_KIE_REFERENCE_IMAGES);
});

test("aspect ratio defaults to auto when unset", () => {
  const payload = buildKieCreatePayload({ prompt: "p" });
  assert.equal((payload.input as { aspect_ratio: string }).aspect_ratio, "auto");
});

test("parseKieTaskResponse: success returns the first result url", () => {
  const state = parseKieTaskResponse({
    data: { state: "success", resultJson: JSON.stringify({ resultUrls: ["https://img/1.png"] }) },
  });
  assert.deepEqual(state, { state: "success", url: "https://img/1.png" });
});

test("parseKieTaskResponse: success without a url is a failure", () => {
  const state = parseKieTaskResponse({ data: { state: "success", resultJson: "{}" } });
  assert.equal(state.state, "fail");
});

test("parseKieTaskResponse: malformed resultJson is a failure, not a throw", () => {
  const state = parseKieTaskResponse({ data: { state: "success", resultJson: "not json" } });
  assert.equal(state.state, "fail");
});

test("parseKieTaskResponse: fail surfaces failMsg; anything else is pending", () => {
  assert.deepEqual(parseKieTaskResponse({ data: { state: "fail", failMsg: "boom" } }), {
    state: "fail",
    error: "boom",
  });
  assert.deepEqual(parseKieTaskResponse({ data: { state: "waiting" } }), { state: "pending" });
  assert.deepEqual(parseKieTaskResponse({}), { state: "pending" });
  assert.deepEqual(parseKieTaskResponse(null), { state: "pending" });
});
