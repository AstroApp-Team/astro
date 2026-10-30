import { useEffect, useRef } from "react";

import type { SurfaceId } from "@core/models/surface.ts";

import { subscribeSurfaceFootprint } from "@infra/surface/surfaceFootprints.ts";

/**
 * The region a mesh owns, as a real element the finger can land on.
 *
 * Touch scrolling cannot be implemented with a class. Browsers read `touch-action` at
 * **touchstart**, from the element the finger landed on, and they keep that answer for
 * the whole gesture. The mesh's pointer handlers run at `pointerdown`, one step later:
 * by then the browser has already decided this touch is a vertical pan of
 * `.surface__scroll`, it sends `pointercancel`, and every pointer handler on the mesh
 * stops firing. The drag is not "broken", it is cancelled, which is why it looks fine
 * with a mouse and does nothing on a phone.
 *
 * So the answer has to be an element that is already under the finger before the
 * gesture starts, carrying `touch-action: none`. This is that element: it is placed
 * over the mesh's screen box, it is never a hit target for a *raycast* (the raycast is
 * geometric and ignores the DOM), and it swallows nothing that the mesh does not
 * already own — a touch that lands here is a touch on the mesh.
 *
 * The box arrives through `subscribeSurfaceFootprint` and is written straight to
 * `style`. Not through a store field: the sphere bobs, so the box changes every frame,
 * and a store field written per frame re-renders its subscribers 60 times a second.
 * Nothing here renders.
 *
 * It sits **above** the story (z-index 2, story is 1), so a touch over the mesh lands
 * here and a touch anywhere else lands on the page's own scroller and scrolls it
 * normally. Anything interactive inside the story that the mesh can stand on has to be
 * raised above the shield — see `.surface__hero` in `styles/surface.css`.
 */
export function SurfaceTouchShield({ surfaceId }: { surfaceId: SurfaceId }) {
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const element = ref.current;
    if (element == null) return undefined;

    return subscribeSurfaceFootprint(surfaceId, (footprint) => {
      if (footprint == null) {
        // No mesh on screen: the shield must stop being a hit target, or it swallows
        // touches on a page that has nothing under it.
        element.style.display = "none";
        return;
      }

      element.style.display = "";
      element.style.left = `${footprint.left}px`;
      element.style.top = `${footprint.top}px`;
      element.style.width = `${footprint.width}px`;
      element.style.height = `${footprint.height}px`;
    });
  }, [surfaceId]);

  return <div ref={ref} className="surface__shield" aria-hidden="true" />;
}

export default SurfaceTouchShield;
