// KIE.ai job client for the mini-app store images — Seedream 4.5
// (text-to-image + edit; same model ids/contracts as the generate-menu-image
// edge function). Reaches KIE directly when KIE_API_KEY is set, otherwise
// through the kie-proxy Supabase edge function authenticated with
// SUPABASE_SEED_TOKEN — the KIE key itself lives only in Supabase secrets.
// 1:1 output for icons/previews; the store hero uses 16:9.
import "server-only";
import { MiniAppError } from "../types";

const KIE_BASE = "https://api.kie.ai/api/v1/jobs";
const T2I_MODEL = "seedream/4.5-text-to-image";
const EDIT_MODEL = "seedream/4.5-edit";

type KieRequest =
  | { action: "createTask"; payload: Record<string, unknown> }
  | { action: "recordInfo"; taskId: string };

/** Direct KIE call (KIE_API_KEY) or forward via the kie-proxy edge function. */
async function kieFetch(req: KieRequest): Promise<Response> {
  const directKey = process.env.KIE_API_KEY;
  if (directKey) {
    if (req.action === "createTask") {
      return fetch(`${KIE_BASE}/createTask`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${directKey}`,
        },
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
    throw new MiniAppError(
      "internal",
      "Bildgenerierung ist nicht konfiguriert (KIE_API_KEY oder SUPABASE_SEED_TOKEN fehlt).",
      503,
    );
  }
  return fetch(`${supabaseUrl.replace(/\/$/, "")}/functions/v1/kie-proxy`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-seed-token": seedToken },
    body: JSON.stringify(req),
  });
}

export async function createImageTask(opts: {
  prompt: string;
  referenceUrls?: string[];
  /** Defaults to 1:1 (icons/previews); the store hero uses 16:9. */
  aspectRatio?: "1:1" | "16:9";
}): Promise<string> {
  const refs = opts.referenceUrls ?? [];
  const aspectRatio = opts.aspectRatio ?? "1:1";
  // Seedream 4.5 splits generation and edit into two models; references go
  // in via `image_urls`. 'basic' quality = the faster ~1K tier — plenty for
  // store icons and previews.
  const payload =
    refs.length > 0
      ? {
          model: EDIT_MODEL,
          input: { prompt: opts.prompt, image_urls: refs, aspect_ratio: aspectRatio },
        }
      : {
          model: T2I_MODEL,
          input: { prompt: opts.prompt, aspect_ratio: aspectRatio, quality: "basic" },
        };

  const res = await kieFetch({ action: "createTask", payload });
  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    console.error("[miniapp/images] KIE createTask failed:", res.status, txt.slice(0, 300));
    throw new MiniAppError("internal", "Bildgenerierung konnte nicht gestartet werden.", 502);
  }
  const json = (await res.json()) as { data?: { taskId?: string } };
  const taskId = json.data?.taskId;
  if (!taskId) {
    throw new MiniAppError("internal", "Bildgenerierung konnte nicht gestartet werden.", 502);
  }
  return taskId;
}

export type ImageTaskState =
  | { state: "pending" }
  | { state: "success"; url: string }
  | { state: "fail"; error: string };

export async function getImageTask(taskId: string): Promise<ImageTaskState> {
  const res = await kieFetch({ action: "recordInfo", taskId });
  if (!res.ok) {
    return { state: "pending" };
  }
  const json = (await res.json()) as {
    data?: { state?: string; resultJson?: string; failMsg?: string };
  };
  const state = json.data?.state;
  if (state === "success") {
    try {
      const parsed = JSON.parse(json.data?.resultJson ?? "{}") as {
        resultUrls?: string[];
      };
      const url = parsed.resultUrls?.[0];
      if (url) return { state: "success", url };
    } catch {
      // fällt unten auf "fail" durch
    }
    return { state: "fail", error: "Kein Bild im Ergebnis." };
  }
  if (state === "fail") {
    return { state: "fail", error: json.data?.failMsg || "Generierung fehlgeschlagen." };
  }
  return { state: "pending" };
}
