import type { MeckyMirrorAdapter } from "./types.ts";

const ADMIT_PATH = "/api/session/admit";
const POST_PATH = "/api/signed-event";
export const PRIVATE_WORKBENCH_URL =
  "http://e2e-workbench.stadtstack-roebel-staging-lab.svc.cluster.local:18083/";

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
    config.url !== PRIVATE_WORKBENCH_URL ||
    url.href !== PRIVATE_WORKBENCH_URL ||
    url.protocol !== "http:" ||
    url.username || url.password || url.pathname !== "/" || url.search || url.hash ||
    config.admissionHeader.name !== "x-stadtstack-e2e" ||
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
 * credential binding, then submit its exact signed app-conversation mention. It
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
        intent: "conversation",
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
