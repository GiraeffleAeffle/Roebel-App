import {
  isPublicCaseBindingRootEventId,
  verifyPublicCaseBindingReceipt,
  type PublicCaseBindingReceipt,
} from "./public-case-binding-receipt-contract";

const MAX_BODY_BYTES = 16 * 1024;
// This exact staging route requires the reviewed Operations network boundary.
// Its DNS name and port never come from a browser request.
const STAGING_PUBLIC_READER_ORIGIN =
  "http://roebel-case-public-binding.stadtstack-roebel-staging-lab.svc.cluster.local:18086";

function unavailable(): never {
  throw new Error("public_case_binding_unavailable");
}

function expectedJsonMediaType(value: string | null): boolean {
  if (!value) return false;
  const parts = value.toLowerCase().split(";").map((part) => part.trim());
  return parts[0] === "application/json" &&
    (parts.length === 1 || (parts.length === 2 && parts[1] === "charset=utf-8"));
}

async function boundedJson(response: Response): Promise<unknown> {
  if (!expectedJsonMediaType(response.headers.get("content-type"))) unavailable();
  const announced = response.headers.get("content-length");
  if (announced !== null && (!/^(?:0|[1-9][0-9]*)$/u.test(announced) ||
    Number(announced) > MAX_BODY_BYTES)) unavailable();
  if (!response.body) unavailable();
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_BODY_BYTES) {
      await reader.cancel().catch(() => undefined);
      unavailable();
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    return JSON.parse(text) as unknown;
  } catch {
    unavailable();
  }
}

export async function fetchVerifiedPublicCaseBindingReceipt(
  rootEventId: string,
  options: Readonly<{ origin: string; fetchImpl?: typeof fetch; signal?: AbortSignal }>
): Promise<PublicCaseBindingReceipt | null> {
  if (!isPublicCaseBindingRootEventId(rootEventId)) unavailable();
  let origin: URL;
  try {
    origin = new URL(options.origin);
  } catch {
    unavailable();
  }
  const pinnedStagingHttp = options.origin === STAGING_PUBLIC_READER_ORIGIN ||
    options.origin === `${STAGING_PUBLIC_READER_ORIGIN}/`;
  if ((origin.protocol !== "https:" && !pinnedStagingHttp) || origin.username || origin.password || origin.search ||
    origin.hash || origin.pathname !== "/") unavailable();
  const url = new URL(`/v1/public/case-bindings/by-discussion/${rootEventId}`, origin);
  const response = await (options.fetchImpl ?? fetch)(url, {
    method: "GET", cache: "no-store", credentials: "omit", redirect: "error", signal: options.signal,
  });
  if (response.status === 404) return null;
  if (response.status !== 200 || response.redirected ||
    (response.url !== "" && response.url !== url.href)) unavailable();
  const expectedChecksum = response.headers.get("x-stadtstack-receipt-sha256");
  const body = await boundedJson(response);
  const receipt = verifyPublicCaseBindingReceipt(body);
  if (receipt.rootEventId !== rootEventId || expectedChecksum !== receipt.receiptChecksum) {
    unavailable();
  }
  return receipt;
}
