import { Canvas } from "@react-three/fiber";
import { Suspense } from "react";
import type { CSSProperties } from "react";

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
};

export default function MainCanvas({ scene, className, style }: MainCanvasProps) {
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
