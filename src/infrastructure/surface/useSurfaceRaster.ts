/**
 * Keeps a surface page's texture current.
 *
 * The page is React. Its texture is a canvas. Nothing connects them: React commits
 * DOM, and a canvas only changes when someone draws into it. This hook is the
 * someone — it watches the host subtree, redraws it on the next frame, and republishes
 * the button rects that the redraw implies.
 *
 * Why a MutationObserver and not a state subscription: the page's state is not the
 * only thing that changes its pixels. A font finishing its load, a CSS class
 * flipping, a `key` remounting a list, a text node growing by one character — all of
 * them change the picture and none of them are visible to a store. Watching the DOM
 * is the one subscription that sees every cause.
 *
 * Why one frame of coalescing: React commits, then commits again. Rasterizing per
 * mutation costs a full style walk per mutation, and a press that appends a log row
 * mutates the page a dozen times. The dirty flag collapses that to one raster.
 */

import { useEffect, useRef } from "react";
import type { RefObject } from "react";
import type { SurfaceId } from "@core/models/surface.ts";
import { clearSurfaceRects, measureSurfaceRects, publishSurfaceRects } from "./surfaceRects.ts";
import { rasterizeHost } from "./rasterizeSurface.ts";

export type SurfaceRasterHandle = {
  /** Redraw on the next frame. Cheap to call; a press calls it for immediate feedback. */
  requestRaster: () => void;
};

export function useSurfaceRaster(options: {
  surfaceId: SurfaceId;
  hostRef: RefObject<HTMLElement | null>;
  canvasRef: RefObject<HTMLCanvasElement | null>;
  width: number;
  height: number;
  onCanvas: (canvas: HTMLCanvasElement | null) => void;
  /** Called after a raster lands, so the mesh can upload the new pixels once. */
  onRaster: () => void;
}): SurfaceRasterHandle {
  const dirtyRef = useRef(false);
  const runningRef = useRef(false);
  const frameRef = useRef<number | null>(null);
  const requestRef = useRef<() => void>(() => {
    dirtyRef.current = true;
  });

  const { surfaceId, hostRef, canvasRef, width, height, onCanvas, onRaster } = options;

  // The callbacks are read through a ref, deliberately. They are props, so their
  // identity belongs to whoever renders the host; the page re-renders at frame rate,
  // and an effect that lists them as dependencies would tear the observers down and
  // rebuild them 60 times a second — clearing the published rects on every frame,
  // which makes every press through a texture miss. The React Compiler memoizes the
  // host's closures today; a ref does not need it to.
  const callbacksRef = useRef({ onCanvas, onRaster });

  useEffect(() => {
    callbacksRef.current = { onCanvas, onRaster };
  }, [onCanvas, onRaster]);

  useEffect(() => {
    const host = hostRef.current;
    const canvas = canvasRef.current;
    if (host == null || canvas == null) return;

    // An in-flight raster resolves whenever it resolves. After a teardown its pixels
    // are worthless, and publishing rects for a host that no longer exists leaves
    // `findSurfaceRect` answering for a surface with nothing behind it.
    let disposed = false;

    callbacksRef.current.onCanvas(canvas);

    const draw = () => {
      frameRef.current = null;
      if (disposed) return;
      if (runningRef.current) {
        // A raster in flight cannot see the DOM as it is now. Re-dirty; the frame that
        // continues it is scheduled by the raster that finished, not by polling.
        dirtyRef.current = true;
        return;
      }

      if (!dirtyRef.current) return;
      dirtyRef.current = false;
      runningRef.current = true;

      void rasterizeHost(host, canvas, width, height).then((outcome) => {
        runningRef.current = false;
        if (disposed) return;

        if (!outcome.ok) {
          console.warn(`surface: ${outcome.reason}`, { surfaceId });
          if (dirtyRef.current) schedule();
          return;
        }

        // The rects move when the page reflows, and a reflow is exactly what a
        // raster observes — so they are measured here, not on their own schedule.
        publishSurfaceRects(surfaceId, measureSurfaceRects(host));
        callbacksRef.current.onRaster();

        // The page changed while these pixels were being made. Without this the last
        // commit of a burst is never drawn, and the texture sits one step behind the
        // page: the press repaints the sphere, the sphere page's own row never shows.
        if (dirtyRef.current) schedule();
      });
    };

    const schedule = () => {
      dirtyRef.current = true;
      if (frameRef.current == null) frameRef.current = requestAnimationFrame(draw);
    };

    requestRef.current = schedule;

    const observer = new MutationObserver(schedule);
    observer.observe(host, {
      childList: true,
      subtree: true,
      attributes: true,
      characterData: true,
    });

    const resize = new ResizeObserver(schedule);
    resize.observe(host);

    // A font arriving late changes every text metric in the page. Nothing else
    // notices; the observer does not fire, and the texture is silently stale.
    if (typeof document !== "undefined" && "fonts" in document) {
      void document.fonts.ready.then(schedule);
    }

    schedule();

    return () => {
      disposed = true;
      observer.disconnect();
      resize.disconnect();
      if (frameRef.current != null) cancelAnimationFrame(frameRef.current);
      frameRef.current = null;
      requestRef.current = () => {
        dirtyRef.current = true;
      };
      callbacksRef.current.onCanvas(null);
      clearSurfaceRects(surfaceId);
    };
  }, [canvasRef, hostRef, height, surfaceId, width]);

  return {
    requestRaster: () => {
      requestRef.current();
    },
  };
}
