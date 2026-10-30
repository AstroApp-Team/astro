/**
 * The screen box of each surface mesh, published to the DOM.
 *
 * Deliberately a module with a subscription, not a store field. The footprint is
 * published from the render loop: the colour sphere bobs, the plane spins, so the box
 * changes while a clip plays. A store field would re-render every subscriber of every
 * component that reads it, 60 times a second, which is the exact pattern AGENTS.md
 * calls out for the camera target. The only consumer is one div's `style`, and a
 * subscription writes it directly.
 *
 * Same shape as `surfaceRects.ts` for the same reason: a per-frame channel that must
 * not touch React.
 */

import type { SurfaceId } from "@core/models/surface.ts";
import { sameFootprint, type SurfaceFootprint } from "@core/usecases/surfaceFootprint.ts";

type FootprintListener = (footprint: SurfaceFootprint | null) => void;

const footprints = new Map<SurfaceId, SurfaceFootprint>();
const listeners = new Map<SurfaceId, Set<FootprintListener>>();

/**
 * Publish a mesh's box, or `null` when it has none.
 *
 * A move smaller than `FOOTPRINT_EPSILON` notifies nobody. Without that check a bobbing
 * sphere writes `style.left` on every frame of every clip, forever.
 */
export function setSurfaceFootprint(
  surfaceId: SurfaceId,
  footprint: SurfaceFootprint | null,
): void {
  const previous = footprints.get(surfaceId) ?? null;
  if (sameFootprint(previous, footprint)) return;

  if (footprint == null) {
    footprints.delete(surfaceId);
  } else {
    footprints.set(surfaceId, footprint);
  }

  for (const listener of listeners.get(surfaceId) ?? []) {
    listener(footprint);
  }
}

export function getSurfaceFootprint(surfaceId: SurfaceId): SurfaceFootprint | null {
  return footprints.get(surfaceId) ?? null;
}

/**
 * Watch one surface's box. The listener fires immediately with the current value, so a
 * shield that mounts after the scene has a footprint starts in the right place.
 */
export function subscribeSurfaceFootprint(
  surfaceId: SurfaceId,
  listener: FootprintListener,
): () => void {
  const existing = listeners.get(surfaceId);
  const bucket = existing ?? new Set<FootprintListener>();
  bucket.add(listener);
  listeners.set(surfaceId, bucket);

  listener(footprints.get(surfaceId) ?? null);

  return () => {
    const current = listeners.get(surfaceId);
    if (current == null) return;

    current.delete(listener);
    if (current.size === 0) listeners.delete(surfaceId);
  };
}

/**
 * Drop a mesh's box on teardown.
 *
 * The scene unmounts when the route changes; a footprint left behind is a shield that
 * keeps swallowing touches on a page that no longer has a mesh under it.
 */
export function clearSurfaceFootprint(surfaceId: SurfaceId): void {
  setSurfaceFootprint(surfaceId, null);
}
