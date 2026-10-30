import { SURFACE_SPECS } from "@core/models/surface.ts";
import type { SurfaceId } from "@core/models/surface.ts";
import { useSurfaceRaster } from "@infra/surface/useSurfaceRaster.ts";
import { useSurfaceStore } from "@presentation/state/useSurfaceStore.ts";

import type { ReactNode, RefObject } from "react";
import { useRef } from "react";

/**
 * One surface page: the off-screen DOM, the canvas it is rasterized into, and the
 * wiring that keeps the two in step.
 *
 * The DOM is parked 10 000 px to the left, not `display: none` and not `opacity: 0`.
 * A subtree the browser does not lay out has no boxes to measure: `getBoundingClientRect`
 * answers 0×0, the button rects are all zero, and every raycast misses. Invisible
 * must mean *laid out and off screen*.
 *
 * The canvas is a real element, not an offscreen canvas, so the raster's
 * `drawImage` and the texture's upload are ordinary 2d-context work with no extra
 * copy. It is parked off screen too — it is the page's own picture, and the user
 * sees the mesh, not the canvas.
 */
export function SurfaceHost({
  surfaceId,
  children,
}: {
  surfaceId: SurfaceId;
  children: ReactNode;
}) {
  const spec = SURFACE_SPECS[surfaceId];
  const hostRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const registerCanvas = useSurfaceStore((state) => state.registerCanvas);
  const releaseCanvas = useSurfaceStore((state) => state.releaseCanvas);
  const notifyRaster = useSurfaceStore((state) => state.notifyRaster);

  // Plain closures over stable store actions. `useSurfaceRaster` reads them through a
  // ref, so nothing here depends on the React Compiler memoizing them — the effect
  // that owns the observers must not be re-created by a parent render.
  const onCanvas = (canvas: HTMLCanvasElement | null) => {
    const element = canvasRef.current;
    if (canvas == null) {
      if (element != null) releaseCanvas(surfaceId, element);
      return;
    }
    registerCanvas(surfaceId, canvas);
  };

  const onRaster = () => {
    notifyRaster(surfaceId);
  };

  useSurfaceRaster({
    surfaceId,
    hostRef: hostRef as RefObject<HTMLElement | null>,
    canvasRef,
    width: spec.width,
    height: spec.height,
    onCanvas,
    onRaster,
  });

  return (
    <div className="surface-hosts__item">
      <canvas
        ref={canvasRef}
        width={spec.width}
        height={spec.height}
        className="surface-host__canvas"
        aria-hidden="true"
      />
      <div
        className="surface-host"
        ref={hostRef}
        style={{ width: `${spec.width}px`, height: `${spec.height}px` }}
        aria-hidden="true"
      >
        {children}
      </div>
    </div>
  );
}
