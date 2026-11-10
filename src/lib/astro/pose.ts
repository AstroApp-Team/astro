/**
 * Astro v2's face — expression in, eye pose out. Pure.
 *
 * v1 gets a face by swapping a texture: twelve drawings, twelve poses, and "look at
 * the pointer" had to be quantised to the sheet's seven placements because
 * interpolating a *drawing* produces positions the sheet never draws. v2 has eyes
 * that are geometry, so the same expression is a small set of continuous numbers —
 * a morph weight, an eye height, and a look vector — and those numbers can be
 * interpolated. The sheet stays the reference for where "looking right" *is*; it just
 * no longer bounds what the eyes can do between two of its placements.
 *
 * `look` comes back in `[-1, 1]` on both axes, where `1` is the sheet's most extreme
 * placement (`225.5 / 833` of the diameter) and the scene scales it by
 * `ASTRO_V2_LOOK_RANGE`. Keeping the normalisation here means the scene has no
 * opinion about the sheet's units, and the pure test can assert on `±1` instead of on
 * world coordinates.
 */

import { ASTRO_EXPRESSIONS, type AstroExpression, type AstroFeature } from "./astro.ts";

/** The sheet's furthest eye midpoint: `225.5 / 833`. Anything at or past it is `±1`. */
const LOOK_NORMALISER = 225.5 / 833;

/** How the eye prism is deformed for a state. Weights, not shapes: the morph targets live in the geometry. */
export type AstroEyePose = {
  /** `0..1` blend toward the crescent morph (`happy`). */
  happy: number;
  /** `0..1` blend toward the flattened dash morph (`doze`/`sleep`/`deep-sleep`). */
  sleepy: number;
  /** Vertical stretch. `alert` and `wonder` open the eyes wider; the sheet's `111` is already tall. */
  stretch: number;
  /** Where the pair sits, in sheet-normalised units. `1` is the furthest placement. */
  look: { x: number; y: number };
};

/** The feature → morph weight mapping. `open` is the neutral prism. */
const MORPH_BY_FEATURE: Record<AstroFeature, Pick<AstroEyePose, "happy" | "sleepy">> = {
  open: { happy: 0, sleepy: 0 },
  happy: { happy: 1, sleepy: 0 },
  dash: { happy: 0, sleepy: 1 },
};

/** States whose eyes are drawn taller than `idle`'s. */
const STRETCHED: ReadonlySet<AstroExpression> = new Set(["alert", "wonder", "think-left"]);

const clampUnit = (value: number) => Math.min(1, Math.max(-1, value));

/**
 * The pose for an expression.
 *
 * `look` is the sheet's own midpoint (sign-flipped: the sheet's y is down), so
 * "look-left" moves the pair exactly as far left as the drawing does. The pointer
 * adds to this in the scene rather than replacing it, which is what makes a resting
 * `look-left` still resume when the mouse leaves.
 */
export function resolveEyePose(expression: AstroExpression): AstroEyePose {
  const spec = ASTRO_EXPRESSIONS[expression];
  const morph = MORPH_BY_FEATURE[spec.feature];

  return {
    happy: morph.happy,
    sleepy: morph.sleepy,
    stretch: STRETCHED.has(expression) ? 1.14 : 1,
    look: {
      x: clampUnit(spec.midpointX / LOOK_NORMALISER),
      y: clampUnit(-spec.midpointY / LOOK_NORMALISER),
    },
  };
}

/**
 * The pose after the pointer has had its say.
 *
 * `pointer` is a direction of attention in `[-1, 1]` on both axes (`(0, 0)` is the
 * middle of the viewport). A resting face follows it; a reaction or a sleep state
 * does not, for the same reason as v1 — the first mouse move must not undo a
 * reaction the user just triggered.
 *
 * The result is clamped, not normalised: a diagonal pull must not move the pair
 * further from the centre than a straight one, and clamping both axes independently
 * would do exactly that at the corners. The clamp is therefore radial.
 */
export function followPointer(
  pose: AstroEyePose,
  pointer: { x: number; y: number } | null,
  follows: boolean,
): AstroEyePose {
  if (pointer == null || !follows) return pose;

  /*
   * Gain 1, not 0.8: with the pointer already normalised to `[-1, 1]` across the
   * viewport, 0.8 meant the eyes only reached 80 % of their travel even with the cursor
   * in a corner — the rig read that as "stays too close to the centre". The radial clamp
   * below still keeps a diagonal from going past the unit circle, so full gain does not
   * cost any safety; it only removes a second, hidden shrink.
   */
  const x = pose.look.x + pointer.x;
  const y = pose.look.y + pointer.y;
  const length = Math.hypot(x, y);
  const scale = length > 1 ? 1 / length : 1;

  return { ...pose, look: { x: x * scale, y: y * scale } };
}

/** Does this state follow the pointer? Mirrors v1's `POINTER_FOLLOW_STATES`, stated once. */
export function followsPointer(expression: AstroExpression): boolean {
  const spec = ASTRO_EXPRESSIONS[expression];
  return !spec.transient && spec.feature !== "dash";
}

/** Which of the 12 states read as "the eyes are closed". Used by the page's copy. */
export function isAsleep(expression: AstroExpression): boolean {
  return resolveEyePose(expression).sleepy >= 1;
}
