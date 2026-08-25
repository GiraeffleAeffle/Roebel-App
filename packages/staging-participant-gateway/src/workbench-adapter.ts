import type { MeckyMirrorAdapter } from "./types.ts";

const ADMIT_PATH = "/api/session/admit";
const POST_PATH = "/api/signed-event";

export type PrivateWorkbenchMirrorConfig = Readonly<{
  /** Exact cluster-local workbench base URL; no browser origin is accepted. */
  url: string;
  /** Existing workbench admission boundary, e.g. x-stadtstack-e2e: 1. */
  admissionHeader: Readonly<{ name: string; value: string }>;
  fetch?: typeof fetch;
}>;

function validate(config: PrivateWorkbenchMirrorConfig): URL {
  let url: URL;
  try {
    url = new URL(config.url);
  } catch {
    throw new Error("staging_participant_workbench_url_invalid");
  }
  if (
    url.protocol !== "http:" ||
    !url.hostname.endsWith(".svc.cluster.local") ||
    url.username || url.password || url.pathname !== "/" || url.search || url.hash ||
    !/^x-stadtstack-e2e$/iu.test(config.admissionHeader.name) ||
    config.admissionHeader.value !== "1"
  ) {
    throw new Error("staging_participant_workbench_config_invalid");
  }
  return url;
}

async function post(
  fetcher: typeof fetch,
  base: URL,
  path: string,
  header: PrivateWorkbenchMirrorConfig["admissionHeader"],
  body: unknown,
): Promise<unknown> {
  const response = await fetcher(new URL(path, base), {
    method: "POST",
    headers: {
      "content-type": "application/json",
      [header.name]: header.value,
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(8_000),
  });
  let value: unknown = null;
  try { value = await response.json(); } catch { /* non-JSON is invalid */ }
  if (!response.ok) throw new Error("staging_participant_workbench_unavailable");
  return value;
}

/**
 * The adapter has exactly two immutable requests: admit the already-verified
 * credential binding, then submit its exact signed ordinary-post event. It
 * cannot publish an arbitrary event intent or call a public workbench origin.
 */
export function createPrivateWorkbenchMeckyMirrorAdapter(
  config: PrivateWorkbenchMirrorConfig,
): MeckyMirrorAdapter {
  const base = validate(config);
  const fetcher = config.fetch ?? globalThis.fetch;
  if (typeof fetcher !== "function") throw new Error("staging_participant_fetch_unavailable");
  return {
    async mirrorPost({ admissionProof, event }) {
      const admitted = await post(fetcher, base, ADMIT_PATH, config.admissionHeader, admissionProof);
      if (!admitted || typeof admitted !== "object" || (admitted as { status?: unknown }).status !== "admitted") {
        throw new Error("staging_participant_workbench_admission_invalid");
      }
      const published = await post(fetcher, base, POST_PATH, config.admissionHeader, {
        intent: "post",
        event,
      });
      if (
        !published || typeof published !== "object" ||
        (published as { status?: unknown }).status !== "published" ||
        (published as { event?: { id?: unknown } }).event?.id !== event.id
      ) {
        throw new Error("staging_participant_workbench_publish_invalid");
      }
      return { status: "published", eventId: event.id } as const;
    },
  };
}
