/**
 * Where the buttons of a surface page are, in the page's own pixels.
 *
 * The raycast knows a UV; the page knows its buttons. Neither knows the other, and
 * infrastructure is the only place both can meet without breaking the import
 * direction (`presentation → infrastructure → core`): the page publishes rects
 * inward, the mesh reads them inward, and the app-state write happens in
 * `presentation/`, where the store lives.
 *
 * A module-scope registry, not a store: the mesh reads it inside a pointer handler,
 * 60-frames-a-second code that must not subscribe to anything.
 */

import type { SurfaceId } from "@core/models/surface.ts";
import { SURFACE_WINDOW_ATTR, clipRectToWindow } from "@core/usecases/surfaceInteraction.ts";
import type { SurfaceRect } from "@core/usecases/surfaceInteraction.ts";

const MAX_RECTS = 64;

const registry = new Map<SurfaceId, readonly SurfaceRect[]>();

/** Records the current layout of a surface page's buttons. */
export function publishSurfaceRects(surfaceId: SurfaceId, rects: readonly SurfaceRect[]): void {
  registry.set(surfaceId, rects.slice(0, MAX_RECTS));
}

/** Drops a page's rects when it unmounts, so a stale layout cannot be pressed. */
export function clearSurfaceRects(surfaceId: SurfaceId): void {
  registry.delete(surfaceId);
}

export function getSurfaceRects(surfaceId: SurfaceId): readonly SurfaceRect[] {
  return registry.get(surfaceId) ?? [];
}

/**
 * Measures every button in a surface host.
 *
 * `data-surface-action` is the contract: the page marks a button with the action it
 * performs, and this turns geometry into that action. Measured, never declared —
 * the counter inside a button's label changes its width, and a hardcoded rect stops
 * matching the first time the label grows.
 *
 * Coordinates are relative to the host's own box, because the raster draws the host
 * at the canvas origin: host-relative pixels and canvas pixels are the same
 * numbers, which is what makes a UV a page pixel without a second transform.
 */
export function measureSurfaceRects(host: HTMLElement): SurfaceRect[] {
  const hostRect = host.getBoundingClientRect();
  const rects: SurfaceRect[] = [];

  for (const element of host.querySelectorAll<HTMLElement>("[data-surface-action]")) {
    const action = element.dataset.surfaceAction;
    if (action == null) continue;

    // The loop renders its tile twice, and BOTH copies are measured. Skipping the
    // duplicate is what made a visible button unhittable: as the offset grows, the first
    // tile's copy walks out of the window's top and the copy the user is looking at is the
    // duplicate. Drawn, and publishing nothing — the tap lands on empty texture.
    //
    // The window clip below is the real protection, and it is the correct one: a copy that
    // is outside the window is not drawn, so it publishes nothing. Two copies can never be
    // inside the window at once, because the tile is `LOOP_TILE_HEIGHT` (840) and the
    // window is `LOOP_STRIP_HEIGHT` (300) — the copies are 840 px apart, so at most one is
    // ever in a 300 px window. There is no phantom rect to skip.
    //
    // `SURFACE_GHOST_ATTR` stays on the duplicate as a marker of what it is, and the
    // measurer does not read it. It must never become a filter again: the previous rule
    // (`aria-hidden`, then this marker) removed the rects of the copy the user sees.

    const box = element.getBoundingClientRect();

    // The loop window clips what is drawn, so it clips what is hittable too. The window
    // is marked, not looked up by class: infrastructure does not know the stylesheet.
    const windowEl = element.closest(`[${SURFACE_WINDOW_ATTR}]`);
    const clipTarget = windowEl ?? host;
    const clipRect = clipTarget.getBoundingClientRect();

    const visible = clipRectToWindow(
      {
        // The caller validates this with `isSurfaceAction`; an unknown id is dropped
        // by the press path rather than here, so a typo shows up as "nothing happens"
        // in the log instead of as a page that renders no buttons.
        action: action as SurfaceRect["action"],
        x: box.left - hostRect.left,
        y: box.top - hostRect.top,
        width: box.width,
        height: box.height,
      },
      {
        action: action as SurfaceRect["action"],
        x: clipRect.left - hostRect.left,
        y: clipRect.top - hostRect.top,
        width: clipRect.width,
        height: clipRect.height,
      },
    );

    // A button scrolled out of the window is not drawn, and a tap on the texture must
    // not fire it. It publishes nothing.
    if (visible == null) continue;

    rects.push(visible);

    if (rects.length >= MAX_RECTS) break;
  }

  return rects;
}
