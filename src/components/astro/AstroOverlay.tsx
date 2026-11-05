/**
 * Astro as a corner presence over the voice page — one character, in the bottom-right
 * of the viewport, drawing over the page rather than sitting beside it.
 *
 * Three things make this shape different from a normal canvas box:
 *
 * 1. **The canvas is `pointer-events: none`, so the page keeps its clicks.** The layer
 *    covers the whole viewport, and every button underneath it must still work. That
 *    also means R3F's own listeners never fire (the hit test skips this element), so
 *    there is no `eventSource` and no raycast here: nothing in this shape is a hit
 *    target, and the pointer is read from a plain `pointermove` on the window.
 *
 * 2. **The corner is computed, not hard-coded.** The body's world size is fixed, so a
 *    corner position written in world units lands somewhere different on every aspect
 *    ratio. The inset is derived from what the camera can actually see at the
 *    character's plane, so he stays in the corner on a phone and on a wide monitor.
 *
 * 3. **The inset is measured against the halo, not the body.** The glow shell is
 *    `ASTRO_V2_HALO_RADIUS` (`1.9`× the body); pulled flush to the corner, half the
 *    halo is off-screen and he reads as a plain orange disc. The inset keeps most of
 *    the halo on screen while still letting the rim sit near the edge.
 */

import { Canvas, useThree } from "@react-three/fiber";
import { createPortal } from "react-dom";
import { PerspectiveCamera } from "three";
import { useEffect, useState } from "react";

import { cornerPosition } from "../../lib/astro/corner.ts";
import { useAstroStore } from "../../lib/astro/store.ts";
import { CanvasBoundary } from "../CanvasBoundary.tsx";
import { AstroCharacter } from "./AstroCharacter.tsx";

/**
 * The hero camera: the framing `clean-refactor` measured for `/astro-v2` (`AGENTS.md` —
 * body 18% of viewport height, halo 35%). At this distance the visible height at the
 * character's plane is `2 · tan(fov/2) · 7.5 ≈ 6.2` world units against a body diameter
 * of 0.95, so the disc is ~15% of the viewport height and the halo ~29% — a presence in
 * a corner, not a hero filling the screen.
 */
const OVERLAY_CAMERA = { position: [0, 0, 7.5], fov: 45 } as const;

/** The character's plane. Everything else is derived from the camera's distance to it. */
const CHARACTER_Z = 0;

/**
 * How far in from the corner the body's centre sits — `ASTRO_CORNER_INSET_RATIO`, in
 * `lib/astro/corner.ts`, where the arithmetic is testable without a canvas.
 */

/**
 * Where the pointer is, as `[-1, 1]` across the viewport, y up. A plain listener on the
 * window: the canvas is not a hit target, so there is nothing to raycast and nothing to
 * gate (`isMeshPressTarget` exists to stop presses reaching a mesh, and there is no mesh
 * press here).
 */
function lookFromPointer(event: PointerEvent): { x: number; y: number } | null {
  /* Mouse only. A finger that drags the page must not drag his eyes. */
  if (event.pointerType === "touch") return null;
  return {
    x: (event.clientX / window.innerWidth) * 2 - 1,
    y: -((event.clientY / window.innerHeight) * 2 - 1),
  };
}

/** The character's corner position for the current camera, read inside the canvas. */
function CornerCharacter() {
  const size = useThree((state) => state.size);
  const camera = useThree((state) => state.camera);

  /* What the camera sees at the character's plane: R3F keeps `aspect` in step with the
     canvas, and the distance is camera-to-plane along z, which is the framing's own axis. */
  const fov = camera instanceof PerspectiveCamera ? camera.fov : 45;
  const position = cornerPosition({
    aspect: size.width / Math.max(size.height, 1),
    cameraZ: camera.position.z,
    fovDeg: fov,
    characterZ: CHARACTER_Z,
  });

  return <AstroCharacter position={position} />;
}

export default function AstroOverlay() {
  /* A tab the user has left is a paused render: this layer is a presence, not a process. */
  const [visible, setVisible] = useState(true);
  useEffect(() => {
    const onVisibility = () => setVisible(!document.hidden);
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, []);

  useEffect(() => {
    const follow = (event: PointerEvent) => {
      const look = lookFromPointer(event);
      if (look) useAstroStore.getState().setLook(look.x, look.y);
    };
    const leave = () => useAstroStore.getState().setLook(0, 0);

    window.addEventListener("pointermove", follow);
    window.addEventListener("pointerleave", leave);
    return () => {
      window.removeEventListener("pointermove", follow);
      window.removeEventListener("pointerleave", leave);
    };
  }, []);

  /*
   * Portalled to `document.body`, not left inside `IonContent`: `IonContent` is its own
   * stacking context, so a `position: fixed` child of it paints inside that box and can
   * be covered by the page's own scroll content. As a body-level layer it sits over
   * everything, and `pointer-events: none` means it never eats a press.
   */
  return createPortal(
    <div className="astro-overlay">
      {/* Scoped to the canvas: a WebView with no GL context loses the character, not the
          page. The boundary's own notice is styled into this corner by `theme/astro.css`. */}
      <CanvasBoundary what="Astro">
        <Canvas
          frameloop={visible ? "always" : "never"}
          camera={OVERLAY_CAMERA}
          dpr={[1, 1.5]}
          gl={{
            antialias: false,
            alpha: true,
            powerPreference: "high-performance",
            /* Android WebView often reports a software driver; refusing the context would
               be a missing character, which reads as a bug in the page. */
            failIfMajorPerformanceCaveat: false,
          }}
        >
          <CornerCharacter />
        </Canvas>
      </CanvasBoundary>
    </div>,
    document.body,
  );
}
