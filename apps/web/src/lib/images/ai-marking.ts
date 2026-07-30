/**
 * AI Act Art. 50(2): machine-readable marking of synthetic images.
 *
 * Every AI-generated image we persist must carry, inside the file itself, the
 * IPTC `DigitalSourceType = trainedAlgorithmicMedia` declaration. A caption or
 * badge is not enough — the law asks for a marking that survives the image
 * leaving our UI (shared flyers, downloaded menu photos).
 *
 * Implemented as raw byte insertion of an XMP packet (PNG `iTXt` chunk / JPEG
 * `APP1` segment) so it runs identically in Next.js and in Deno edge functions
 * with zero dependencies. Unknown formats are returned unchanged with
 * `marked: false` — a format we cannot mark must not silently pass as marked.
 *
 * This file is mirrored at
 * `apps/expo/supabase/functions/_shared/ai-marking.ts` for the edge functions;
 * keep the two in sync.
 */

const DIGITAL_SOURCE_TYPE =
  "http://cv.iptc.org/newscodes/digitalsourcetype/trainedAlgorithmicMedia";

function xmpPacket(generator: string): string {
  // Minimal, valid XMP. Iptc4xmpExt:DigitalSourceType is the field C2PA and
  // IPTC readers actually check for synthetic media.
  return (
    `<?xpacket begin="﻿" id="W5M0MpCehiHzreSzNTczkc9d"?>` +
    `<x:xmpmeta xmlns:x="adobe:ns:meta/">` +
    `<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">` +
    `<rdf:Description rdf:about=""` +
    ` xmlns:Iptc4xmpExt="http://iptc.org/std/Iptc4xmpExt/2008-02-29/"` +
    ` xmlns:xmp="http://ns.adobe.com/xap/1.0/"` +
    ` Iptc4xmpExt:DigitalSourceType="${DIGITAL_SOURCE_TYPE}"` +
    ` xmp:CreatorTool="${generator}"/>` +
    `</rdf:RDF></x:xmpmeta>` +
    `<?xpacket end="w"?>`
  );
}

function utf8(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

/** CRC32 as PNG requires for every chunk. */
function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) {
    crc ^= bytes[i];
    for (let bit = 0; bit < 8; bit++) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function u32be(value: number): Uint8Array {
  return new Uint8Array([(value >>> 24) & 0xff, (value >>> 16) & 0xff, (value >>> 8) & 0xff, value & 0xff]);
}

function concat(parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

function isPng(bytes: Uint8Array): boolean {
  return bytes.length > 33 && PNG_SIGNATURE.every((b, i) => bytes[i] === b);
}

function isJpeg(bytes: Uint8Array): boolean {
  return bytes.length > 4 && bytes[0] === 0xff && bytes[1] === 0xd8;
}

/**
 * PNG: an `iTXt` chunk with the standard `XML:com.adobe.xmp` keyword, inserted
 * directly after IHDR (whose length is fixed: 8 sig + 4 len + 4 type + 13 data
 * + 4 crc = byte 33).
 */
function markPng(bytes: Uint8Array, xmp: string): Uint8Array {
  const keyword = utf8("XML:com.adobe.xmp");
  // keyword \0 compressionFlag(0) compressionMethod(0) languageTag \0 translated \0 text
  const data = concat([keyword, new Uint8Array([0, 0, 0, 0, 0]), utf8(xmp)]);
  const typeAndData = concat([utf8("iTXt"), data]);
  const chunk = concat([u32be(data.length), typeAndData, u32be(crc32(typeAndData))]);
  const ihdrEnd = 33;
  return concat([bytes.slice(0, ihdrEnd), chunk, bytes.slice(ihdrEnd)]);
}

/**
 * JPEG: an `APP1` segment with the XMP namespace header, inserted right after
 * SOI. Readers take the first XMP APP1 they find, so ours leading is fine.
 */
function markJpeg(bytes: Uint8Array, xmp: string): Uint8Array {
  const payload = concat([utf8("http://ns.adobe.com/xap/1.0/\0"), utf8(xmp)]);
  const length = payload.length + 2;
  if (length > 0xffff) throw new Error("XMP packet exceeds JPEG segment size");
  const segment = concat([new Uint8Array([0xff, 0xe1, (length >>> 8) & 0xff, length & 0xff]), payload]);
  return concat([bytes.slice(0, 2), segment, bytes.slice(2)]);
}

export interface MarkedImage {
  bytes: Uint8Array;
  /** False when the format is one we cannot mark — the caller decides what that means. */
  marked: boolean;
}

/**
 * Embed the synthetic-media declaration into image bytes.
 *
 * `generator` names the producing system and lands in `xmp:CreatorTool`, e.g.
 * "Röbel App / kie.ai nano-banana-2-lite".
 */
export function markSyntheticImage(bytes: Uint8Array, generator: string): MarkedImage {
  const xmp = xmpPacket(generator);
  if (isPng(bytes)) return { bytes: markPng(bytes, xmp), marked: true };
  if (isJpeg(bytes)) return { bytes: markJpeg(bytes, xmp), marked: true };
  return { bytes, marked: false };
}

export { DIGITAL_SOURCE_TYPE };
