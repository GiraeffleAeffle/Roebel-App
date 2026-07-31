import { z } from "zod";

/**
 * NSP-12 — the Public Decision Record grammar.
 *
 * The EIP-1/EIP-7723 pipeline mapped to German civic stages. This module is
 * the single source of truth for stage names, transition legality and the
 * NSP-12 kind numbers; the publisher and (later) the editor-agent, explorer
 * and coordinator all import from here rather than re-encoding the table.
 * See docs/superpowers/specs/2026-07-31-nsp12-public-decision-record-design.md §2–§3.
 */

export const STAGES = [
  "idee", "entwurf", "diskussion", "meinungsbild", "beschlussvorlage",
  "beschlossen", "abgelehnt", "umgesetzt", "ruhend", "zurueckgezogen",
] as const;
export type Stage = (typeof STAGES)[number];
export const StageSchema = z.enum(STAGES);

/**
 * Legal hops, keyed by current stage. `beschlossen`/`abgelehnt` are entered
 * only by mirroring a signed civic notice (enforced in the transition schema,
 * not here — this table is pure stage topology).
 */
export const ALLOWED_TRANSITIONS: Record<Stage, readonly Stage[]> = {
  idee: ["entwurf", "zurueckgezogen"],
  entwurf: ["diskussion", "ruhend", "zurueckgezogen"],
  diskussion: ["meinungsbild", "beschlussvorlage", "ruhend", "zurueckgezogen"],
  meinungsbild: ["beschlussvorlage", "diskussion", "zurueckgezogen"],
  beschlussvorlage: ["beschlossen", "abgelehnt", "zurueckgezogen"],
  beschlossen: ["umgesetzt"],
  abgelehnt: [],
  umgesetzt: [],
  ruhend: ["entwurf", "zurueckgezogen"],
  zurueckgezogen: [],
};

export function isLegalTransition(from: string, to: string): boolean {
  const targets = ALLOWED_TRANSITIONS[from as Stage];
  return !!targets && (targets as readonly string[]).includes(to);
}

/** Who may sign a transition INTO each stage (spec §2). Enforcement of
 * signer→role resolution needs the membership registry and ships with the
 * editor-agent slice; this table is exported so every consumer reads one map. */
export type Role = "author" | "editor-agent" | "facilitator" | "implementer" | "body-mirror";
export const STAGE_MOVERS: Record<Stage, readonly Role[]> = {
  idee: [],
  entwurf: ["editor-agent"],
  diskussion: ["author"],
  meinungsbild: ["facilitator"],
  beschlussvorlage: ["implementer"],
  beschlossen: ["body-mirror"],
  abgelehnt: ["body-mirror"],
  umgesetzt: ["implementer"],
  ruhend: ["editor-agent"],
  zurueckgezogen: ["author"],
};

/** NSP-12 kind numbers, claimed. The publisher's mappers.ts aliases these —
 * one registry, no drifting literals. Spec §3. */
export const DECISION_KINDS = {
  head: 32100, transition: 2100, meeting: 32103,
  meinungsbild: 32104, impact: 32105, cycle: 32106,
} as const;

const HEX64 = /^[0-9a-f]{64}$/;

/** Canonical addressable reference to a proposal head. Addresses, never event
 * ids: replaceable-event id links go stale (spec §3, hard rule). */
export function headAddress(pubkeyHex: string, proposalId: string): string {
  return `${DECISION_KINDS.head}:${pubkeyHex}:proposal:${proposalId}`;
}

export interface DecisionEventLike {
  kind: number;
  tags: string[][];
  content: string;
  created_at: number;
}

export interface ParsedTransition {
  head: string;
  from: Stage;
  to: Stage;
  /** Address of the kind-32102 civic notice this transition mirrors. */
  notice: string | null;
  reason: string;
  createdAt: number;
}

const headAddressPattern = new RegExp(`^${DECISION_KINDS.head}:[0-9a-f]{64}:proposal:.+$`);
const noticeAddressPattern = /^32102:[0-9a-f]{64}:.+$/;

/** Stages a proposal may only enter by citing the formal body's signed notice (spec §2). */
const NOTICE_GATED: readonly Stage[] = ["beschlossen", "abgelehnt"];

