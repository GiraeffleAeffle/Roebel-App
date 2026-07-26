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
