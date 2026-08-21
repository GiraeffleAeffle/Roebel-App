// Edge Function: project-public-mecky-reply
//
// Deploy with verify_jwt=false. The signed Nostr event is the credential. This
// function independently verifies the signature, exact Public Mecky identity
// and exact source-app tags before the service role may touch the read model.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { schnorr } from "https://esm.sh/@noble/curves@1.9.7/secp256k1";
import { sha256 } from "https://esm.sh/@noble/hashes@1.8.0/sha256";
import {
  bytesToHex,
  hexToBytes,
  utf8ToBytes,
} from "https://esm.sh/@noble/hashes@1.8.0/utils";
import {
  PublicMeckyReplyProjectionError,
  parsePublicMeckyReplyProjection,
  type SignedNostrEvent,
} from "../_shared/public-mecky-reply-projection.ts";

const db = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

const noStore = {
  "cache-control": "no-store",
  "content-type": "application/json; charset=utf-8",
};

function response(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), { status, headers: noStore });
}

function eventId(event: SignedNostrEvent): string {
  return bytesToHex(
    sha256(
      utf8ToBytes(
        JSON.stringify([
          0,
          event.pubkey,
          event.created_at,
          event.kind,
          event.tags,
          event.content,
        ]),
      ),
    ),
  );
}

function verifyEvent(event: SignedNostrEvent): boolean {
  try {
    return (
      eventId(event) === event.id &&
      schnorr.verify(
        hexToBytes(event.sig),
        hexToBytes(event.id),
        hexToBytes(event.pubkey),
      )
    );
  } catch {
    return false;
  }
}

Deno.serve(async (request) => {
  if (request.method !== "POST") {
    return response(405, { error: "method_not_allowed" });
  }
  const contentLengthHeader = request.headers.get("content-length");
  const contentLength = contentLengthHeader === null
    ? null
    : Number(contentLengthHeader);
  if (
    (contentLength !== null && !Number.isFinite(contentLength)) ||
    (contentLength !== null && contentLength > 32_768)
  ) {
    return response(413, { error: "payload_too_large" });
  }

  try {
    const rawBody = await request.text();
    if (new TextEncoder().encode(rawBody).byteLength > 32_768) {
      return response(413, { error: "payload_too_large" });
    }
    const body = JSON.parse(rawBody) as unknown;
    if (
      !body ||
      typeof body !== "object" ||
      Array.isArray(body) ||
      Object.keys(body).join(",") !== "event"
    ) {
      return response(400, { error: "invalid_projection_request" });
    }
    const projection = parsePublicMeckyReplyProjection(
      (body as { event: unknown }).event,
      {
        expectedPubkey: Deno.env.get("MECKY_NOSTR_PUBKEY") ?? "",
        verifyEvent,
      },
    );
    const { error } = await db
      .from("public_mecky_replies")
      .upsert(projection, { onConflict: "event_id", ignoreDuplicates: true });
    if (error) {
      const status = error.code === "23505" ? 409 : 503;
      return response(status, { error: "projection_store_unavailable" });
    }
    return response(201, {
      eventId: projection.event_id,
      sourcePostId: projection.source_post_id,
      authorityBinding: "none",
    });
  } catch (error) {
    if (error instanceof PublicMeckyReplyProjectionError) {
      return response(400, { error: error.code });
    }
    return response(400, { error: "invalid_projection_request" });
  }
});