export function safeParseTransition(
  ev: DecisionEventLike,
): { ok: true; value: ParsedTransition } | { ok: false; error: string } {
  if (ev.kind !== DECISION_KINDS.transition) {
    return { ok: false, error: `expected kind ${DECISION_KINDS.transition}, got ${ev.kind}` };
  }
  const heads = ev.tags.filter((t) => t[0] === "a" && t[3] === "proposal");
  if (heads.length !== 1) return { ok: false, error: `expected exactly one proposal a-tag, got ${heads.length}` };
  const head = heads[0][1] ?? "";
  if (!headAddressPattern.test(head)) return { ok: false, error: `malformed head address: ${head}` };

  const tag = (name: string) => ev.tags.find((t) => t[0] === name)?.[1];
  const from = StageSchema.safeParse(tag("from"));
  const to = StageSchema.safeParse(tag("to"));
  if (!from.success || !to.success) return { ok: false, error: "from/to must be valid stages" };
  if (!isLegalTransition(from.data, to.data)) {
    return { ok: false, error: `illegal transition ${from.data} → ${to.data}` };
  }

  const noticeTag = ev.tags.find((t) => t[0] === "a" && t[3] === "notice");
  const notice = noticeTag?.[1] ?? null;
  if (NOTICE_GATED.includes(to.data)) {
    if (!notice || !noticeAddressPattern.test(notice)) {
      return { ok: false, error: `${to.data} requires a kind-32102 civic-notice citation` };
    }
  }

  return {
    ok: true,
    value: { head, from: from.data, to: to.data, notice, reason: ev.content, createdAt: ev.created_at },
  };
}

/**
 * Validate a proposal's full transition trail (spec §3: the audit trail must
 * not be rewritable, so legality is checked over immutable events, sorted by
 * created_at). Same-second ties are broken topologically, not by input
 * order: a validator must give one answer per event set regardless of the
 * order events arrived in. NIP-01 id tie-breaks are the caller's concern
 * once events are signed.
 */
export function validateTransitionTrail(
  events: DecisionEventLike[],
): { ok: true; stage: Stage; head: string | null } | { ok: false; index: number; error: string } {
  const withIndex = events.map((ev, i) => ({ ev, i }));

  const byTime = new Map<number, { ev: DecisionEventLike; i: number }[]>();
  for (const item of withIndex) {
    const group = byTime.get(item.ev.created_at);
    if (group) group.push(item);
    else byTime.set(item.ev.created_at, [item]);
  }
  const times = [...byTime.keys()].sort((a, b) => a - b);

  /**
   * Within a same-created_at group, greedily pick next whichever event's
   * `from` tag matches the stage reached so far, keeping input order among
   * equally-eligible candidates. A group that can't be resolved this way
   * (no eligible candidate left) falls back to input order for its
   * remainder — the validation loop below then fails at the first of that
   * leftover, same as before ties were broken topologically.
   */
  const sorted: { ev: DecisionEventLike; i: number }[] = [];
  let provisionalStage = "idee";
  for (const t of times) {
    const remaining = [...byTime.get(t)!];
    while (remaining.length > 0) {
      const idx = remaining.findIndex(
        (item) => item.ev.tags.find((tg) => tg[0] === "from")?.[1] === provisionalStage,
      );
      if (idx === -1) {
        sorted.push(...remaining);
        break;
      }
      const [picked] = remaining.splice(idx, 1);
      sorted.push(picked);
      provisionalStage = picked.ev.tags.find((tg) => tg[0] === "to")?.[1] ?? provisionalStage;
    }
  }

  let stage: Stage = "idee";
  let head: string | null = null;
  for (let n = 0; n < sorted.length; n++) {
    const parsed = safeParseTransition(sorted[n].ev);
    if (!parsed.ok) return { ok: false, index: n, error: parsed.error };
    const t = parsed.value;
    if (head === null) head = t.head;
    else if (t.head !== head) return { ok: false, index: n, error: `trail mixes heads ${head} and ${t.head}` };
    if (t.from !== stage) {
      return { ok: false, index: n, error: `expected departure from ${stage}, got ${t.from}` };
    }
    stage = t.to;
  }
  return { ok: true, stage, head };
}

