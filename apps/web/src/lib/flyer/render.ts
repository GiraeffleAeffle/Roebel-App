// Flyer rendering via kie.ai — Google **Nano Banana 2 Lite** by default
// (fast, cheap, renders legible text, and ONE model id covers both
// text-to-image and reference-based editing). The pure prompt builders live in
// image-prompt.ts (unit-tested); this file owns the network call.

import "server-only";
import { generateKieImage, fetchGeneratedImage } from "@/lib/images/kie";
import { A4_PORTRAIT_RATIO } from "@/lib/images/kie-payload";

export { buildFlyerImagePrompt, buildFlyerEditPrompt } from "./image-prompt";

/**
 * Render a flyer. `referenceUrls` (org logo / event photo / the existing flyer
 * being edited) are handed to the model as `image_urls` — kie.ai takes public
 * URLs, so nothing has to be uploaded first. Returns the image bytes so the
 * caller can persist them in our own storage.
 */
export async function renderFlyerImage(
  prompt: string,
  referenceUrls: string[] = [],
): Promise<{ bytes: Uint8Array; contentType: string }> {
  const url = await generateKieImage({
    prompt,
    imageUrls: referenceUrls,
    aspectRatio: A4_PORTRAIT_RATIO,
  });
  return fetchGeneratedImage(url);
}
