/**
 * Astro's blink — pure timing, no three, no React.
 *
 * A blink is the asleep eye (`sleepyTarget`, the open `U`) shown for a moment: the same
 * morph the sleeping face uses, driven from `0` to `1` and back in about a third of a second.
 * Reusing it is the point — it keeps the blink the exact shape of his closed eye, and there
 * is no second "lid" to keep in step with it.
 *
 * Kept out of the frame loop so the rhythm can be asserted in Node: "he blinks every few
 * seconds, now and then twice in a row" is a claim about numbers, not about a screenshot.
 */

/** How long one blink takes, closing and opening, in seconds. */
export const BLINK_DURATION_S = 0.3;

/** The share of the blink spent closing. Eyes close faster than they open. */
const CLOSING_SHARE = 0.4;

/** Seconds between blinks: a person blinks every 2–6 s, and a mascot that blinks faster twitches. */
export const BLINK_INTERVAL_S = { min: 2.4, max: 6 } as const;

/** The chance a blink is followed straight away by a second one. */
export const DOUBLE_BLINK_CHANCE = 0.2;

/** The gap before that second blink, in seconds. */
export const DOUBLE_BLINK_GAP_S = 0.4;

/**
 * How far past the asleep shape the blink closes at its deepest.
 *
 * `1` is exactly the sleeping eye, and a blink that stops there reads as barely closing,
 * because the eye is moving *to* that shape from a tall oval. The morph is linear in its
 * weight, so going past `1` keeps extrapolating the same way: the bowl gets flatter and
 * shallower. `1.05` takes the bowl's middle from `0.36` to ~`0.28` geometry units deep — a
 * lid pressed a little shut. The lid line tilts by ~`0.03` units at this weight, well under a
 * pixel at phone size, so it still reads as flat.
 */
export const BLINK_PEAK = 1.05;

/** Smooth `0 → 1` ramp with no kink at either end. */
const smooth = (t: number) => t * t * (3 - 2 * t);

/**
 * How closed the eye is, `elapsed` seconds into a blink: `0` open, `1` the asleep shape, and
 * `BLINK_PEAK` at the deepest point. Outside the blink it is `0`.
 */
export function blinkWeight(elapsed: number): number {
  if (elapsed <= 0 || elapsed >= BLINK_DURATION_S) return 0;

  const closing = BLINK_DURATION_S * CLOSING_SHARE;
  if (elapsed < closing) return BLINK_PEAK * smooth(elapsed / closing);
  return BLINK_PEAK * smooth(1 - (elapsed - closing) / (BLINK_DURATION_S - closing));
}

/**
 * Seconds until the next blink, from two uniform `[0, 1)` draws.
 *
 * Taking the draws as arguments keeps this pure: the caller passes `Math.random()`, the test
 * passes numbers.
 */
export function nextBlinkDelay(interval: number, double: number): number {
  if (double < DOUBLE_BLINK_CHANCE) return DOUBLE_BLINK_GAP_S;
  return BLINK_INTERVAL_S.min + interval * (BLINK_INTERVAL_S.max - BLINK_INTERVAL_S.min);
}
