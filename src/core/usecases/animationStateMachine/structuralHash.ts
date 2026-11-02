/**
 * "Did this edit change the structure, or only a number?"
 *
 * §4.5 splits the two: numeric tuning is applied hot where the runtime reads it per frame,
 * while a structural edit rebuilds the machine (pause → rebuild → resume at the current
 * inputs). The header says `rebuilt` for 2 s so the reset is never a surprise.
 *
 * The hash is a *shallow* structural digest: it drops the numeric fields the runtime reads
 * per frame and keeps everything that changes the shape of the machine. It is computed on a
 * commit, not per keystroke.
 */

import type { MachineDefinition } from "@core/models/animationStateMachine.ts";

/** Fields whose value the runtime reads per frame (or that only affect speed/timing). */
const NUMERIC_FIELDS = new Set([
  "duration",
  "exitTime",
  "entryFade",
  "exitFade",
  "weight",
  "speed",
  "timeScale",
  "speedCurve",
  "exitEasing",
  "easing",
  "fade",
  "offset",
  "scale",
]);

/** Keys per object, sorted, with numbers and strings stringified — order-independent. */
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value == null || typeof value !== "object") return value;
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(value as Record<string, unknown>).sort()) {
    if (NUMERIC_FIELDS.has(key)) continue;
    const entry = (value as Record<string, unknown>)[key];
    if (entry === undefined) continue;
    out[key] = canonical(entry);
  }
  return out;
}

/** A stable string: equal structures hash equal, and the hash is the "did it change" key. */
export function structuralHash(definition: MachineDefinition): string {
  return JSON.stringify(canonical(definition));
}

/**
 * A command classified for the rebuild rule.
 *
 * `"numeric"` means the runtime can pick the change up without a rebuild; anything else is
 * structural. The classification is deliberately conservative — a wrong `"numeric"` ships a
 * stale machine, a wrong `"structural"` costs one rebuild.
 */
export function classifyChange(
  before: MachineDefinition,
  after: MachineDefinition,
): "numeric" | "structural" {
  return structuralHash(before) === structuralHash(after) ? "numeric" : "structural";
}
