// Mini-app store images — thin adapter over the shared kie.ai client
// (`@/lib/images/kie`), which defaults to Nano Banana 2 Lite. Keeps the
// MiniAppError semantics the image routes expect. 1:1 for icons/previews,
// 16:9 for the store hero.
import "server-only";
import {
  createKieImageTask,
  pollKieImageTask,
  KieImageError,
  type KieTaskState,
} from "@/lib/images/kie";
import { MiniAppError } from "../types";

export async function createImageTask(opts: {
  prompt: string;
  referenceUrls?: string[];
  /** Defaults to 1:1 (icons/previews); the store hero uses 16:9. */
  aspectRatio?: "1:1" | "16:9";
}): Promise<string> {
  try {
    // One model id covers both modes — references simply go in via image_urls.
    return await createKieImageTask({
      prompt: opts.prompt,
      imageUrls: opts.referenceUrls ?? [],
      aspectRatio: opts.aspectRatio ?? "1:1",
    });
  } catch (error) {
    if (error instanceof KieImageError) {
      console.error("[miniapp/images] createTask failed:", error.message);
      throw new MiniAppError("internal", error.message, 502);
    }
    throw error;
  }
}

export type ImageTaskState = KieTaskState;

export async function getImageTask(taskId: string): Promise<ImageTaskState> {
  try {
    return await pollKieImageTask(taskId);
  } catch (error) {
    console.error("[miniapp/images] recordInfo failed:", error);
    return { state: "pending" };
  }
}
