/**
 * Where the character sits in the corner, as pure numbers.
 *
 * Kept out of the component because the whole job is arithmetic the canvas cannot
 * assert: the body's world size is fixed, so a corner position written in world units
 * lands somewhere different on every aspect ratio, and the inset has to be measured
 * against the halo rather than the body. `ASTRO_V2_HALO_RADIUS` is that radius in world
 * units (`ASTRO_V2_BODY_RADIUS * 1.9`; the sheet's own figure is `1.8 R`).
 *
 * The framing is **orthographic**, so `HalfExtent` is supplied by the caller rather than
 * derived from a field of view: an orthographic frustum is set in world units and scaled
 * by `zoom`, and the visible half extents are `pixels / (2 · zoom)`. Both projections are
 * expressed here so the corner arithmetic has one shape regardless.
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

/** Half the visible box at the character's plane, in world units. */
export type HalfExtent = {
  halfWidth: number;
  halfHeight: number;
};

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

/** Half the visible box for a perspective camera, in world units. */
export function visibleHalfExtent({
  aspect,
  cameraZ,
  fovDeg,
  characterZ = 0,
}: CornerInput): HalfExtent {
  const distance = cameraZ - characterZ;
  const halfHeight = Math.tan((fovDeg * Math.PI) / 360) * distance;
  return { halfHeight, halfWidth: halfHeight * aspect };
}

/**
 * Half the visible box for an orthographic camera, in world units.
 *
 * R3F sizes an orthographic camera in **pixels** (`left = -width/2`, `top = height/2`) and
 * divides by `zoom`, so a world unit occupies `zoom` pixels. Inverting that is the whole
 * function — and it is why the orthographic framing can be stated as "the halo covers this
 * fraction of the shorter side" instead of as a distance.
 */
export function orthographicHalfExtent(
  widthPx: number,
  heightPx: number,
  zoom: number,
): HalfExtent {
  /* The two halves are scaled by the *same* zoom, so they keep the canvas's aspect ratio.
     Deriving both from one dimension is what would put him off-centre on a phone. */
  return { halfWidth: widthPx / (2 * zoom), halfHeight: heightPx / (2 * zoom) };
}

/**
 * Pixels-per-world-unit that makes the halo span `coverage` of the **longer** viewport side.
 *
 * Measured against the halo rather than the body for the same reason the inset is: the glow
 * is what the eye reads as his size, and it is 1.9× the body.
 *
 * The **longer** side, not the shorter, and that is the whole difference between a phone and
 * a monitor. Sizing against `min(w, h)` sizes a portrait phone by its narrow width — the one
 * dimension it has least of — so he came out ~16% of the width on a handset and read as an
 * icon, while the same figure looked right on a 1440×900 monitor whose shorter side is 900px.
 * The longer side is the one that tracks *how much screen there is*: 25% of it is 360px on
 * that monitor and 211px on a 390×844 phone, where the old rule gave the phone 156px.
 *
 * The trade-off is deliberate: on a tablet or a landscape phone the character is sized by the
 * width, so he is larger relative to the short side than he is on a monitor. That is the
 * price of "the same character" across viewports, and it is why the inset is clamped in
 * `cornerPosition` — a big halo must still read as a corner.
 */
export function orthographicZoom(
  widthPx: number,
  heightPx: number,
  coverage: number,
  haloWorld: number = ASTRO_CORNER_HALO_WORLD,
): number {
  return (Math.max(widthPx, heightPx) * coverage) / (2 * haloWorld);
}

/**
 * The body's centre for a bottom-right corner, given the visible half extents.
 *
 * The y sign is the reason this needs a test: three's camera space has **y up**, so the
 * bottom of the frame is `-halfHeight`. Write it as `+halfHeight` and the character ends
 * up in the top-right with nothing to explain the move.
 */
export function cornerPosition(extent: HalfExtent, characterZ = 0): [number, number, number] {
  const { halfHeight, halfWidth } = extent;
  const inset = Math.min(
    ASTRO_CORNER_HALO_WORLD * ASTRO_CORNER_INSET_RATIO,
    halfWidth * ASTRO_CORNER_EDGE_RATIO,
    halfHeight * ASTRO_CORNER_EDGE_RATIO,
  );
  return [halfWidth - inset, -halfHeight + inset, characterZ];
}
