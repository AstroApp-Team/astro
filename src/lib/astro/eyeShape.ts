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
 * axis is `1.9×` denser than x, which is why the sleeping bowl below is a third of a unit
 * deep and still reads as a wide, shallow `U` rather than as a round eye.
 *
 * ## The shapes are the sheet's, not a moodboard's
 *
 * The stylesheet draws two closed eyes and they are different shapes, not two weights
 * of one:
 *
 *   - **happy** is an arch: `∩`, drawn up at the middle, ~2:1 wide.
 *   - **asleep** is a **bowl**: a flat top edge and a rounded belly, an open `U` like a
 *     contented closed eye — `115 × 30` on the sheet's drawing of him sleeping, ~3.8 : 1.
 *     It is not a lens with two pointed ends and not a bar: the flat lid on top is what
 *     says "closed", and the soft curve under it is what says "relaxed".
 */

/**
 * The bowl's depth at its middle, in geometry units.
 *
 * The mesh scales y by `ASTRO_V2_EYE.height / 2` (~0.084 world units per unit), so `0.36`
 * is ~0.030 world units: `30 / 1090` of the body, the proportion of the drawing. With the
 * wider `DASH_WIDEN` below it makes the ~3.8 : 1 shape the drawing has.
 */
const BOWL_DEPTH = 0.36;

/**
 * The bowl's depth at its tips — small but not zero, so the ends are rounded off instead of
 * being needle points. In geometry units; ~0.008 world units, about a pixel on a phone.
 */
const BOWL_TIP = 0.1;

/**
 * How much wider the closed eye is than the open one.
 *
 * The open eye is a narrow vertical oval (`58 / 833`); the sleeping bowl is `115 / 1090`
 * of the body, a little wider than the open eye is tall. `1.32` takes the unit circle's
 * half-width of 1 to the ~0.058 world units that is.
 */
const DASH_WIDEN = 1.32;

/** Where the flat lid sits, so the bowl hangs symmetrically about the eye line. */
const BOWL_TOP = BOWL_DEPTH / 2;

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
 * The sleeping target: a bowl, `U`-shaped and open at the top, flat lid above and a smooth
 * belly below.
 *
 * `x, y` are a point on the unit circle (or the cap's centre). The shape keeps every point's
 * *fraction* of the way down its own vertical chord, `v`, so the top rim (`v = 1`) lands on
 * one straight line and the bottom rim (`v = 0`) lands on the belly curve below it:
 *
 *   - the belly is `BOWL_TIP + (BOWL_DEPTH - BOWL_TIP) · √(1 - x²)`, a half-ellipse,
 *     deepest in the middle and rounding off at the ends;
 *   - the lid is flat at `BOWL_TOP`, so the top edge never moves with the curve.
 *
 * Symmetric in `x`, which is what lets one geometry serve both eyes unmirrored.
 */
export function sleepyTarget(x: number, y: number): [number, number] {
  const chord = Math.sqrt(Math.max(1 - x * x, 0));
  /* At the tips the chord has no length and `y / chord` is noise: the tip sits mid-depth. */
  const v = chord < 1e-3 ? 0.5 : (y / chord + 1) / 2;
  const depth = BOWL_TIP + (BOWL_DEPTH - BOWL_TIP) * chord;
  return [x * DASH_WIDEN, BOWL_TOP - depth * (1 - v)];
}
