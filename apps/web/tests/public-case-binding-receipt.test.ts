import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";
import {
  type PublicCaseBindingReceiptV1,
  verifyPublicCaseBindingReceipt,
} from "../src/lib/stadtstack/public-case-binding-receipt-contract";
import { fetchVerifiedPublicCaseBindingReceipt } from "../src/lib/stadtstack/public-case-binding-receipt-transport";
import { respondPublicCaseBindingRequest } from "../src/lib/stadtstack/public-case-binding-bff";

const ROOT = "a".repeat(64);
const CANDIDATE = "b".repeat(64);
const ANSWER = "c".repeat(64);
const HEAD = `sha256:${"d".repeat(64)}`;
const CASE_ID =
  "urn:stadtstack:case:municipality:roebel-mueritz:018f0000-0000-7000-8000-000000000001";

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonical(record[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function checksum(value: unknown): string {
  return `sha256:${createHash("sha256").update(canonical(value), "utf8").digest("hex")}`;
}

function receipt(
  overrides: Partial<Omit<PublicCaseBindingReceiptV1, "receiptChecksum">> = {}
): PublicCaseBindingReceiptV1 {
  const unsigned = {
    schemaVersion: "public_case_binding_receipt_v1" as const,
    rootEventId: ROOT,
    topicId: "urn:stadtstack:topic:municipality:roebel-mueritz:offener-treffpunkt",
    candidateId: `urn:stadtstack:signed-topic-suggestion:${CANDIDATE}`,
    candidateEventId: CANDIDATE,
    sourceAnswerEventId: ANSWER,
    caseId: CASE_ID,
    caseVersion: 3 as const,
    caseEventIds: [
      `urn:stadtstack:case-event:${CASE_ID}:1`,
      `urn:stadtstack:case-event:${CASE_ID}:2`,
      `urn:stadtstack:case-event:${CASE_ID}:3`,
    ] as const,
    journalHeadChecksum: HEAD,
    admissionEventChecksum: HEAD,
    authorityBinding: "none" as const,
    openDeskWrite: false as const,
    ...overrides,
  };
  return { ...unsigned, receiptChecksum: checksum(unsigned) };
}

test("accepts only an exact canonical public Case Steward receipt", () => {
  const verified = verifyPublicCaseBindingReceipt(receipt());
  assert.equal(verified.caseId, CASE_ID);
  assert.equal(verified.rootEventId, ROOT);
  assert.equal(verified.authorityBinding, "none");
  assert.equal(verified.openDeskWrite, false);
});

test("rejects a legacy test case identifier and a tampered checksum", () => {
  const legacy = receipt() as Record<string, unknown>;
  legacy.caseId =
    "urn:stadtstack:case:test:roebel-mueritz:018f0000-0000-7000-8000-000000000001";
  assert.throws(() => verifyPublicCaseBindingReceipt(legacy));

  const tampered = { ...receipt(), caseVersion: 4 };
  assert.throws(() => verifyPublicCaseBindingReceipt(tampered));
});

test("matches the canonical Stadtstack topic grammar and byte bounds", () => {
  assert.equal(
    verifyPublicCaseBindingReceipt(
      receipt({
        topicId: "urn:stadtstack:topic:municipality:-:-",
      })
    ).topicId,
    "urn:stadtstack:topic:municipality:-:-"
  );
  const prefix = "urn:stadtstack:topic:municipality:";
  const exact256 = `${prefix}${"a".repeat(256 - prefix.length - 2)}:b`;
  assert.equal(Buffer.byteLength(exact256), 256);
  assert.equal(
    verifyPublicCaseBindingReceipt(receipt({ topicId: exact256 })).topicId,
    exact256
  );
  assert.throws(() =>
    verifyPublicCaseBindingReceipt(
      receipt({ topicId: `${exact256}a` })
    )
  );
});

test("rejects prototype, getter and array-shape tricks before canonicalizing", () => {
  const inherited = Object.assign(Object.create({ hidden: true }), receipt());
  assert.throws(() => verifyPublicCaseBindingReceipt(inherited));

  const getter = { ...receipt() } as Record<string, unknown>;
  Object.defineProperty(getter, "schemaVersion", {
    enumerable: true,
    get() {
      return "public_case_binding_receipt_v1";
    },
  });
  assert.throws(() => verifyPublicCaseBindingReceipt(getter));

  const extraIndex = receipt() as unknown as Record<string, unknown>;
  const eventIds = [...(extraIndex.caseEventIds as string[])] as string[] & {
    extra?: string;
  };
  eventIds.extra = "smuggled";
  extraIndex.caseEventIds = eventIds;
  assert.throws(() => verifyPublicCaseBindingReceipt(extraIndex));
});

test("uses one credential-free exact discussion route and rejects a mismatched transport checksum", async () => {
  const valid = receipt();
  let requested: URL | null = null;
  const loaded = await fetchVerifiedPublicCaseBindingReceipt(ROOT, {
    origin: "https://public.stadtstack.example",
    fetchImpl: (async (input, init) => {
      requested = new URL(String(input));
      assert.equal(init?.method, "GET");
      assert.equal(init?.credentials, "omit");
      assert.equal(init?.redirect, "error");
      assert.equal(init?.headers, undefined);
      assert.equal(init?.body, undefined);
      return new Response(JSON.stringify(valid), {
        headers: {
          "content-type": "application/json; charset=utf-8",
          "x-stadtstack-receipt-sha256": valid.receiptChecksum,
        },
      });
    }) as typeof fetch,
  });
  assert.equal(loaded?.caseId, CASE_ID);
  assert.equal(
    requested?.pathname,
    `/v1/public/case-bindings/by-discussion/${ROOT}`
  );
  assert.equal(requested?.search, "");

  await assert.rejects(() =>
    fetchVerifiedPublicCaseBindingReceipt(ROOT, {
      origin: "https://public.stadtstack.example",
      fetchImpl: (async () =>
        new Response(JSON.stringify(valid), {
          headers: {
            "content-type": "application/json",
            "x-stadtstack-receipt-sha256": HEAD,
          },
        })) as typeof fetch,
    })
  );
});

test("separates a real 404 from malformed, redirected, or oversized upstream data", async () => {
  const options = { origin: "https://public.stadtstack.example" } as const;
  assert.equal(
    await fetchVerifiedPublicCaseBindingReceipt(ROOT, {
      ...options,
      fetchImpl: (async () => new Response(null, { status: 404 })) as typeof fetch,
    }),
    null
  );

  for (const response of [
    new Response("{}", { headers: { "content-type": "text/plain" } }),
    new Response("{}", { headers: { "content-type": "application/json" } }),
    new Response("{}", {
      headers: {
        "content-type": "application/json",
        "content-length": String(16 * 1024 + 1),
      },
    }),
    new Response(`{"padding":"${"x".repeat(16 * 1024)}"}`, {
      headers: { "content-type": "application/json" },
    }),
    new Response("not-json", {
      headers: { "content-type": "application/json" },
    }),
    new Response(null, { status: 500 }),
  ]) {
    await assert.rejects(() =>
      fetchVerifiedPublicCaseBindingReceipt(ROOT, {
        ...options,
        fetchImpl: (async () => response) as typeof fetch,
      })
    );
  }

  const redirected = new Response(JSON.stringify(receipt()), {
    headers: { "content-type": "application/json" },
  });
  Object.defineProperty(redirected, "redirected", { value: true });
  await assert.rejects(() =>
    fetchVerifiedPublicCaseBindingReceipt(ROOT, {
      ...options,
      fetchImpl: (async () => redirected) as typeof fetch,
    })
  );
});

test("fails closed for malformed roots and unpinned origins", async () => {
  for (const origin of [
    "",
    "not-a-url",
    "http://public.stadtstack.example",
    "https://user:secret@public.stadtstack.example",
    "https://public.stadtstack.example/base",
    "https://public.stadtstack.example?query=1",
  ]) {
    await assert.rejects(() =>
      fetchVerifiedPublicCaseBindingReceipt(ROOT, { origin })
    );
  }
  await assert.rejects(() =>
    fetchVerifiedPublicCaseBindingReceipt("A".repeat(64), {
      origin: "https://public.stadtstack.example",
    })
  );
});

test("maps GET, HEAD, unsupported methods and reader failures without leaking details", async () => {
  const valid = receipt();
  const get = await respondPublicCaseBindingRequest({
    method: "GET",
    rootEventId: ROOT,
    read: async () => valid,
  });
  assert.equal(get.status, 200);
  assert.deepEqual(get.body, valid);

  const head = await respondPublicCaseBindingRequest({
    method: "HEAD",
    rootEventId: ROOT,
    read: async () => valid,
  });
  assert.equal(head.status, 200);
  assert.equal(head.body, null);
  assert.equal(head.headers["x-stadtstack-receipt-sha256"], valid.receiptChecksum);

  const unsupported = await respondPublicCaseBindingRequest({
    method: "POST",
    rootEventId: ROOT,
    read: async () => valid,
  });
  assert.equal(unsupported.status, 405);
  assert.equal(unsupported.headers.allow, "GET, HEAD");

  const malformedRoot = await respondPublicCaseBindingRequest({
    method: "GET",
    rootEventId: "A".repeat(64),
    read: async () => valid,
  });
  assert.equal(malformedRoot.status, 404);

  const missing = await respondPublicCaseBindingRequest({
    method: "GET",
    rootEventId: ROOT,
    read: async () => null,
  });
  assert.equal(missing.status, 404);

  const unavailable = await respondPublicCaseBindingRequest({
    method: "GET",
    rootEventId: ROOT,
    read: async () => {
      throw new Error("secret upstream detail");
    },
  });
  assert.deepEqual(unavailable, {
    status: 503,
    headers: { "cache-control": "no-store" },
    body: { error: "service_unavailable" },
  });

  const unavailableHead = await respondPublicCaseBindingRequest({
    method: "HEAD",
    rootEventId: ROOT,
    read: async () => {
      throw new Error("secret upstream detail");
    },
  });
  assert.equal(unavailableHead.status, 503);
  assert.equal(unavailableHead.body, null);
});
