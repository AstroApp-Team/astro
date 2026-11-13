import { describe, expect, it } from "vite-plus/test";

import { ASTRO_V2_EYE } from "../../lib/astro/astroV2.ts";
import { eyeGeometry } from "./eyeGeometry.ts";

/**
 * The eye geometry as the shader sees it — attribute pairs, in the mesh's own scale.
 *
 * `eyeShape.test.ts` asserts the mathematics of the two outlines; this asserts the wiring,
 * which is a separate way to be wrong: the attributes are offsets (`target - position`), the
 * shader adds them scaled by `uHappy` / `uSleepy`, and the mesh stretches the result by
 * `width / 2` and `height / 2` before it is on screen. A wrong sign or a swapped attribute
 * passes every pure-function test and still puts a rectangle on his face.
 */

const position = eyeGeometry.getAttribute("position");
const happy = eyeGeometry.getAttribute("aHappy");
const sleepy = eyeGeometry.getAttribute("aSleepy");

type Weights = { happy: number; sleepy: number };

/** Where one vertex lands, in world units, once the morph and the mesh's scale apply. */
function vertex(index: number, weight: Weights) {
  const x =
    position.getX(index) + happy.getX(index) * weight.happy + sleepy.getX(index) * weight.sleepy;
  const y =
    position.getY(index) + happy.getY(index) * weight.happy + sleepy.getY(index) * weight.sleepy;

  return { x: x * (ASTRO_V2_EYE.width / 2), y: y * (ASTRO_V2_EYE.height / 2), xUnits: x };
}

/** The outline's extents in world units. */
function bounds(weight: Weights) {
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;

  for (let index = 0; index < position.count; index += 1) {
    const point = vertex(index, weight);
    minX = Math.min(minX, point.x);
    maxX = Math.max(maxX, point.x);
    minY = Math.min(minY, point.y);
    maxY = Math.max(maxY, point.y);
  }

  return { width: maxX - minX, height: maxY - minY };
}

/**
 * The lowest or highest point, restricted to a band of the shape.
 *
 * This is the assertion a screenshot is worst at: "does the lower edge bow *down in the
 * middle*" is a comparison between the middle and the ends of one edge, and the ends are a
 * few pixels wide at phone size.
 */
function extreme(weight: Weights, edge: "min" | "max", band: [number, number]) {
  let value = edge === "min" ? Infinity : -Infinity;

  for (let index = 0; index < position.count; index += 1) {
    const point = vertex(index, weight);
    if (point.xUnits < band[0] || point.xUnits > band[1]) continue;
    value = edge === "min" ? Math.min(value, point.y) : Math.max(value, point.y);
  }

  return value;
}

/** The sliver's centre line over a band — the "spine" a closed eyelid curves along. */
function spine(weight: Weights, band: [number, number]) {
  return (extreme(weight, "min", band) + extreme(weight, "max", band)) / 2;
}

const OPEN: Weights = { happy: 0, sleepy: 0 };
const HAPPY: Weights = { happy: 1, sleepy: 0 };
const ASLEEP: Weights = { happy: 0, sleepy: 1 };
const MIDDLE: [number, number] = [-0.3, 0.3];
const TIPS: [number, number] = [0.9, 1.1];

describe("the eye geometry", () => {
  it("rests as the sheet's 58 : 111 oval", () => {
    /* Taller than wide — the sheet's eyes are vertical ovals, which is what makes him read
       as a creature rather than as a cartoon. */
    const open = bounds(OPEN);
    expect(open.height / open.width).toBeCloseTo(111 / 58, 1);
  });

  it("closes into a wide, shallow bowl when asleep", () => {
    const asleep = bounds(ASLEEP);
    const open = bounds(OPEN);

    /* ~115 × 30 on the drawing: about 3.8 times as wide as it is deep. */
    expect(asleep.width / asleep.height).toBeGreaterThan(3.3);
    expect(asleep.width / asleep.height).toBeLessThan(4.4);
    /* Around a fifth of the open eye's height: a closed lid, not a hairline. */
    expect(asleep.height / open.height).toBeCloseTo(0.22, 1);
  });

  it("keeps the lid flat and hangs its belly from the middle, an open U", () => {
    const lidMiddle = extreme(ASLEEP, "max", MIDDLE);
    const lidTips = extreme(ASLEEP, "max", [0.9, 1.4]);
    const bellyMiddle = extreme(ASLEEP, "min", MIDDLE);
    const bellyTips = extreme(ASLEEP, "min", [0.9, 1.4]);

    /* The top edge is one straight line; the bottom is deepest at the centre. */
    expect(lidTips).toBeCloseTo(lidMiddle, 3);
    expect(bellyMiddle).toBeLessThan(bellyTips - 0.005);
  });

  it("is a bowl, not an arch: the middle sits lower than the tips", () => {
    /* The opposite of the happy `∩`: the spine of the closed eye dips in the middle. */
    expect(spine(ASLEEP, MIDDLE)).toBeLessThan(spine(ASLEEP, TIPS));
  });

  it("arches the opposite way when happy", () => {
    expect(spine(HAPPY, MIDDLE)).toBeGreaterThan(spine(HAPPY, TIPS));
    expect(extreme(HAPPY, "max", MIDDLE)).toBeGreaterThan(extreme(HAPPY, "max", [0.4, 0.6]));
  });

  it("morphs in the plane of the face only, so neither shape can pierce the front surface", () => {
    for (const attribute of [happy, sleepy]) {
      for (let index = 0; index < attribute.count; index += 1) {
        expect(attribute.getZ(index)).toBe(0);
      }
    }
  });
});
