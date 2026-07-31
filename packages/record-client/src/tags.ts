import type { RecordEvent } from "./client";

/** The first value of the first tag named `name`, or `null` if absent. */
export function tagValue(ev: RecordEvent, name: string): string | null {
  return ev.tags.find((t) => t[0] === name)?.[1] ?? null;
}

/** Every first-value of every tag named `name`, in tag order. */
export function tagValues(ev: RecordEvent, name: string): string[] {
  return ev.tags.filter((t) => t[0] === name).map((t) => t[1]).filter((v): v is string => v !== undefined);
}

/** The event's `d` tag — the stable identity of a replaceable/CMS record. */
export function dTag(ev: RecordEvent): string | null {
  return tagValue(ev, "d");
}

/**
 * The `d` tag's value after a known `prefix:` — e.g. `dSuffix(ev, "event")`
 * turns `["d", "event:123"]` into `"123"`. `null` if there is no `d` tag or
 * it does not start with `prefix:`.
 */
export function dSuffix(ev: RecordEvent, prefix: string): string | null {
  const d = dTag(ev);
  if (d === null) return null;
  const marker = `${prefix}:`;
  return d.startsWith(marker) ? d.slice(marker.length) : null;
}
