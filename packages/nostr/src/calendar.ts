import { type NostrEvent, buildEvent } from "./events";

/**
 * NIP-52 calendar events — the standard shape for anything with a time and a place.
 *
 * Using the standard kind rather than a custom one is the whole point: a cinema
 * programme published this way renders in ANY Nostr client, not only in the app
 * that wrote it. That is the difference between publishing data and publishing it
 * usefully.
 *
 * These are PARAMETERISED REPLACEABLE (30000-39999) with the record's own id in
 * the `d` tag, so correcting a screening is a re-publish rather than a deletion
 * request that a relay may ignore. Cancellation is an edit, which sidesteps the
 * fact that erasure on a relay is only advisory.
 */

/** NIP-52 time-based calendar event: a screening at a specific moment. */
export const KIND_TIME_BASED_EVENT = 31923;
/** NIP-52 date-based calendar event: an all-day entry with no clock time. */
export const KIND_DATE_BASED_EVENT = 31922;

export interface CalendarEventInput {
  /** Stable id from the source record — becomes the `d` tag, so edits replace. */
  id: string;
  title: string;
  summary?: string | null;
  /** Unix seconds. */
  start: number;
  end?: number | null;
  location?: string | null;
  image?: string | null;
  /** Free-form labels, e.g. "kino", "fsk-12". Published as `t` tags. */
  labels?: string[];
  /** True when the entry has no clock time. */
  allDay?: boolean;
}

/**
 * Build a signed calendar event.
 *
 * Deliberately carries only what a listing needs — title, time, place, image.
 * Contact details and anything personal stay in the node: erasure here is
 * advisory, so what must be erasable must never be in the payload.
 */
export function buildCalendarEvent(
  secretKey: Uint8Array,
  input: CalendarEventInput,
  options: { createdAt?: number } = {},
): NostrEvent {
  const kind = input.allDay ? KIND_DATE_BASED_EVENT : KIND_TIME_BASED_EVENT;

  const tags: string[][] = [
    ["d", input.id],
    ["title", input.title],
    ["start", String(input.start)],
  ];
  if (input.end) tags.push(["end", String(input.end)]);
  if (input.location) tags.push(["location", input.location]);
  if (input.image) tags.push(["image", input.image]);
  for (const label of input.labels ?? []) tags.push(["t", label]);

  return buildEvent(secretKey, kind, input.summary?.trim() ?? "", {
    createdAt: options.createdAt,
    tags,
  });
}

/** Read a calendar event back into its fields. Returns null if it is not one. */
export function parseCalendarEvent(event: NostrEvent): CalendarEventInput | null {
  if (event.kind !== KIND_TIME_BASED_EVENT && event.kind !== KIND_DATE_BASED_EVENT) return null;
  const tag = (name: string) => event.tags.find((t) => t[0] === name)?.[1];
  const id = tag("d");
  const title = tag("title");
  const start = Number(tag("start"));
  if (!id || !title || !Number.isFinite(start)) return null;

  return {
    id,
    title,
    summary: event.content || null,
    start,
    end: tag("end") ? Number(tag("end")) : null,
    location: tag("location") ?? null,
    image: tag("image") ?? null,
    labels: event.tags.filter((t) => t[0] === "t").map((t) => t[1]),
    allDay: event.kind === KIND_DATE_BASED_EVENT,
  };
}
