/**
 * Where a mesh occupies the screen, in CSS pixels.
 *
 * The page under the canvas needs this for one reason: a touch that starts over a mesh
 * must belong to the mesh. Browsers read `touch-action` at **touchstart**, from the
 * element the finger landed on, and a class added during `pointerdown` is a frame too
 * late to change the current gesture — the page pans, the pointer stream is cancelled,
 * and the drag never happens. The only reliable answer is an element that is already
 * under the finger before the gesture starts, carrying `touch-action: none`. That
 * element is a shield, and a shield needs the mesh's box.
 *
 * Pure math on projected points. The scene owns the camera and does the projecting;
 * nothing here knows three.
 */

export type SurfaceFootprint = {
  left: number;
  top: number;
  width: number;
  height: number;
};

/** A projected box this thin is not a hit region — it is a rounding error. */
export const MIN_FOOTPRINT_SIZE = 2;

/**
 * How far a footprint must move before it counts as moved.
 *
 * The sphere bobs every frame, and the shield is a DOM write per change. Comparing
 * exactly means a write per frame forever; comparing with a tolerance means a write
 * when the user would notice, and none while the mesh sits still.
 */
export const FOOTPRINT_EPSILON = 0.5;

function isFiniteNumber(value: number): boolean {
  return Number.isFinite(value);
}

/**
 * The screen box around projected NDC points.
 *
 * `points` are normalized device coordinates (`x`, `y` in −1..1 after
 * `Vector3.project(camera)`, the usual OpenGL convention where +y is up). The viewport
 * origin is top-left, so `y` is flipped here — the same flip the UV → pixel mapping
 * does, for the same reason.
 *
 * Returns null when the points say nothing: an empty list, a point behind the camera
 * (projection divides by w, so a non-finite coordinate means the mesh is not on
 * screen), or a box too thin to be a hit region.
 */
export function footprintFromNdc(
  points: readonly { x: number; y: number }[],
  width: number,
  height: number,
): SurfaceFootprint | null {
  if (points.length === 0) return null;
  if (!(width > 0) || !(height > 0)) return null;

  let left = Number.POSITIVE_INFINITY;
  let right = Number.NEGATIVE_INFINITY;
  let top = Number.POSITIVE_INFINITY;
  let bottom = Number.NEGATIVE_INFINITY;

  for (const point of points) {
    if (!isFiniteNumber(point.x) || !isFiniteNumber(point.y)) return null;

    const x = (point.x * 0.5 + 0.5) * width;
    const y = (0.5 - point.y * 0.5) * height;

    if (x < left) left = x;
    if (x > right) right = x;
    if (y < top) top = y;
    if (y > bottom) bottom = y;
  }

  const boxWidth = right - left;
  const boxHeight = bottom - top;
  if (boxWidth < MIN_FOOTPRINT_SIZE || boxHeight < MIN_FOOTPRINT_SIZE) return null;

  return { left, top, width: boxWidth, height: boxHeight };
}

/**
 * The footprint clipped to the viewport.
 *
 * A shield that hangs off the right edge is a `position: fixed` element wider than the
 * viewport, and a fixed element wider than the viewport is a horizontal scrollbar on a
 * page that has no business scrolling sideways.
 */
export function clampFootprintToViewport(
  footprint: SurfaceFootprint,
  width: number,
  height: number,
): SurfaceFootprint | null {
  const left = Math.max(0, footprint.left);
  const top = Math.max(0, footprint.top);
  const right = Math.min(width, footprint.left + footprint.width);
  const bottom = Math.min(height, footprint.top + footprint.height);

  const boxWidth = right - left;
  const boxHeight = bottom - top;
  if (boxWidth < MIN_FOOTPRINT_SIZE || boxHeight < MIN_FOOTPRINT_SIZE) return null;

  return { left, top, width: boxWidth, height: boxHeight };
}

/**
 * Is this the same box?
 *
 * Sub-`FOOTPRINT_EPSILON` moves are ignored, so a mesh that bobs by a third of a pixel
 * per frame does not write to the DOM per frame.
 */
export function sameFootprint(
  a: SurfaceFootprint | null,
  b: SurfaceFootprint | null,
  epsilon: number = FOOTPRINT_EPSILON,
): boolean {
  if (a == null || b == null) return a == b;

  return (
    Math.abs(a.left - b.left) < epsilon &&
    Math.abs(a.top - b.top) < epsilon &&
    Math.abs(a.width - b.width) < epsilon &&
    Math.abs(a.height - b.height) < epsilon
  );
}
