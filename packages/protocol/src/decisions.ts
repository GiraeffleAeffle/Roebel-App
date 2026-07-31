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
