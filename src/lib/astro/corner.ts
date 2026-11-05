/**
 * Where the character sits in the corner, as pure numbers.
 *
 * Kept out of the component because the whole job is arithmetic the canvas cannot
 * assert: the body's world size is fixed, so a corner position written in world units
 * lands somewhere different on every aspect ratio, and the inset has to be measured
 * against the halo rather than the body. `ASTRO_V2_HALO_RADIUS` is that radius in world
 * units (`ASTRO_V2_BODY_RADIUS * 1.9`; the sheet's own figure is `1.8 R`).
 */

import { ASTRO_V2_HALO_RADIUS } from "./astroV2.ts";

/** The halo's radius in world units — the quantity the inset is measured against. */
export const ASTRO_CORNER_HALO_WORLD = ASTRO_V2_HALO_RADIUS;

/**
 * How far in from the corner the body's centre sits, as a fraction of the halo's world
 * radius. Flush to the corner would put half the halo off-screen and he would read as a
 * plain orange disc; 0.85 keeps the rim near the edge and ~85% of the glow on screen.
 */
export const ASTRO_CORNER_INSET_RATIO = 0.85;

/**
 * The clamp that keeps him in the *corner* on a narrow screen.
 *
 * The halo's world radius is fixed (1.09 units) while a phone's half-width at this
 * camera is ~1.55 units, so an unclamped inset of 0.93 pushes the centre back to
 * 0.63 — right of centre, but nowhere near the corner. The inset is capped at this
 * fraction of whichever half extent is smaller, so on a phone the glow bleeds off the
 * edge instead of the character drifting toward the middle.
 */
export const ASTRO_CORNER_EDGE_RATIO = 0.45;

export type CornerInput = {
  /** Canvas width / height. */
  aspect: number;
  /** Camera distance along z. */
  cameraZ: number;
  /** Camera vertical fov, in degrees. */
  fovDeg: number;
  /** The character's plane. */
  characterZ?: number;
};

/** Half the visible box at the character's plane, in world units. */
export function visibleHalfExtent({ aspect, cameraZ, fovDeg, characterZ = 0 }: CornerInput) {
  const distance = cameraZ - characterZ;
  const halfHeight = Math.tan((fovDeg * Math.PI) / 360) * distance;
  return { halfHeight, halfWidth: halfHeight * aspect };
}

/**
 * The body's centre for a bottom-right corner, in the camera's space.
 *
 * The y sign is the reason this needs a test: three's camera space has **y up**, so the
 * bottom of the frame is `-halfHeight`. Write it as `+halfHeight` and the character ends
 * up in the top-right with nothing to explain the move.
 */
export function cornerPosition(input: CornerInput): [number, number, number] {
  const { halfHeight, halfWidth } = visibleHalfExtent(input);
  const inset = Math.min(
    ASTRO_CORNER_HALO_WORLD * ASTRO_CORNER_INSET_RATIO,
    halfWidth * ASTRO_CORNER_EDGE_RATIO,
    halfHeight * ASTRO_CORNER_EDGE_RATIO,
  );
  const characterZ = input.characterZ ?? 0;
  return [halfWidth - inset, -halfHeight + inset, characterZ];
}
