import { describe, expect, it } from "vite-plus/test";

import {
  clampFootprintToViewport,
  FOOTPRINT_EPSILON,
  footprintFromNdc,
  sameFootprint,
  type SurfaceFootprint,
} from "@core/usecases/surfaceFootprint.ts";

const VIEWPORT = { width: 390, height: 688 };

describe("footprintFromNdc", () => {
  it("maps the NDC centre to the viewport centre", () => {
    const box = footprintFromNdc([{ x: 0, y: 0 }], VIEWPORT.width, VIEWPORT.height);

    // A single point is a zero-size box, so it is rejected as a hit region.
    expect(box).toBeNull();
  });

  /**
   * NDC has +y up, the viewport has +y down. Skip the flip and the shield lands above
   * the mesh by twice the offset — which reads as "the touch region is a bit off", not
   * as a bug in the mapping.
   */
  it("flips y, so a mesh above the centre is a box above the centre", () => {
    const box = footprintFromNdc(
      [
        { x: -0.5, y: 0.5 },
        { x: 0.5, y: 1 },
      ],
      VIEWPORT.width,
      VIEWPORT.height,
    );

    expect(box).not.toBeNull();
    expect(box?.top).toBeCloseTo(0, 5);
    expect(box?.left).toBeCloseTo(VIEWPORT.width * 0.25, 5);
    expect(box?.width).toBeCloseTo(VIEWPORT.width * 0.5, 5);
    expect(box?.height).toBeCloseTo(VIEWPORT.height * 0.25, 5);
  });

  it("returns null when any point is not finite", () => {
    // `Vector3.project` divides by w; a point on or behind the camera plane arrives as
    // ±Infinity, and a box built from it is a shield the width of the galaxy.
    expect(footprintFromNdc([{ x: 0, y: Number.POSITIVE_INFINITY }], 390, 688)).toBeNull();
    expect(footprintFromNdc([{ x: Number.NaN, y: 0 }], 390, 688)).toBeNull();
  });

  it("returns null for no points and for a viewport with no size", () => {
    expect(footprintFromNdc([], 390, 688)).toBeNull();
    expect(footprintFromNdc([{ x: 0, y: 0 }], 0, 688)).toBeNull();
    expect(footprintFromNdc([{ x: 0, y: 0 }], 390, Number.NaN)).toBeNull();
  });

  it("returns null for a box thinner than MIN_FOOTPRINT_SIZE", () => {
    // Two NDC points 1 px apart on a 390 px viewport is a 1 px box, under the minimum.
    const near = 1 / VIEWPORT.width;
    expect(
      footprintFromNdc(
        [
          { x: 0, y: 0 },
          { x: near, y: 0 },
        ],
        VIEWPORT.width,
        VIEWPORT.height,
      ),
    ).toBeNull();
  });
});

describe("clampFootprintToViewport", () => {
  it("clips a box that hangs off the edges", () => {
    const clamped = clampFootprintToViewport(
      { left: -40, top: -20, width: 200, height: 200 },
      390,
      688,
    );

    // Clamped to [0, 160] × [0, 180]: the off-screen margins are cut, not shifted.
    expect(clamped).toEqual({ left: 0, top: 0, width: 160, height: 180 });
  });

  it("keeps a box that fits", () => {
    const footprint: SurfaceFootprint = { left: 10, top: 20, width: 100, height: 80 };
    expect(clampFootprintToViewport(footprint, 390, 688)).toEqual(footprint);
  });

  /**
   * A fixed element wider than the viewport is a horizontal scrollbar on a page that
   * has no business scrolling sideways.
   */
  it("returns null when the box is entirely off screen", () => {
    expect(
      clampFootprintToViewport({ left: 500, top: 0, width: 100, height: 100 }, 390, 688),
    ).toBeNull();
  });
});

describe("sameFootprint", () => {
  const box: SurfaceFootprint = { left: 10, top: 20, width: 100, height: 80 };

  it("treats a move below the epsilon as no move", () => {
    expect(sameFootprint(box, { ...box, left: box.left + FOOTPRINT_EPSILON / 2 })).toBe(true);
  });

  it("treats a move above the epsilon as a move", () => {
    expect(sameFootprint(box, { ...box, top: box.top + FOOTPRINT_EPSILON * 2 })).toBe(false);
  });

  it("says two nulls are the same, and a null and a box are not", () => {
    expect(sameFootprint(null, null)).toBe(true);
    expect(sameFootprint(box, null)).toBe(false);
    expect(sameFootprint(null, box)).toBe(false);
  });
});
