import { request as httpRequest } from "node:http";
import { Readable } from "node:stream";

/** Node fetch discards Host overrides. The admitted private Case listener
 * requires its fixed virtual Host, so use Node's HTTP transport for this hop. */
export function fetchReviewWithPinnedHost(url: string, init: RequestInit): Promise<Response> {
  return new Promise((resolve, reject) => {
    if (init.body !== undefined && typeof init.body !== "string") {
      reject(new Error("review_transport_body_invalid"));
      return;
    }
    const headers = Object.fromEntries(new Headers(init.headers));
    if (typeof init.body === "string") headers["content-length"] = String(Buffer.byteLength(init.body));
    const request = httpRequest(url, { method: init.method, headers, signal: init.signal ?? undefined, maxHeaderSize: 8192 }, (response) => {
      try {
        const resultHeaders = new Headers();
        for (const [name, value] of Object.entries(response.headers)) {
          if (Array.isArray(value)) value.forEach(item => resultHeaders.append(name, item));
          else if (value !== undefined) resultHeaders.set(name, value);
        }
        resolve(new Response(Readable.toWeb(response) as ReadableStream<Uint8Array>, {
          status: response.statusCode ?? 503, headers: resultHeaders,
        }));
      } catch (error) {
        response.destroy();
        reject(error);
      }
    });
    request.once("error", reject);
    request.end(init.body);
  });
}
