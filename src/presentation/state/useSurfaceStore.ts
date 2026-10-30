/**
 * App state for the `/surface` scene: the colour the square page paints, the spin
 * the sphere page requests, the canvases the pages rasterize into, and the log.
 *
 * The store is the only 2D ↔ 3D channel, and on this page that rule is doing real
 * work rather than being polite. A button inside a **texture** cannot be clicked —
 * it is pixels — so a press is a raycast that lands on a mesh, and a mesh must not
 * reach into a DOM node. Both sides write and read here, and neither sees the other.
 *
 * Subscribe with a selector. `canvases` and `playhead` change at frame rate; a bare
 * `useSurfaceStore()` re-renders on every one of them.
 */

import { create } from "zustand";
import type { SurfaceId } from "@core/models/surface.ts";
import {
  advanceLoopScroll,
  appendSurfaceAction,
  EMPTY_SURFACE_LOG,
  isSpinRequest,
  nextSphereColor,
  SPHERE_COLORS,
  type SurfaceAction,
  type SurfaceActionLog,
  type SurfacePoint,
  type SurfaceSource,
} from "@core/usecases/surfaceInteraction.ts";

export type SurfacePress = {
  action: SurfaceAction;
  source: SurfaceSource;
  /** Where the press landed on the page, in CSS pixels. `null` for a page-side press. */
  point: SurfacePoint | null;
  /** The playhead the press happened at, in seconds. */
  from: number;
};

type SurfaceState = {
  /**
   * The canvas each surface page rasterizes into. `null` while the page is not
   * mounted, which is the state the scene renders as a placeholder material.
   */
  canvases: Record<SurfaceId, HTMLCanvasElement | null>;
  /** The colour sphere's colour. App state, not a rig property — see `SurfaceScene`. */
  sphereColor: string;
  /**
   * Increments once per spin request.
   *
   * A counter, not a boolean: a boolean is the same value the second time you press
   * the button, and a selector on it does not re-render. Same reason `FloatPage`
   * reads `lastEvent` and not `selectedNodeId`.
   */
  spinRequest: number;
  log: SurfaceActionLog;
  /**
   * Bumped once per successful raster.
   *
   * The scene sets `texture.needsUpdate` off this, not off a frame subscription: a
   * 512×512 RGBA canvas is a 1 MB upload, and re-uploading it 60 times a second for
   * pixels that did not change is the expensive way to do nothing.
   */
  versions: Record<SurfaceId, number>;
  /** The playhead, mirrored for the readouts. Written at frame rate. */
  playhead: number;
  /**
   * Each page's looping scroll offset, in page pixels.
   *
   * The pages under the textures are parked 10 000 px off screen with
   * `pointer-events: none`, so they have no scrollbar and no native scroll of their
   * own. A wheel over a mesh, a drag on the page, and a drag on the mesh all write
   * here, and the page translates its own content from it — the offset is app state
   * so all three paths are the same path, and the raster turns the moved page into
   * the texture.
   */
  scroll: Record<SurfaceId, number>;
  /**
   * Which surface the pointer is over, set by the mesh's own pointer handlers.
   *
   * The page's wheel listener is registered `{ passive: false }` precisely so it can
   * cancel the page's own scroll, and it may only do that for a wheel the 3D scene
   * consumed. Without this the page refuses to scroll whenever a mesh is under the
   * cursor, which reads as a frozen page.
   */
  wheelTarget: SurfaceId | null;

  registerCanvas: (surfaceId: SurfaceId, canvas: HTMLCanvasElement) => void;
  releaseCanvas: (surfaceId: SurfaceId, canvas: HTMLCanvasElement) => void;
  notifyRaster: (surfaceId: SurfaceId) => void;
  setPlayhead: (at: number) => void;
  /** The single entry point for a press, from a raycast or from a real click. */
  press: (press: SurfacePress) => void;
  /** Scroll a page by one wheel notch / drag, wrapped into its loop. */
  scrollSurface: (surfaceId: SurfaceId, delta: number) => void;
  setWheelTarget: (surfaceId: SurfaceId | null) => void;
  reset: () => void;
};

const INITIAL_CANVASES: Record<SurfaceId, HTMLCanvasElement | null> = {
  square: null,
  sphere: null,
};

const INITIAL_VERSIONS: Record<SurfaceId, number> = { square: 0, sphere: 0 };

const INITIAL_LOG: SurfaceActionLog = EMPTY_SURFACE_LOG;

const INITIAL_SCROLL: Record<SurfaceId, number> = { square: 0, sphere: 0 };

export const useSurfaceStore = create<SurfaceState>((set) => ({
  canvases: INITIAL_CANVASES,
  versions: INITIAL_VERSIONS,
  sphereColor: SPHERE_COLORS[0]!,
  spinRequest: 0,
  log: INITIAL_LOG,
  playhead: 0,
  scroll: INITIAL_SCROLL,
  wheelTarget: null,

  registerCanvas: (surfaceId, canvas) =>
    set((state) => ({ canvases: { ...state.canvases, [surfaceId]: canvas } })),

  // Guarded on identity: the effect cleanup of a remount must not drop the canvas a
  // newer mount just published, which is what a plain `set(null)` would do.
  releaseCanvas: (surfaceId, canvas) =>
    set((state) =>
      state.canvases[surfaceId] === canvas
        ? { canvases: { ...state.canvases, [surfaceId]: null } }
        : state,
    ),

  notifyRaster: (surfaceId) =>
    set((state) => ({
      versions: { ...state.versions, [surfaceId]: state.versions[surfaceId] + 1 },
    })),

  setPlayhead: (at) => set({ playhead: at }),

  scrollSurface: (surfaceId, delta) =>
    set((state) => ({
      scroll: {
        ...state.scroll,
        [surfaceId]: advanceLoopScroll(state.scroll[surfaceId], delta),
      },
    })),

  setWheelTarget: (surfaceId) => set({ wheelTarget: surfaceId }),

  press: (press) =>
    set((state) => {
      const row = appendSurfaceAction(
        state.log,
        press.action,
        press.source,
        press.point,
        press.from,
      );

      return {
        log: row,
        sphereColor:
          press.action === "paint-sphere"
            ? nextSphereColor(state.sphereColor, Math.random)
            : state.sphereColor,
        spinRequest: isSpinRequest(press.action) ? state.spinRequest + 1 : state.spinRequest,
      };
    }),

  reset: () =>
    set((state) => ({
      log: INITIAL_LOG,
      // Back to the first swatch, not to a random one: "reset" that changes the
      // colour to something new reads as a bug.
      sphereColor: SPHERE_COLORS[0]!,
      spinRequest: 0,
      playhead: state.playhead,
      // Reset scrolls the page back to the top of its loop, so "reset" is visible on
      // the texture and not only in the log.
      scroll: INITIAL_SCROLL,
    })),
}));
