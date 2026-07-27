// gpt-image-1 render — the one model that types legible text into an image.
// The pure prompt builder lives in image-prompt.ts (unit-tested); this file
// owns the OpenAI call and is server-only.

import "server-only";
import { experimental_generateImage as generateImage } from "ai";
import { openai } from "@ai-sdk/openai";
import { FLYER_IMAGE_SIZE, FLYER_IMAGE_QUALITY } from "./image-prompt";

export { buildFlyerImagePrompt, FLYER_IMAGE_SIZE, FLYER_IMAGE_QUALITY } from "./image-prompt";

/** Render the flyer via gpt-image-1. Returns PNG bytes. Throws on a missing key / API error. */
export async function renderFlyerImage(prompt: string): Promise<Uint8Array> {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error("OPENAI_API_KEY fehlt — Bildgenerierung ist nicht konfiguriert.");
  }
  const { image } = await generateImage({
    model: openai.image("gpt-image-1"),
    prompt,
    size: FLYER_IMAGE_SIZE,
    providerOptions: { openai: { quality: FLYER_IMAGE_QUALITY } },
  });
  return image.uint8Array;
}

/**
 * Render a flyer that INCORPORATES a reference image (logo / event photo) via
 * gpt-image-1's edit endpoint. The AI SDK's generateImage has no image-input
 * path, so this calls the raw OpenAI Images API directly. Returns PNG bytes.
 */
export async function renderFlyerImageWithReference(
  prompt: string,
  reference: { bytes: Uint8Array; contentType: string },
): Promise<Uint8Array> {
  const key = process.env.OPENAI_API_KEY;
  if (!key) {
    throw new Error("OPENAI_API_KEY fehlt — Bildgenerierung ist nicht konfiguriert.");
  }
  const ext = reference.contentType.includes("png")
    ? "png"
    : reference.contentType.includes("webp")
      ? "webp"
      : "jpg";
  const form = new FormData();
  form.append("model", "gpt-image-1");
  form.append("prompt", prompt);
  form.append("size", FLYER_IMAGE_SIZE);
  form.append("quality", FLYER_IMAGE_QUALITY);
  form.append("n", "1");
  form.append(
    "image",
    new Blob([reference.bytes], { type: reference.contentType }),
    `reference.${ext}`,
  );

  const res = await fetch("https://api.openai.com/v1/images/edits", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}` },
    body: form,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`gpt-image-1 edit failed: ${res.status} ${text.slice(0, 300)}`);
  }
  const json = (await res.json()) as { data?: { b64_json?: string }[] };
  const b64 = json?.data?.[0]?.b64_json;
  if (!b64) {
    throw new Error("gpt-image-1 edit: kein Bild erhalten.");
  }
  return new Uint8Array(Buffer.from(b64, "base64"));
}
