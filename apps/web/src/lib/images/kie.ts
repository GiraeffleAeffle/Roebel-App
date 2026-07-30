// Shared server-side image generation via kie.ai — the single path for every
// AI image in apps/web. Default model: Google **Nano Banana 2 Lite**
// (`nano-banana-2-lite`) — fast, cheap, one model id for text-to-image AND
// prompt-based editing (references via `image_urls`).
//
// Reaches kie.ai directly when KIE_API_KEY is set, otherwise forwards through
// the `kie-proxy` Supabase edge function authenticated with SUPABASE_SEED_TOKEN
// (the KIE key itself lives only in Supabase secrets).

import "server-only";
import {
  buildKieCreatePayload,
  NANO_BANANA_2_LITE,
  parseKieTaskResponse,
  type KieCreateInput,
  type KieTaskState,
} from "./kie-payload";
import { markSyntheticImage } from "./ai-marking";

export {
  NANO_BANANA_2_LITE,
  A4_PORTRAIT_RATIO,
  buildKieCreatePayload,
  parseKieTaskResponse,
  resolveKieModel,
  type KieAspectRatio,
  type KieCreateInput,
  type KieTaskState,
} from "./kie-payload";

const KIE_BASE = "https://api.kie.ai/api/v1/jobs";
const POLL_INTERVAL_MS = 2000;
// Nano Banana 2 Lite typically returns in a few seconds. Keep the budget well
// under a serverless function timeout so the caller gets a real error instead
// of a hung request.
const DEFAULT_BUDGET_MS = 55_000;

export class KieImageError extends Error {}

type KieRequest =
  | { action: "createTask"; payload: Record<string, unknown> }
  | { action: "recordInfo"; taskId: string };

/** Direct kie.ai call (KIE_API_KEY) or forwarded via the kie-proxy edge function. */
async function kieFetch(req: KieRequest): Promise<Response> {
  const directKey = process.env.KIE_API_KEY;
  if (directKey) {
    if (req.action === "createTask") {
      return fetch(`${KIE_BASE}/createTask`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${directKey}` },
        body: JSON.stringify(req.payload),
      });
    }
    return fetch(`${KIE_BASE}/recordInfo?taskId=${encodeURIComponent(req.taskId)}`, {
      headers: { Authorization: `Bearer ${directKey}` },
    });
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const seedToken = process.env.SUPABASE_SEED_TOKEN;
  if (!supabaseUrl || !seedToken) {
    throw new KieImageError(
      "Bildgenerierung ist nicht konfiguriert (KIE_API_KEY oder SUPABASE_SEED_TOKEN fehlt).",
    );
  }
  return fetch(`${supabaseUrl.replace(/\/$/, "")}/functions/v1/kie-proxy`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-seed-token": seedToken },
    body: JSON.stringify(req),
  });
}

/** Start an image job. Returns the kie.ai taskId. */
export async function createKieImageTask(input: KieCreateInput): Promise<string> {
  const payload = buildKieCreatePayload(input, process.env.KIE_IMAGE_MODEL);
  const res = await kieFetch({ action: "createTask", payload });
  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    console.error("[images/kie] createTask failed:", res.status, txt.slice(0, 300));
    throw new KieImageError("Bildgenerierung konnte nicht gestartet werden.");
  }
  const json = (await res.json()) as { data?: { taskId?: string } };
  const taskId = json.data?.taskId;
  if (!taskId) throw new KieImageError("Bildgenerierung konnte nicht gestartet werden.");
  return taskId;
}

/** Poll a job once. */
export async function pollKieImageTask(taskId: string): Promise<KieTaskState> {
  const res = await kieFetch({ action: "recordInfo", taskId });
  if (!res.ok) return { state: "pending" };
  return parseKieTaskResponse(await res.json());
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Start a job and wait for the resulting image URL. Nano Banana 2 Lite usually
 * returns in a few seconds; the budget guards against a stuck job.
 */
export async function generateKieImage(
  input: KieCreateInput & { budgetMs?: number },
): Promise<string> {
  const taskId = await createKieImageTask(input);
  const budget = input.budgetMs ?? DEFAULT_BUDGET_MS;
  const started = Date.now();
  while (Date.now() - started < budget) {
    // Poll first, then wait — a fast job shouldn't pay a full interval.
    const task = await pollKieImageTask(taskId);
    if (task.state === "success") return task.url;
    if (task.state === "fail") {
      // The provider's failMsg is English/vendor-specific — log it, show German.
      console.error("[images/kie] job failed:", taskId, task.error);
      throw new KieImageError(
        "Die Bildgenerierung ist fehlgeschlagen. Bitte formuliert die Beschreibung etwas anders.",
      );
    }
    await sleep(POLL_INTERVAL_MS);
  }
  throw new KieImageError("Die Bildgenerierung hat zu lange gedauert. Bitte erneut versuchen.");
}

/** Download a generated image so we can persist it in our own storage. */
export async function fetchGeneratedImage(
  url: string,
): Promise<{ bytes: Uint8Array; contentType: string }> {
  const res = await fetch(url);
  if (!res.ok) throw new KieImageError("Das erzeugte Bild konnte nicht geladen werden.");
  const contentType = res.headers.get("content-type") ?? "image/png";
  const raw = new Uint8Array(await res.arrayBuffer());
  // AI Act Art. 50(2): every synthetic image we persist carries the
  // machine-readable marking inside the file, not just in our database.
  const model = process.env.KIE_IMAGE_MODEL ?? NANO_BANANA_2_LITE;
  const { bytes, marked } = markSyntheticImage(raw, `Röbel App / kie.ai ${model}`);
  if (!marked) console.warn("[images/kie] unmarkable image format:", contentType);
  return { bytes, contentType };
}
