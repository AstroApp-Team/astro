/**
 * The two eye shapes the prism morphs into, as geometry-space functions.
 *
 * Kept out of `eyeGeometry.ts` (which needs `three` to build buffers) so the shapes can
 * be asserted in a Node test: the difference between the sheet's asleep eye and a
 * rectangle is the whole point of this file, and "it looked right in a screenshot" is
 * not a test.
 *
 * ## The space
 *
 * The eye is a unit cylinder rotated onto the view axis: `x, y` on the unit circle,
 * `z ∈ [-0.5, 0.5]`. The mesh then scales by `ASTRO_V2_EYE.width / 2`,
 * `ASTRO_V2_EYE.height / 2` and the depth — so **one geometry unit is not the same
 * number of pixels in x and y**, and a shape's on-screen aspect is not its aspect here.
 * With the shipped numbers (`0.0498` and `0.0953` world units per geometry unit) the y
 * axis is `1.9×` denser than x, which is why the dash below is a third of a unit tall
 * and still reads as the sheet's sliver rather than as a hairline.
 *
 * ## The shapes are the sheet's, not a moodboard's
 *
 * The stylesheet draws two closed eyes and they are different shapes, not two weights
 * of one:
 *
 *   - **happy** is an arch: `∩`, drawn up at the middle, ~2:1 wide.
 *   - **asleep** is a **lens**: `90 × 28.7` with the ends tapering to points, a nearly
 *     flat top edge, and a bottom edge that sags *downward* in the middle. Drawn as a
 *     flat bar it reads as a dash; that is the bug this file fixes, and the sag is what
 *     makes it read as a closed eyelid.
 */

/**
 * Half the sliver's thickness at its middle, in geometry units.
 *
 * Chosen from the sheet rather than by eye, and the arithmetic is worth keeping because the
 * two axes are not the same size. The dash's on-screen bbox should be `28.7 / 90 = 0.319`
 * of its own width; the shape is `2.04` units wide and `2 · DASH_HALF + DASH_DROOP = 0.34`
 * units tall, and the mesh scales those by `0.0498` and `0.0953` world units respectively —
 * `0.0324 / 0.1016 = 0.319`, exactly the sheet's ratio, and `3.3 px` of sliver on a 111 px
 * phone body.
 *
 * (It used to be `0.14 · y`: the right height, the wrong shape — a rectangle, which reads
 * as a dash rather than as a closed eye.)
 */
const DASH_HALF = 0.12;

/**
 * How far the **lower** edge sags in the middle, in geometry units.
 *
 * Applied to the lower rim only (`(1 - y) / 2`): a bar whose two edges bow together reads
 * as a dash that slid down, while the sheet's eyelid has a top edge that stays put. `0.10`
 * is `42%` of the sliver's full thickness — enough to see the curve at phone size, where
 * the sag is about a pixel and a half on a 2× screen.
 */
const DASH_DROOP = 0.1;

/** How much thinner the ends are than the middle, as a fraction of `DASH_HALF`. */
const DASH_TAPER = 0.4;

/** The pair's dash is `180 / 148` wider than the open pair, so the shape widens with it. */
const DASH_WIDEN = 1.02;

/**
 * The crescent target: an up-curved arch, `∩`.
 *
 * `0.45 · y` squashes the prism; `0.5 · (1 - x²)` lifts the middle into the arch and
 * `-0.15` sinks the whole shape to the sheet's happy eye line. Symmetric in `x`, which is
 * what lets one geometry serve both eyes unmirrored.
 */
export function happyTarget(x: number, y: number): [number, number] {
  return [x * 1.06, 0.45 * y + 0.5 * (1 - x * x) - 0.15];
}

/**
 * The dash target: the sheet's asleep eye, a lens with a sagging lower edge.
 *
 * Three terms, in the order they matter:
 *
 * 1. `DASH_HALF · y` is the sliver's thickness.
 * 2. `(1 - DASH_TAPER · x²)` tapers it: full thickness at the middle, `0.6` of it at the
 *    tips, which is what makes the ends read as points instead of as a cut-off bar.
 * 3. `-DASH_DROOP · (1 - x²) · (1 - y) / 2` is the sag — zero at the top rim and at both
 *    tips, strongest at the middle of the bottom rim.
 *
 * `y` is the *rest* position, so the weights are independent of each other and the shader
 * can blend `happy` and `sleepy` at once without the shapes fighting.
 */
export function sleepyTarget(x: number, y: number): [number, number] {
  const thickness = DASH_HALF * y * (1 - DASH_TAPER * x * x);
  const sag = -DASH_DROOP * (1 - x * x) * ((1 - y) / 2);
  return [x * DASH_WIDEN, thickness + sag];
}
