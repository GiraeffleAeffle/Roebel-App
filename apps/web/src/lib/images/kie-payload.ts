// Pure helpers for the kie.ai image job API (no I/O, no server-only) so they
// stay unit-testable. The network calls live in ./kie.ts.
//
// Default model = Google **Nano Banana 2 Lite** (`nano-banana-2-lite`): fast
// ~1K generation, prompt-based editing, cheap. One model id covers BOTH
// text-to-image and edit — references go in via `image_urls` (empty = t2i).
// Docs: https://docs.kie.ai/market/google/nano-banana-2-lite

export const NANO_BANANA_2_LITE = "nano-banana-2-lite";

/** Aspect ratios accepted by nano-banana-2-lite (subset we actually use). */
export type KieAspectRatio =
  | "1:1"
  | "2:3"
  | "3:2"
  | "3:4"
  | "4:3"
  | "4:5"
  | "5:4"
  | "9:16"
  | "16:9"
  | "21:9"
  | "auto";

/** A4 portrait (1:1.414) is closest to 2:3 among the supported ratios. */
export const A4_PORTRAIT_RATIO: KieAspectRatio = "2:3";

/**
 * Which kie.ai model to use. `KIE_IMAGE_MODEL` overrides the default without a
 * code change — e.g. set it to `nano-banana-2` for the higher-resolution (4K)
 * sibling when print quality matters more than cost.
 */
export function resolveKieModel(envModel?: string | null, override?: string | null): string {
  const picked = (override ?? envModel ?? "").trim();
  return picked || NANO_BANANA_2_LITE;
}

export interface KieCreateInput {
  prompt: string;
  /** Reference images (public URLs). Empty/omitted → text-to-image. */
  imageUrls?: string[];
  aspectRatio?: KieAspectRatio;
  model?: string;
}

/** Max references accepted by the model. */
export const MAX_KIE_REFERENCE_IMAGES = 10;

/** Build the `createTask` request body. Pure. */
export function buildKieCreatePayload(
  input: KieCreateInput,
  envModel?: string | null,
): Record<string, unknown> {
  const imageUrls = (input.imageUrls ?? []).filter(Boolean).slice(0, MAX_KIE_REFERENCE_IMAGES);
  return {
    model: resolveKieModel(envModel, input.model),
    input: {
      prompt: input.prompt,
      image_urls: imageUrls,
      aspect_ratio: input.aspectRatio ?? "auto",
    },
  };
}

export type KieTaskState =
  | { state: "pending" }
  | { state: "success"; url: string }
  | { state: "fail"; error: string };

/** Interpret a `recordInfo` response body. Pure. */
export function parseKieTaskResponse(json: unknown): KieTaskState {
  const data = (json as { data?: Record<string, unknown> } | null)?.data;
  const state = data?.state;
  if (state === "success") {
    try {
      const parsed = JSON.parse(String(data?.resultJson ?? "{}")) as { resultUrls?: string[] };
      const url = parsed.resultUrls?.[0];
      if (url) return { state: "success", url };
    } catch {
      // fall through to the failure below
    }
    return { state: "fail", error: "Kein Bild im Ergebnis." };
  }
  if (state === "fail") {
    return { state: "fail", error: String(data?.failMsg || "Generierung fehlgeschlagen.") };
  }
  return { state: "pending" };
}