export const AUDIENCES = ["anwohner", "gewerbe", "vereine", "verwaltung"] as const;
export type Audience = (typeof AUDIENCES)[number];
export const CYCLE_STAGES = ["vorgeschlagen", "in-pruefung", "eingeplant", "nicht-aufgenommen"] as const;
export type CycleStage = (typeof CYCLE_STAGES)[number];

type ShapeResult = { ok: true } | { ok: false; error: string };

function dTag(ev: DecisionEventLike): string {
  return ev.tags.find((t) => t[0] === "d")?.[1] ?? "";
}
function hasTag(ev: DecisionEventLike, name: string): boolean {
  return ev.tags.some((t) => t[0] === name);
}
function shape(cond: boolean, error: string): ShapeResult {
  return cond ? { ok: true } : { ok: false, error };
}

/** 32103 — a body's meeting: agenda before, minutes/transcript pointers after. */
export function safeParseMeeting(ev: DecisionEventLike): ShapeResult {
  if (ev.kind !== DECISION_KINDS.meeting) return { ok: false, error: "wrong kind" };
  if (!/^meeting:[a-z0-9-]+:\d{4}-\d{2}-\d{2}$/.test(dTag(ev))) {
    return { ok: false, error: "d must be meeting:<body>:<YYYY-MM-DD>" };
  }
  return shape(hasTag(ev, "title"), "a meeting record needs a title tag");
}

/** 32104 — a MACI tally pointer. The advisory tag is not optional decoration:
 * a Meinungsbild that could render as a decision is a legal problem (spec §6).
 * The value is pinned, not just its presence — `["advisory","false"]` must
 * fail the same as a missing tag; the tag carries legal weight. */
export function safeParseMeinungsbild(ev: DecisionEventLike): ShapeResult {
  if (ev.kind !== DECISION_KINDS.meinungsbild) return { ok: false, error: "wrong kind" };
  if (!/^poll:.+$/.test(dTag(ev))) return { ok: false, error: "d must be poll:<id>" };
  const advisory = ev.tags.find((t) => t[0] === "advisory")?.[1];
  return shape(advisory === "true", 'the advisory tag must carry the value "true"');
}

/** 32105 — "Was bedeutet das für dich", one audience per event. The proposal
 * id embedded in `d` must match the id embedded in the cited head address —
 * otherwise an impact summary could claim one proposal's `d` while pointing
 * its head ref at another. */
export function safeParseImpact(ev: DecisionEventLike): ShapeResult {
  if (ev.kind !== DECISION_KINDS.impact) return { ok: false, error: "wrong kind" };
  const d = dTag(ev);
  const m = /^impact:proposal:(.+):([a-z]+)$/.exec(d);
  if (!m) return { ok: false, error: "d must be impact:proposal:<id>:<audience>" };
  const audience = ev.tags.find((t) => t[0] === "audience")?.[1];
  if (!audience || !(AUDIENCES as readonly string[]).includes(audience)) {
    return { ok: false, error: "audience must be one of the four groups" };
  }
  if (audience !== m[2]) return { ok: false, error: "audience tag and d suffix disagree" };
  const heads = ev.tags.filter((t) => t[0] === "a" && t[3] === "proposal");
  if (heads.length !== 1) return { ok: false, error: "an impact summary cites exactly one proposal head" };
  const headProposalId = /:proposal:(.+)$/.exec(heads[0][1] ?? "")?.[1];
  return shape(headProposalId === m[1], "impact d and head ref disagree");
}

/** 32106 — the Maßnahmenpaket. One headliner, never two (spec §5). */
export function safeParseCycle(ev: DecisionEventLike): ShapeResult {
  if (ev.kind !== DECISION_KINDS.cycle) return { ok: false, error: "wrong kind" };
  if (!/^cycle:[a-z0-9-]+$/.test(dTag(ev))) return { ok: false, error: "d must be cycle:<slug>" };
  const entries = ev.tags.filter((t) => t[0] === "a");
  for (const e of entries) {
    if (!e[3] || !(CYCLE_STAGES as readonly string[]).includes(e[3])) {
      return { ok: false, error: `cycle entry marker must be a cycle stage, got "${e[3] ?? ""}"` };
    }
  }
  const headliners = ev.tags.filter((t) => t[0] === "headliner");
  return shape(headliners.length <= 1, "at most one headliner per cycle");
}
