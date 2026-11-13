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
const rim = (x: number) => Math.sqrt(Math.max(1 - x * x, 0));
const top = (x: number) => sleepyTarget(x, rim(x))[1];
/** The lower edge at `x`. */
const bottom = (x: number) => sleepyTarget(x, -rim(x))[1];

/** The shape's height/width as it lands on screen, given the mesh's non-uniform scale. */
function screenAspect(widthUnits: number, heightUnits: number): number {
  const width = widthUnits * (ASTRO_V2_EYE.width / 2);
  const height = heightUnits * (ASTRO_V2_EYE.height / 2);
  return height / width;
}

describe("the asleep eye", () => {
  it("has a flat lid: the upper edge is a straight line across the whole eye", () => {
    for (const x of [0, 0.3, 0.6, 0.9]) {
      expect(top(x)).toBeCloseTo(top(0), 6);
    }
  });

  it("is a bowl: the lower edge is deepest in the middle and rises toward the ends", () => {
    expect(bottom(0)).toBeLessThan(bottom(0.6));
    expect(bottom(0.6)).toBeLessThan(bottom(0.95));
    /* Never below its own lid, and never inverted into a lens. */
    for (const x of [0, 0.4, 0.8, 0.95]) {
      expect(bottom(x)).toBeLessThan(top(x));
    }
  });

  it("rounds off the ends instead of ending in needle points", () => {
    const thickness = (x: number) => top(x) - bottom(x);
    expect(thickness(0.99)).toBeGreaterThan(0);
    expect(thickness(0.99)).toBeLessThan(thickness(0) * 0.4);
  });

  it("lands on the drawing's ~3.8 : 1 aspect on screen", () => {
    /* Both axes of the mesh are scaled differently, so this is the assertion that ties the
       geometry back to the drawing: ~115 px wide, ~30 px deep. */
    const halfWidth = sleepyTarget(1, 0)[0];
    const aspect = screenAspect(2 * halfWidth, top(0) - bottom(0));

    expect(1 / aspect).toBeGreaterThan(3.3);
    expect(1 / aspect).toBeLessThan(4.4);
  });

  it("is symmetric in x, so one geometry can serve both eyes", () => {
    expect(sleepyTarget(-0.6, -0.8)[1]).toBeCloseTo(sleepyTarget(0.6, -0.8)[1], 10);
    expect(sleepyTarget(-0.6, 0.8)[1]).toBeCloseTo(sleepyTarget(0.6, 0.8)[1], 10);
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
