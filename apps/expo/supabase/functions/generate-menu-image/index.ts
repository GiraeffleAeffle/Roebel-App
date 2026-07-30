/**
 * Supabase Edge Function: generate-menu-image
 *
 * Generates a food photo for a menu_items row via Seedream 4.5 (kie.ai),
 * stores it in the `images` bucket and writes the public URL to
 * `menu_items.image_url`.
 *
 * v3 style — per-gastro brand, angle by food type, sharp, centered, no text.
 *
 * If `reference_image_urls` (1–10 public URLs) is provided, runs the edit /
 * image-to-image variant instead: the caller's real photo of the dish is
 * restyled into the branded studio look while keeping the actual food.
 *
 * `model` selects the kie.ai backend: 'seedream' (default, Seedream 4.5) or
 * 'nano_banana_pro' (Google Nano Banana Pro). Each has its own input contract.
 *
 * Auth: verify_jwt=false; protect with x-seed-token header matched against
 * SEED_TOKEN env. Optional x-kie-key header overrides KIE_API_KEY env.
 */

import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.0';
// ---------------------------------------------------------------------------
// AI Act Art. 50(2): machine-readable marking of synthetic images.
// INLINED from apps/web/src/lib/images/ai-marking.ts (keep in sync) because
// the Supabase per-function bundler cannot resolve ../_shared imports in the
// dashboard deploy flow — this function must be self-contained.
// ---------------------------------------------------------------------------
const DIGITAL_SOURCE_TYPE =
  'http://cv.iptc.org/newscodes/digitalsourcetype/trainedAlgorithmicMedia';

