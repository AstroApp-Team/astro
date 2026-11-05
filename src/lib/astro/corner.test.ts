import { describe, expect, it } from "vite-plus/test";

import { ASTRO_V2_BODY_RADIUS, ASTRO_V2_HALO_RADIUS } from "./astroV2.ts";
import {
  ASTRO_CORNER_EDGE_RATIO,
  ASTRO_CORNER_HALO_WORLD,
  ASTRO_CORNER_INSET_RATIO,
  cornerPosition,
  visibleHalfExtent,
} from "./corner.ts";

const CAMERA = { cameraZ: 7.5, fovDeg: 45 } as const;

describe("cornerPosition", () => {
  it("puts the body in the bottom-right on a phone, not the top-right", () => {
    const [x, y] = cornerPosition({ ...CAMERA, aspect: 0.5 });
    const { halfHeight, halfWidth } = visibleHalfExtent({ ...CAMERA, aspect: 0.5 });

    /* three's camera space has y up, so the bottom of the frame is negative. */
    expect(y).toBeLessThan(0);
    expect(x).toBeGreaterThan(0);
    expect(-y).toBeGreaterThan(halfHeight / 2);
    expect(x).toBeGreaterThan(halfWidth / 2);
  });

  it("stays in the corner at both ends of the aspect range", () => {
    for (const aspect of [0.45, 1, 1.6, 2.4]) {
      const [x, y] = cornerPosition({ ...CAMERA, aspect });
      const { halfHeight, halfWidth } = visibleHalfExtent({ ...CAMERA, aspect });
      expect(y).toBeLessThan(0);
      expect(x).toBeGreaterThan(0);
      /* Past the midline in both directions, on every aspect — that is the corner. */
      expect(x).toBeGreaterThan(halfWidth / 2);
      expect(-y).toBeGreaterThan(halfHeight / 2);
    }
  });

  it("clamps the inset on a narrow screen rather than pushing him toward the middle", () => {
    const portrait = visibleHalfExtent({ ...CAMERA, aspect: 0.5 });
    const wide = visibleHalfExtent({ ...CAMERA, aspect: 1.6 });

    /* The halo's radius alone would exceed a phone's half-width; the clamp is what
       keeps the corner reading as a corner there. */
    expect(ASTRO_CORNER_HALO_WORLD * ASTRO_CORNER_INSET_RATIO).toBeGreaterThan(
      portrait.halfWidth * ASTRO_CORNER_EDGE_RATIO,
    );
    expect(cornerPosition({ ...CAMERA, aspect: 0.5 })[0]).toBeGreaterThan(
      portrait.halfWidth - portrait.halfWidth * ASTRO_CORNER_EDGE_RATIO - 1e-9,
    );

    /* On a wide monitor the halo-based inset is the smaller one, so the glow is whole. */
    expect(cornerPosition({ ...CAMERA, aspect: 1.6 })[0]).toBeCloseTo(
      wide.halfWidth - ASTRO_CORNER_HALO_WORLD * ASTRO_CORNER_INSET_RATIO,
      5,
    );
  });

  it("keeps the whole body on screen, and lets the rim of the halo cross the edge", () => {
    const aspect = 0.5;
    const [x, y] = cornerPosition({ ...CAMERA, aspect });
    const { halfHeight, halfWidth } = visibleHalfExtent({ ...CAMERA, aspect });

    expect(x + ASTRO_V2_BODY_RADIUS).toBeLessThan(halfWidth);
    expect(y - ASTRO_V2_BODY_RADIUS).toBeGreaterThan(-halfHeight);

    /* The inset is measured against the halo, so a slice of the glow goes off-screen on
       purpose. Flush placement with no halo visible is the failure this guards. */
    expect(x + ASTRO_CORNER_HALO_WORLD).toBeGreaterThan(halfWidth);
    expect(ASTRO_CORNER_INSET_RATIO).toBeGreaterThan(0.5);
  });

  it("measures the inset against the sheet's halo, 1.9× the body", () => {
    expect(ASTRO_V2_HALO_RADIUS / ASTRO_V2_BODY_RADIUS).toBeCloseTo(1.9, 5);
    expect(ASTRO_CORNER_HALO_WORLD).toBeCloseTo(ASTRO_V2_HALO_RADIUS, 5);
    expect(ASTRO_CORNER_HALO_WORLD).toBeGreaterThan(ASTRO_V2_BODY_RADIUS);
  });
});
