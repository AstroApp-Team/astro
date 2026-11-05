import { describe, expect, it } from "vite-plus/test";

import { ASTRO_V2_BODY_RADIUS, ASTRO_V2_HALO_RADIUS } from "./astroV2.ts";
import {
  ASTRO_CORNER_EDGE_RATIO,
  ASTRO_CORNER_HALO_WORLD,
  ASTRO_CORNER_INSET_RATIO,
  cornerPosition,
  orthographicHalfExtent,
  orthographicZoom,
  visibleHalfExtent,
} from "./corner.ts";

/** The camera the overlay declares: orthographic, `zoom` derived from the canvas size. */
function framing(widthPx: number, heightPx: number, coverage = 0.3) {
  const zoom = orthographicZoom(widthPx, heightPx, coverage);
  return orthographicHalfExtent(widthPx, heightPx, zoom);
}

describe("orthographic framing", () => {
  it("maps pixels to world units through zoom", () => {
    /* zoom is pixels-per-world-unit, so the frame is the canvas divided by it. */
    expect(orthographicHalfExtent(800, 600, 100)).toEqual({ halfWidth: 4, halfHeight: 3 });
  });

  it("keeps the canvas's aspect ratio rather than squaring the frame", () => {
    /* Deriving both halves from one dimension would put him off-centre on a phone: the
       half extents have to carry the canvas's own ratio. */
    const portrait = framing(390, 844);
    expect(portrait.halfHeight / portrait.halfWidth).toBeCloseTo(844 / 390, 5);
  });

  it("sizes the halo against the shorter side, on either orientation", () => {
    /* `coverage` is a fraction of the shorter side, so the halo occupies that fraction of
       min(width, height) in pixels — measured against the halo, not the body. */
    for (const [w, h] of [
      [1440, 900],
      [390, 844],
    ] as const) {
      const zoom = orthographicZoom(w, h, 0.3);
      const haloPx = 2 * ASTRO_CORNER_HALO_WORLD * zoom;
      expect(haloPx).toBeCloseTo(Math.min(w, h) * 0.3, 3);
    }
  });
});

describe("cornerPosition", () => {
  it("puts the body in the bottom-right on a phone, not the top-right", () => {
    const [x, y] = cornerPosition(framing(390, 844));
    const { halfHeight, halfWidth } = framing(390, 844);

    /* three's camera space has y up, so the bottom of the frame is negative. */
    expect(y).toBeLessThan(0);
    expect(x).toBeGreaterThan(0);
    expect(-y).toBeGreaterThan(halfHeight / 2);
    expect(x).toBeGreaterThan(halfWidth / 2);
  });

  it("stays in the corner at both ends of the aspect range", () => {
    for (const [w, h] of [
      [320, 700],
      [800, 800],
      [1440, 900],
      [2400, 1000],
    ] as const) {
      const extent = framing(w, h);
      const [x, y] = cornerPosition(extent);
      expect(y).toBeLessThan(0);
      expect(x).toBeGreaterThan(0);
      /* Past the midline in both directions, on every aspect — that is the corner. */
      expect(x).toBeGreaterThan(extent.halfWidth / 2);
      expect(-y).toBeGreaterThan(extent.halfHeight / 2);
    }
  });

  it("clamps the inset when the frame is tighter than the halo", () => {
    /* The clamp is the guard for a framing where the halo alone would exceed the frame:
       zooming in enough (0.9 coverage) makes a phone's half-width smaller than the halo's
       inset, and without the clamp the centre would land back on the midline. */
    const tight = framing(390, 844, 0.9);
    expect(ASTRO_CORNER_HALO_WORLD * ASTRO_CORNER_INSET_RATIO).toBeGreaterThan(
      tight.halfWidth * ASTRO_CORNER_EDGE_RATIO,
    );
    const [x] = cornerPosition(tight);
    expect(x).toBeCloseTo(tight.halfWidth - tight.halfWidth * ASTRO_CORNER_EDGE_RATIO, 5);
    expect(x).toBeGreaterThan(tight.halfWidth / 2);
  });

  it("uses the halo's own inset at the overlay's coverage, so the glow stays whole", () => {
    /* At 30% coverage the frame is wider than the halo, so the halo-based inset is the
       smaller one and the clamp never fires: the glow crosses the edge by a slice only. */
    const portrait = framing(390, 844);
    expect(cornerPosition(portrait)[0]).toBeCloseTo(
      portrait.halfWidth - ASTRO_CORNER_HALO_WORLD * ASTRO_CORNER_INSET_RATIO,
      5,
    );
    expect(cornerPosition(portrait)[0]).toBeGreaterThan(portrait.halfWidth / 2);
  });

  it("keeps the whole body on screen, and lets the rim of the halo cross the edge", () => {
    const extent = framing(390, 844);
    const [x, y] = cornerPosition(extent);

    expect(x + ASTRO_V2_BODY_RADIUS).toBeLessThan(extent.halfWidth);
    expect(y - ASTRO_V2_BODY_RADIUS).toBeGreaterThan(-extent.halfHeight);

    /* The inset is measured against the halo, so a slice of the glow goes off-screen on
       purpose. Flush placement with no halo visible is the failure this guards. */
    expect(x + ASTRO_CORNER_HALO_WORLD).toBeGreaterThan(extent.halfWidth);
    expect(ASTRO_CORNER_INSET_RATIO).toBeGreaterThan(0.5);
  });

  it("measures the inset against the sheet's halo, 1.9× the body", () => {
    expect(ASTRO_V2_HALO_RADIUS / ASTRO_V2_BODY_RADIUS).toBeCloseTo(1.9, 5);
    expect(ASTRO_CORNER_HALO_WORLD).toBeCloseTo(ASTRO_V2_HALO_RADIUS, 5);
    expect(ASTRO_CORNER_HALO_WORLD).toBeGreaterThan(ASTRO_V2_BODY_RADIUS);
  });
});

describe("the perspective framing it replaced", () => {
  it("still computes half extents from fov and distance", () => {
    /* Kept because the corner arithmetic is projection-agnostic, and this is the shape the
       `clean-refactor` figures were measured against (fov 45 at z 7.5). */
    const { halfHeight } = visibleHalfExtent({ aspect: 1.6, cameraZ: 7.5, fovDeg: 45 });
    expect(halfHeight).toBeCloseTo(Math.tan((45 * Math.PI) / 360) * 7.5, 5);
  });
});
