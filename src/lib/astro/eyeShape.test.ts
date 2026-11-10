import { describe, expect, it } from "vite-plus/test";

import { ASTRO_V2_EYE } from "./astroV2.ts";
import { happyTarget, sleepyTarget } from "./eyeShape.ts";

/**
 * The eye shapes, asserted in the space they are built in.
 *
 * The reason this file exists at all: "the asleep eye should curve downward" is a claim about
 * a shape, and the shape is a pure function. A screenshot can be wrong in ways that look like
 * a shader bug — the dash was a rectangle for a whole round of review and the render was
 * never at fault.
 */

/** The upper edge of the sliver at `x`, in geometry units. */
const top = (x: number) => sleepyTarget(x, 1)[1];
/** The lower edge at `x`. */
const bottom = (x: number) => sleepyTarget(x, -1)[1];

/** The shape's height/width as it lands on screen, given the mesh's non-uniform scale. */
function screenAspect(widthUnits: number, heightUnits: number): number {
  const width = widthUnits * (ASTRO_V2_EYE.width / 2);
  const height = heightUnits * (ASTRO_V2_EYE.height / 2);
  return height / width;
}

describe("the asleep eye", () => {
  it("sags in the middle of its lower edge instead of being a bar", () => {
    /* The sheet's eyelid droops: the middle of the lower edge is well below the tips. */
    expect(bottom(0)).toBeLessThan(bottom(0.9));
    expect(bottom(0.9) - bottom(0)).toBeGreaterThan(0.1);
  });

  it("keeps the upper edge far straighter than the lower one", () => {
    /*
     * The asymmetry is the shape. A bar whose *both* edges bow together reads as a dash that
     * slid down the face; an eyelid is a lid, i.e. one edge stays and the other closes past
     * it. So the top edge must move less than half as much as the bottom over the same span.
     */
    const topSag = top(0) - top(0.9);
    const bottomSag = bottom(0.9) - bottom(0);

    expect(topSag).toBeGreaterThan(0);
    expect(topSag).toBeLessThan(bottomSag / 2);
  });

  it("tapers to points at the ends", () => {
    const thickness = (x: number) => top(x) - bottom(x);

    expect(thickness(0.5)).toBeLessThan(thickness(0));
    expect(thickness(0.96)).toBeLessThan(thickness(0.5));
    expect(thickness(0.96)).toBeLessThan(thickness(0) * 0.5);
  });

  it("lands on the sheet's 28.7 : 90 aspect on screen", () => {
    /* Both axes of the mesh are scaled differently, so this is the only assertion that ties
       the geometry back to the drawing. `28.7 / 90` is the sheet's own ratio. */
    const halfWidth = sleepyTarget(1, 0)[0];
    const aspect = screenAspect(2 * halfWidth, top(0) - bottom(0));

    expect(aspect).toBeCloseTo(28.7 / 90, 1);
  });

  it("is symmetric in x, so one geometry can serve both eyes", () => {
    expect(sleepyTarget(-0.6, -1)[1]).toBeCloseTo(sleepyTarget(0.6, -1)[1], 10);
    expect(sleepyTarget(-0.6, 1)[1]).toBeCloseTo(sleepyTarget(0.6, 1)[1], 10);
  });
});

describe("the happy eye", () => {
  it("arches upward, which is the opposite of the asleep sag", () => {
    /* `∩` at the middle, the sheet's closed-content eye. */
    expect(happyTarget(0, 1)[1]).toBeGreaterThan(happyTarget(0.9, 1)[1] + 0.2);
  });

  it("is symmetric in x as well", () => {
    expect(happyTarget(-0.5, 1)[1]).toBeCloseTo(happyTarget(0.5, 1)[1], 10);
  });
});
