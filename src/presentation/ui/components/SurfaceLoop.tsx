import type { ReactNode } from "react";

import {
  LOOP_STRIP_HEIGHT,
  LOOP_TILE_HEIGHT,
  SURFACE_GHOST_ATTR,
} from "@core/usecases/surfaceInteraction.ts";
import type { SurfaceId } from "@core/models/surface.ts";
import { useSurfaceStore } from "@presentation/state/useSurfaceStore.ts";

/**
 * A page's looping content, inside a texture.
 *
 * The content is rendered twice, stacked, and the pair is translated by `-offset`,
 * where `offset` is wrapped into `[0, LOOP_TILE_HEIGHT)` by the store. At any offset the
 * window shows the tail of one tile and the head of the other, so scrolling past the end
 * arrives at the beginning with no seam, in both directions.
 *
 * **The whole page is the tile, not a list inside it.** The caller passes the page's
 * content as children — heading, button, copy, rows — and all of it scrolls. A list
 * inside a fixed page loops the list and leaves the button parked, which is not a page
 * that loops; the button has to travel, appear and disappear with the rest of the sheet.
 *
 * The heights are inline, from the same constants the store wraps with: the seam is only
 * invisible when the tile the browser lays out is exactly the height the scroll wraps at,
 * and a stylesheet that drifts from a constant is a seam nobody can see in a diff. That
 * is why `LOOP_TILE_HEIGHT` counts the heading block as well as the rows.
 *
 * The second tile is marked `SURFACE_GHOST_ATTR` (and `aria-hidden`), and
 * `measureSurfaceRects` skips anything inside a ghost subtree. A button rendered twice
 * publishes two rects, and a tap on empty texture fires it, because the phantom rect is
 * the one the UV lands in. The skip is NOT on `aria-hidden`: the parked hosts are
 * `aria-hidden` themselves, and that rule would skip every button on every page.
 *
 * **This is the page half of the scroll command.** The pages under the textures are
 * parked 10 000 px off screen with `pointer-events: none`, so they have no scrollbar and
 * nothing native to scroll. A wheel over a mesh, a drag on a mesh, a drag on the shield,
 * and a drag on the real page all write the same store offset; this component translates;
 * the MutationObserver fires; the raster turns the moved page into the texture. The mesh
 * does not rotate to fake it — that is the shortcut this exists to avoid.
 */
export function SurfaceLoop({
  surfaceId,
  children,
}: {
  surfaceId: SurfaceId;
  children: ReactNode;
}) {
  const offset = useSurfaceStore((state) => state.scroll[surfaceId]);

  return (
    <div
      className="surface-loop"
      style={{ height: `${LOOP_STRIP_HEIGHT}px` }}
      data-surface-window=""
    >
      <div
        className="surface-loop__track"
        style={{ transform: `translate3d(0, ${-offset.toFixed(2)}px, 0)` }}
      >
        {[0, 1].map((tile) => (
          <div
            key={tile}
            className="surface-loop__tile"
            style={{ height: `${LOOP_TILE_HEIGHT}px` }}
            aria-hidden={tile === 1}
            {...(tile === 1 ? { [SURFACE_GHOST_ATTR]: "" } : {})}
          >
            {children}
          </div>
        ))}
      </div>
    </div>
  );
}

export default SurfaceLoop;
