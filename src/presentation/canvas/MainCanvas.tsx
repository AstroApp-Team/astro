import { Canvas } from "@react-three/fiber";
import { Suspense } from "react";
import type { CSSProperties, RefObject } from "react";

import type { SceneId } from "@core/models/scene.ts";
import { useSceneStore } from "@presentation/state/useSceneStore.ts";
import { SCENE_COMPONENTS } from "@presentation/canvas/scenes/sceneRegistry.tsx";

/**
 * The root R3F canvas.
 *
 * Mobile WebView notes, all of them load-bearing on a phone:
 *
 *   - `dpr={[1, 1.5]}`. A 3x device pixel ratio is a 9x fragment-shading load
 *     over a 1x one. Phones thermal-throttle the GPU after a minute at full
 *     DPR, and the frame rate falls off a cliff; 1.5 is visually indistinguish-
 *     able on a 6" screen and roughly halves that load.
 *   - `antialias: false`. MSAA is the single most expensive thing a mobile GL
 *     context does, and at DPR 1.5 on a phone its edges are already sub-pixel.
 *     Geometry that needs clean edges gets it from geometry, not from the
 *     framebuffer.
 *   - `failIfMajorPerformanceCaveat: false`. Android's WebView frequently
 *     reports a software GL driver. With the default `true`, context creation is
 *     refused outright and the app shows a black rectangle with no error.
 *   - `touch-action: none` on the container. Without it, a drag inside the scene
 *     is a page scroll, and on iOS a swipe from the left edge is the native
 *     back gesture — the 3D raycast never sees the pointer.
 */
export type MainCanvasProps = {
  /** Overrides the store. The Studio Corner uses this to pin the sandbox. */
  scene?: SceneId;
  className?: string;
  style?: CSSProperties;
  /**
   * Attach R3F's pointer events to this element instead of the canvas.
   *
   * The one prop a transparent overlay canvas needs. R3F sets `pointer-events:
   * none` on the canvas itself when this is provided, so the canvas stops being a
   * hit target and the page under it keeps its own clicks, links and scroll —
   * while the raycast still runs, because the events now come from an ancestor of
   * everything under the pointer. `eventSource` must therefore be an **ancestor of
   * the content you want to stay clickable**, and its box must match the canvas's:
   * R3F derives the pointer's NDC position from `offsetX/offsetY`, which are
   * relative to the event target, so a canvas inset inside a scrolled container
   * and an event source outside it disagree about where the pointer is.
   */
  eventSource?: HTMLElement | RefObject<HTMLElement | null>;
  /**
   * Which coordinate pair R3F derives the pointer from. Default `"offset"`.
   *
   * `eventSource` alone is not enough for a full-bleed overlay. R3F's default
   * compute reads `event.offsetX`, which is relative to the event's **target** —
   * and with an event source the target is whatever DOM element is under the
   * pointer, so a tap on a card two hundred pixels down the page raycasts two
   * hundred pixels off where it landed. `eventPrefix="client"` reads `clientX`
   * instead, which R3F divides by the canvas's own size with no origin
   * subtraction — correct exactly when the canvas's box starts at the viewport
   * origin, i.e. when the overlay is `position: fixed; inset: 0`. That pairing is
   * what `/float` uses: fixed overlay, client prefix, root as event source.
   */
  eventPrefix?: "offset" | "client" | "page" | "layer" | "screen";
};

export default function MainCanvas({
  scene,
  className,
  style,
  eventSource,
  eventPrefix,
}: MainCanvasProps) {
  const activeScene = useSceneStore((state) => state.activeScene);
  const epoch = useSceneStore((state) => state.epoch);

  const key = scene ?? activeScene;
  const Scene = SCENE_COMPONENTS[key];

  return (
    <div
      className={className == null ? "canvas-host" : `canvas-host ${className}`}
      style={{ touchAction: "none", ...style }}
    >
      <Canvas
        dpr={[1, 1.5]}
        gl={{
          antialias: false,
          powerPreference: "high-performance",
          failIfMajorPerformanceCaveat: false,
          alpha: true,
        }}
        camera={{ position: [0, 4, 9], fov: 55 }}
        {...(eventSource == null ? {} : { eventSource })}
        {...(eventPrefix == null ? {} : { eventPrefix })}
      >
        <Suspense fallback={null}>
          {/* R3F keeps GL objects in refs, not React state, so switching scenes
              is a remount. `epoch` is the store's bump for exactly that. */}
          <Scene key={`${key}-${epoch}`} />
        </Suspense>
      </Canvas>
    </div>
  );
}
