/**
 * Astro's page-side interaction — pure, no React, no three, no timers.
 *
 * The character has three things the page can ask about, and they are deliberately
 * three small functions rather than one state machine:
 *
 *   1. **What a tap does to the face.** A tap is a greeting, not a mood: an awake
 *      character is briefly `happy`, and a sleeping one wakes one notch
 *      (`deep-sleep` → `sleep` → `doze` → `idle`). A tap that arrives *during* a
 *      reaction is ignored, because stacking reactions is how a character starts
 *      looking broken.
 *   2. **Where a tap sends the playhead.** A quarter of the clip forward, wrapped.
 *      Deterministic on purpose: `/float` scatters its sphere to a random point
 *      because a sphere is a puzzle piece, but a character that teleports to a
 *      random spot loses its footing. A quarter-turn is enough to prove that taps
 *      move the rig, and small enough that the character never runs off the page.
 *   3. **What the log says.** Same shape as the float log — a bounded list, an
 *      ordinal per row, and a one-line summary — because the two pages are the same
 *      demonstration with a different subject.
 *
 * Nothing here reads the store or the sheet; the page owns both.
 */

import { ASTRO_COLOURS } from "@core/models/astro.ts";
import type { AstroExpression } from "@core/models/astro.ts";
import { isTransient, wakeUp } from "@core/usecases/astroExpression.ts";

/** What a tap appends to the log. */
export const ASTRO_HIT_MESSAGE = "you found me!";

/** Rows kept before the oldest is dropped. Matches the float log. */
export const MAX_HITS = 40;

/**
 * What a tap can roll into the bar's accent.
 *
 * `/float` rolls a hue, because a bouncy sphere on a demo page can be any colour.
 * Astro cannot: the stylesheet prints six values and the body is a three-stop
 * gradient between three of them, so a draw here picks one of the body's own
 * poles. A cyan Nudge button would be a colour the character does not have.
 */
export const ASTRO_ACCENTS = [
  ASTRO_COLOURS.bodyTop,
  ASTRO_COLOURS.bodyMid,
  ASTRO_COLOURS.bodyBottom,
  ASTRO_COLOURS.glow,
] as const;

/** One draw from `ASTRO_ACCENTS`, injected-random so the roll stays testable. */
export function rollAstroAccent(random: () => number = Math.random): string {
  const raw = Math.min(Math.max(random(), 0), 0.999999);
  const index = Math.floor(raw * ASTRO_ACCENTS.length);
  return ASTRO_ACCENTS[index] ?? ASTRO_COLOURS.bodyMid;
}

/** One row of the tap log. */
export type AstroHit = {
  readonly id: number;
  readonly text: string;
  readonly playhead: number;
  readonly expression: AstroExpression;
};

export type AstroHitLog = {
  readonly rows: readonly AstroHit[];
  readonly count: number;
};

export const EMPTY_ASTRO_HIT_LOG: AstroHitLog = { rows: [], count: 0 };

/**
 * Append a tap.
 *
 * `count` is the lifetime total and never resets, so the readout says "how many
 * times have you poked it" after the list has started dropping rows. Ids are the
 * lifetime total too, which is what makes two rows distinguishable as keys even
 * when their playheads are identical.
 */
export function appendAstroHit(
  log: AstroHitLog,
  playhead: number,
  expression: AstroExpression,
): AstroHitLog {
  const id = log.count + 1;
  const row: AstroHit = {
    id,
    text: ASTRO_HIT_MESSAGE,
    playhead: Number.isFinite(playhead) ? playhead : 0,
    expression,
  };
  const rows = [row, ...log.rows].slice(0, MAX_HITS);
  return { rows, count: id };
}

/** One line under the table. */
export function astroHitSummary(log: AstroHitLog): string {
  if (log.count === 0) return "No taps yet — the character is waiting.";
  const last = log.rows[0];
  const label = last == null ? "" : ` · last: ${last.expression}`;
  return `${log.count} ${log.count === 1 ? "tap" : "taps"}${label}`;
}

/**
 * The expression a tap produces.
 *
 * Resting states react: asleep wakes one notch, everything else says `happy`.
 * A transient state is already a reaction, so the tap is a no-op — letting a tap
 * retrigger `happy` would restart its timer on every poke and the character would
 * hold a single expression for as long as the user kept tapping.
 */
export function hitReaction(current: AstroExpression): AstroExpression {
  if (isTransient(current)) return current;
  if (current === "doze" || current === "sleep" || current === "deep-sleep") {
    return wakeUp(current);
  }
  return "happy";
}

/**
 * Where a tap moves the playhead: a quarter of the clip forward, wrapped.
 *
 * `length` is the sheet's sequence length in seconds. A sheet with no length (a
 * state file where the rig never landed) returns `0` rather than `NaN`, because a
 * seek to `NaN` silently freezes the playhead instead of erroring.
 */
export function nextAstroSeek(length: number, from: number): number {
  if (!Number.isFinite(length) || length <= 0) return 0;
  const start = Number.isFinite(from) ? from : 0;
  const quarter = length / 4;
  const next = (start % length) + quarter;
  return next % length;
}
