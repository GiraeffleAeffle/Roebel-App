import {
  isPublicCaseBindingRootEventId,
  verifyPublicCaseBindingReceipt,
  type PublicCaseBindingReceiptV1,
} from "./public-case-binding-receipt-contract";

export type PublicCaseBindingBffResponse = Readonly<{
  status: 200 | 404 | 405 | 503;
  headers: Readonly<Record<string, string>>;
  body: PublicCaseBindingReceiptV1 | { error: "service_unavailable" } | null;
}>;

const NO_STORE = Object.freeze({ "cache-control": "no-store" });

/** Pure HTTP policy; the Next route supplies only the server-held reader. */
export async function respondPublicCaseBindingRequest(input: Readonly<{
  method: string;
  rootEventId: string;
  read: (rootEventId: string) => Promise<PublicCaseBindingReceiptV1 | null>;
}>): Promise<PublicCaseBindingBffResponse> {
  if (input.method !== "GET" && input.method !== "HEAD") {
    return Object.freeze({
      status: 405,
      headers: Object.freeze({ ...NO_STORE, allow: "GET, HEAD" }),
      body: null,
    });
  }
  if (!isPublicCaseBindingRootEventId(input.rootEventId)) {
    return Object.freeze({ status: 404, headers: NO_STORE, body: null });
  }
  try {
    const value = await input.read(input.rootEventId);
    if (!value) return Object.freeze({ status: 404, headers: NO_STORE, body: null });
    const receipt = verifyPublicCaseBindingReceipt(value);
    if (receipt.rootEventId !== input.rootEventId) throw new Error("public_case_binding_reader_mismatch");
    return Object.freeze({
      status: 200,
      headers: Object.freeze({
        ...NO_STORE,
        "x-stadtstack-receipt-sha256": receipt.receiptChecksum,
      }),
      body: input.method === "HEAD" ? null : receipt,
    });
  } catch {
    return Object.freeze({
      status: 503,
      headers: NO_STORE,
      body:
        input.method === "HEAD"
          ? null
          : Object.freeze({ error: "service_unavailable" as const }),
    });
  }
}
