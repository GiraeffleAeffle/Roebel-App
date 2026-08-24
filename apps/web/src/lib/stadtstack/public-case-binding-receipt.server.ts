import "server-only";

import { fetchVerifiedPublicCaseBindingReceipt as fetchReceipt } from "./public-case-binding-receipt-transport";

export { isPublicCaseBindingRootEventId } from "./public-case-binding-receipt-contract";
export type { PublicCaseBindingReceiptV1 } from "./public-case-binding-receipt-contract";

/** Server-only composition: the browser never sees the pinned public origin. */
export function fetchVerifiedPublicCaseBindingReceipt(
  rootEventId: string,
  options: Readonly<{ fetchImpl?: typeof fetch; signal?: AbortSignal }> = {}
) {
  const origin = process.env.STADTSTACK_PUBLIC_CASE_BINDING_ORIGIN;
  if (!origin) return Promise.reject(new Error("public_case_binding_unavailable"));
  return fetchReceipt(rootEventId, { ...options, origin });
}