function aiMarkXmp(generator: string): string {
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

function aiMarkUtf8(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

function aiMarkCrc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) {
    crc ^= bytes[i];
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function aiMarkU32be(value: number): Uint8Array {
  return new Uint8Array([(value >>> 24) & 0xff, (value >>> 16) & 0xff, (value >>> 8) & 0xff, value & 0xff]);
}

function aiMarkConcat(parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

const AI_MARK_PNG_SIG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

function markSyntheticImage(bytes: Uint8Array, generator: string): { bytes: Uint8Array; marked: boolean } {
  const xmp = aiMarkXmp(generator);
  const isPng = bytes.length > 33 && AI_MARK_PNG_SIG.every((b, i) => bytes[i] === b);
  const isJpeg = bytes.length > 4 && bytes[0] === 0xff && bytes[1] === 0xd8;
  if (isPng) {
    // iTXt chunk with the standard XML:com.adobe.xmp keyword, after IHDR (byte 33).
    const data = aiMarkConcat([aiMarkUtf8('XML:com.adobe.xmp'), new Uint8Array([0, 0, 0, 0, 0]), aiMarkUtf8(xmp)]);
    const typeAndData = aiMarkConcat([aiMarkUtf8('iTXt'), data]);
    const chunk = aiMarkConcat([aiMarkU32be(data.length), typeAndData, aiMarkU32be(aiMarkCrc32(typeAndData))]);
    return { bytes: aiMarkConcat([bytes.slice(0, 33), chunk, bytes.slice(33)]), marked: true };
  }
  if (isJpeg) {
    // APP1 segment with the XMP namespace header, right after SOI.
    const payload = aiMarkConcat([aiMarkUtf8('http://ns.adobe.com/xap/1.0/\0'), aiMarkUtf8(xmp)]);
    const length = payload.length + 2;
    if (length > 0xffff) return { bytes, marked: false };
    const segment = aiMarkConcat([new Uint8Array([0xff, 0xe1, (length >>> 8) & 0xff, length & 0xff]), payload]);
    return { bytes: aiMarkConcat([bytes.slice(0, 2), segment, bytes.slice(2)]), marked: true };
  }
  return { bytes, marked: false };
}
// --------------------------------- end inline -------------------------------

const KIE_CREATE = 'https://api.kie.ai/api/v1/jobs/createTask';
const KIE_POLL = 'https://api.kie.ai/api/v1/jobs/recordInfo';
const SEEDREAM_MODEL = 'seedream/4.5-text-to-image';
const SEEDREAM_EDIT_MODEL = 'seedream/4.5-edit';
const NANO_BANANA_PRO_MODEL = 'nano-banana-pro';
const NANO_BANANA_2_LITE_MODEL = 'nano-banana-2-lite';
const MAX_REFERENCE_IMAGES = 10;
const BUCKET = 'images';
const POLL_INTERVAL_MS = 2500;
const POLL_BUDGET_MS = 60_000;
const VERSION_TAG = 'v3';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-seed-token, x-kie-key',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function json(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

type GastroKey = 'mt' | 'delizia' | 'waage' | 'generic';
type StylePreset = 'dark_stoneware' | 'italian_gingham' | 'light_concrete' | 'wooden_board';
type ImageModel = 'nano_banana_2_lite' | 'seedream' | 'nano_banana_pro';

const DEFAULT_IMAGE_MODEL: ImageModel = 'nano_banana_2_lite';

function isValidModel(v: unknown): v is ImageModel {
  return v === 'nano_banana_2_lite' || v === 'seedream' || v === 'nano_banana_pro';
}

function gastroFor(restaurantName: string): GastroKey {
  const n = restaurantName.toLowerCase();
  if (n.includes('delizia')) return 'delizia';
  if (n.includes('müritz') || n.includes('mueritz')) return 'mt';
  if (n.includes('waage')) return 'waage';
  return 'generic';
}

function backgroundForPreset(p: StylePreset): string {
  switch (p) {
    case 'dark_stoneware':
      return 'served on an anthracite/black stoneware ceramic plate on top of a dark matte surface, clean even dark background, soft round shadow under the plate';
    case 'italian_gingham':
      return 'served on a white ceramic plate on top of a beige-and-white gingham checkered cotton tablecloth (small even squares, classic Italian trattoria), bright and clean';
    case 'light_concrete':
      return 'on a light grey concrete-textured flat surface (subtle stone texture, Uber-Eats catalog style), clean and bright, even neutral background';
    case 'wooden_board':
      return 'served on a warm oak wooden board with visible natural grain (rustic farm-to-table look), clean neutral surroundings, soft round shadow under the board';
  }
}

function backgroundFor(g: GastroKey): string {
  switch (g) {
    case 'mt':
      return backgroundForPreset('dark_stoneware');
    case 'delizia':
      return backgroundForPreset('italian_gingham');
    case 'waage':
      return backgroundForPreset('light_concrete');
    default:
      return 'on a clean flat neutral background';
  }
}

function isValidStylePreset(v: unknown): v is StylePreset {
  return (
    v === 'dark_stoneware' ||
    v === 'italian_gingham' ||
    v === 'light_concrete' ||
    v === 'wooden_board'
  );
}

function angleFor(itemName: string): 'overhead' | 'side' {
  const n = itemName.toLowerCase();
  if (
    n.includes('burger') ||
    n.includes('hamburger') ||
    n.includes('cheeseburger') ||
    n.includes('döner') ||
    n.includes('doner') ||
    n.includes('dürüm') ||
    n.includes('duerum') ||
    n.includes('dürum') ||
    n.includes('dönerbox') ||
    n.includes('hot dog') ||
    n.includes('wrap')
  ) {
    return 'side';
  }
  return 'overhead';
}

function vesselFor(g: GastroKey, itemName: string): string {
  const angle = angleFor(itemName);
  if (g === 'waage') {
    if (angle === 'side') {
      // döner / dürüm style — paper-wrap or small white plate, side 3/4 view
      return 'plated on a white ceramic plate, shot from a slight side 3/4 angle (eye-level)';
    }
    return 'plated centered, shot from directly overhead';
  }
  if (angle === 'side') {
    return 'plated on a white ceramic plate, shot from a slight side 3/4 angle (eye-level) so the layers and stack are visible';
  }
  return 'shot from directly overhead, food perfectly centered in the frame';
}

function buildPrompt(
  itemName: string,
  description: string | null,
  restaurantName: string,
  preset: StylePreset | null,
  hint?: string,
): string {
  const g = gastroFor(restaurantName);
  const bg = preset ? backgroundForPreset(preset) : backgroundFor(g);
  const vessel = vesselFor(g, itemName);
  const desc = description ? `: ${description}` : '';
  const tail = hint ? ` ${hint}` : '';
  return [
    `Studio-grade product food photography of ${itemName}${desc}.`,
    `${vessel}, ${bg}.`,
    'The subject is perfectly centered in the frame with even margins on all sides.',
    'Entire image is in perfect sharp focus — every element crisp and clean, no depth-of-field blur, no bokeh.',
    'Bright, even, soft natural lighting. Vibrant natural colors. Magazine/advertising quality. Ultra clean composition.',
    'No people, no hands, no cutlery, no menu cards, no packaging branding.',
    'ABSOLUTELY NO text, no letters, no numbers, no signage, no captions, no logos, no watermarks anywhere in the image.',
    tail,
  ].join(' ').trim();
}

/**
 * Prompt for the image-to-image edit model: takes the gastro's real photo of the
 * dish and restyles it into the branded studio look, keeping the actual food intact.
 */
function buildEditPrompt(
  itemName: string,
  description: string | null,
  restaurantName: string,
  preset: StylePreset | null,
  hint?: string,
): string {
  const g = gastroFor(restaurantName);
  const bg = preset ? backgroundForPreset(preset) : backgroundFor(g);
  const vessel = vesselFor(g, itemName);
  const desc = description ? ` (${description})` : '';
  const tail = hint ? ` ${hint}` : '';
  return [
    `Restyle this reference photo of ${itemName}${desc} into studio-grade product food photography.`,
    'Keep the exact same dish, ingredients, portion size and arrangement shown in the reference image — do not invent or remove food, do not change the recipe.',
    `Re-plate and re-light it: ${vessel}, ${bg}.`,
    'The subject is perfectly centered in the frame with even margins on all sides.',
    'Entire image is in perfect sharp focus — every element crisp and clean, no depth-of-field blur, no bokeh.',
    'Bright, even, soft natural lighting. Vibrant natural colors. Magazine/advertising quality. Ultra clean composition.',
    'No people, no hands, no cutlery, no menu cards, no packaging branding.',
    'ABSOLUTELY NO text, no letters, no numbers, no signage, no captions, no logos, no watermarks anywhere in the image.',
    tail,
  ].join(' ').trim();
}

function isValidReferenceImageUrls(v: unknown): v is string[] {
  return (
    Array.isArray(v) &&
    v.length >= 1 &&
    v.length <= MAX_REFERENCE_IMAGES &&
    v.every((u) => typeof u === 'string' && /^https?:\/\//i.test(u))
  );
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json(405, { ok: false, code: 'METHOD_NOT_ALLOWED' });

  const expectedToken = Deno.env.get('SEED_TOKEN');
  const providedToken = req.headers.get('x-seed-token');
  if (!expectedToken || providedToken !== expectedToken) {
    return json(401, { ok: false, code: 'UNAUTHORIZED' });
  }

  let body: {
    menu_item_id?: string;
    special_menu_item_id?: string;
    dry_run?: boolean;
    preview?: boolean;
    prompt_hint?: string;
    quality?: 'basic' | 'high';
    style_preset?: string;
    model?: string;
    reference_image_urls?: unknown;
  };
  try { body = await req.json(); } catch { return json(400, { ok: false, code: 'BAD_JSON' }); }
  const hasMenuItem = !!body.menu_item_id;
  const hasSpecialItem = !!body.special_menu_item_id;
  if (hasMenuItem === hasSpecialItem) {
    return json(400, { ok: false, code: 'MISSING_OR_AMBIGUOUS_ITEM_ID' });
  }
  if (body.style_preset !== undefined && !isValidStylePreset(body.style_preset)) {
    return json(400, { ok: false, code: 'INVALID_STYLE_PRESET' });
  }
  if (body.model !== undefined && !isValidModel(body.model)) {
    return json(400, { ok: false, code: 'INVALID_MODEL' });
  }
  const model: ImageModel = isValidModel(body.model) ? body.model : DEFAULT_IMAGE_MODEL;
  const referenceImageUrls =
    body.reference_image_urls === undefined || body.reference_image_urls === null
      ? null
      : isValidReferenceImageUrls(body.reference_image_urls)
        ? body.reference_image_urls
        : undefined;
  if (referenceImageUrls === undefined) {
    return json(400, { ok: false, code: 'INVALID_REFERENCE_IMAGES' });
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const supabase = createClient(supabaseUrl, serviceKey);

  type ItemKind = 'menu_item' | 'special_menu_item';
  const kind: ItemKind = hasMenuItem ? 'menu_item' : 'special_menu_item';

  let item: { id: string; name: string; description: string | null; restaurant_id: string } | null = null;
  if (kind === 'menu_item') {
    const { data, error } = await supabase
      .from('menu_items')
      .select('id, name, description, restaurant_id')
      .eq('id', body.menu_item_id!)
      .single();
    if (error || !data) return json(404, { ok: false, code: 'ITEM_NOT_FOUND' });
    item = data as typeof item;
  } else {
    const { data, error } = await supabase
      .from('special_menu_items')
      .select('id, name, description, special_menu_id, special_menus:special_menu_id(restaurant_id)')
      .eq('id', body.special_menu_item_id!)
      .single();
    if (error || !data) return json(404, { ok: false, code: 'ITEM_NOT_FOUND' });
    // deno-lint-ignore no-explicit-any
    const restaurantId = (data as any).special_menus?.restaurant_id;
    if (!restaurantId) return json(404, { ok: false, code: 'RESTAURANT_NOT_FOUND' });
    item = {
      id: data.id,
      name: data.name,
      description: data.description,
      restaurant_id: restaurantId,
    };
  }
  if (!item) return json(404, { ok: false, code: 'ITEM_NOT_FOUND' });

  const { data: restaurant } = await supabase
    .from('restaurants')
    .select('id, name, ai_image_style')
    .eq('id', item.restaurant_id)
    .single();
  // Resolution order: explicit body param > restaurants.ai_image_style > gastroFor() fallback.
  const presetFromBody = isValidStylePreset(body.style_preset) ? body.style_preset : null;
  const presetFromRow = isValidStylePreset(restaurant?.ai_image_style) ? restaurant.ai_image_style : null;
  const resolvedPreset: StylePreset | null = presetFromBody ?? presetFromRow;
  const useEdit = !!referenceImageUrls;
  const prompt = useEdit
    ? buildEditPrompt(item.name, item.description, restaurant?.name ?? '', resolvedPreset, body.prompt_hint)
    : buildPrompt(item.name, item.description, restaurant?.name ?? '', resolvedPreset, body.prompt_hint);

  if (body.dry_run) {
    return json(200, { ok: true, prompt, dry_run: true, model, mode: useEdit ? 'edit' : 'text-to-image' });
  }

  const kieKey = req.headers.get('x-kie-key') ?? Deno.env.get('KIE_API_KEY');
  if (!kieKey) return json(500, { ok: false, code: 'NO_KIE_KEY' });

  // Each kie.ai model family has a different input contract. Both target ~1K
  // output so a generation finishes within the 60s poll budget:
  //  - Seedream 4.5: separate text-to-image / edit model ids, references via
  //    `image_urls`, sized via `quality` ('basic' = the faster ~1K tier).
  //  - Nano Banana Pro: one model id for both modes, references via `image_input`
  //    (empty array for text-to-image), sized via `resolution`/`output_format`.
  let createBody: Record<string, unknown>;
  if (model === 'nano_banana_2_lite') {
    // Nano Banana 2 Lite (default): one model id for both modes, references via
    // `image_urls` (empty array = text-to-image), fast ~1K output.
    createBody = {
      model: NANO_BANANA_2_LITE_MODEL,
      input: {
        prompt,
        image_urls: useEdit ? referenceImageUrls : [],
        aspect_ratio: '16:9',
      },
    };
  } else if (model === 'nano_banana_pro') {
    createBody = {
      model: NANO_BANANA_PRO_MODEL,
      input: {
        prompt,
        image_input: useEdit ? referenceImageUrls : [],
        aspect_ratio: '16:9',
        resolution: '1K',
        output_format: 'jpg',
      },
    };
  } else {
    createBody = useEdit
      ? {
          model: SEEDREAM_EDIT_MODEL,
          input: {
            prompt,
            image_urls: referenceImageUrls,
            aspect_ratio: '16:9',
            quality: body.quality ?? 'basic',
          },
        }
      : {
          model: SEEDREAM_MODEL,
          input: { prompt, aspect_ratio: '16:9', quality: body.quality ?? 'basic' },
        };
  }
  const createResp = await fetch(KIE_CREATE, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${kieKey}` },
    body: JSON.stringify(createBody),
  });
  if (!createResp.ok) {
    const txt = await createResp.text();
    return json(502, { ok: false, code: 'KIE_CREATE_ERROR', error: txt.slice(0, 500) });
  }
  const createJson = (await createResp.json()) as { data?: { taskId?: string } };
  const taskId = createJson?.data?.taskId;
  if (!taskId) return json(502, { ok: false, code: 'KIE_NO_TASK_ID', error: JSON.stringify(createJson).slice(0, 500) });

  const started = Date.now();
  let imageUrl: string | null = null;
  let failMsg: string | null = null;
  while (Date.now() - started < POLL_BUDGET_MS) {
    await sleep(POLL_INTERVAL_MS);
    const pollResp = await fetch(`${KIE_POLL}?taskId=${encodeURIComponent(taskId)}`, {
      headers: { Authorization: `Bearer ${kieKey}` },
    });
    if (!pollResp.ok) continue;
    const pollJson = (await pollResp.json()) as { data?: { state?: string; resultJson?: string; failMsg?: string } };
    const state = pollJson?.data?.state;
    if (state === 'success') {
      try {
        const parsed = JSON.parse(pollJson.data?.resultJson ?? '{}') as { resultUrls?: string[] };
        imageUrl = parsed.resultUrls?.[0] ?? null;
      } catch {}
      break;
    }
    if (state === 'fail') {
      failMsg = pollJson?.data?.failMsg ?? 'unknown failure';
      break;
    }
  }
  if (failMsg) return json(502, { ok: false, code: 'KIE_FAIL', error: failMsg, task_id: taskId });
  if (!imageUrl) return json(202, { ok: false, code: 'TIMEOUT', task_id: taskId, prompt });

  const imgResp = await fetch(imageUrl);
  if (!imgResp.ok) return json(502, { ok: false, code: 'IMAGE_DOWNLOAD_FAILED' });
  const rawBytes = new Uint8Array(await imgResp.arrayBuffer());
  const contentType = imgResp.headers.get('content-type') ?? 'image/jpeg';
  // AI Act Art. 50(2): embed the machine-readable synthetic-media marking in
  // the file itself before it lands in public storage.
  const { bytes: imgBytes, marked } = markSyntheticImage(rawBytes, `Röbel App / kie.ai ${model}`);
  if (!marked) console.warn('unmarkable image format:', contentType);
  const ext = contentType.includes('png') ? 'png' : 'jpg';

  // Timestamped path so each regeneration writes a fresh object — bypasses the
  // bucket's no-update RLS for anon callers and cache-busts the image URL.
  const folder = kind === 'menu_item' ? 'menu-items' : 'special-menu-items';
  const base = useEdit ? `${VERSION_TAG}_ref` : VERSION_TAG;
  const tag = body.preview ? `${base}_variant` : base;
  const objectPath = `${folder}/${item.restaurant_id}/${item.id}_${tag}_${Date.now()}.${ext}`;
  const uploadRes = await supabase.storage.from(BUCKET).upload(objectPath, imgBytes, { contentType, upsert: true });
  if (uploadRes.error) return json(500, { ok: false, code: 'UPLOAD_FAILED', error: uploadRes.error.message });
  const { data: pub } = supabase.storage.from(BUCKET).getPublicUrl(objectPath);
  const publicUrl = pub.publicUrl;

  if (!body.preview) {
    const table = kind === 'menu_item' ? 'menu_items' : 'special_menu_items';
    const { error: updErr } = await supabase.from(table).update({ image_url: publicUrl }).eq('id', item.id);
    if (updErr) return json(500, { ok: false, code: 'DB_UPDATE_FAILED', error: updErr.message });
  }

  return json(200, { ok: true, image_url: publicUrl, prompt, task_id: taskId, preview: !!body.preview, model, mode: useEdit ? 'edit' : 'text-to-image' });
});
