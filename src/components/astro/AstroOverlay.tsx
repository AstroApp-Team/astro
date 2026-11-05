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
 * 3. **The inset is measured against the halo, not the body.** The glow shell is
 *    `ASTRO_V2_HALO_RADIUS` (`1.9`× the body); pulled flush to the corner, half the
 *    halo is off-screen and he reads as a plain orange disc. The inset keeps most of
 *    the halo on screen while still letting the rim sit near the edge.
 * 4. **The camera is orthographic.** See `CAMERA_DISTANCE` below — this is what makes the
 *    two eyes read as one aligned pair instead of two shapes at different scales.
 */

import { Canvas, useThree } from "@react-three/fiber";
import { createPortal } from "react-dom";
import { useEffect, useState } from "react";

import {
  cornerPosition,
  orthographicHalfExtent,
  orthographicZoom,
} from "../../lib/astro/corner.ts";
import { gazeDirection } from "../../lib/astro/interaction.ts";
import { useAstroStore } from "../../lib/astro/store.ts";
import { CanvasBoundary } from "../CanvasBoundary.tsx";
import { AstroCharacter } from "./AstroCharacter.tsx";

/**
 * The framing is **orthographic**, and that is the fix for the eyes rather than a taste
 * choice. A perspective camera at a face-close distance projects the nearer eye larger
 * than the farther one and shears each prism along its own radial normal, so the two eyes
 * read as misaligned shapes at different scales — the complaint this replaced. Orthographic
 * projection has no distance dependence: axes that are parallel in the rig project parallel
 * on screen, and the framing stops being a function of how far back the camera sits.
 *
 * The distance is still set, because `near`/`far` bound what is drawn and the eye prisms
 * stick out toward the camera from the body's surface.
 */
const CAMERA_DISTANCE = 7.5;
const CAMERA_NEAR = 0.1;
const CAMERA_FAR = 100;

/**
 * The camera props R3F builds the default camera from. `zoom` is a starting value: a world
 * unit occupies `zoom` pixels, and `CornerCharacter` recomputes it from the canvas size so
 * the halo keeps its coverage on every viewport. R3F keeps `left`/`right`/`top`/`bottom` in
 * step with the canvas and rebuilds the projection matrix on resize; the zoom we set survives
 * that because it is not part of the frustum it writes.
 */
const OVERLAY_CAMERA = {
  position: [0, 0, CAMERA_DISTANCE],
  near: CAMERA_NEAR,
  far: CAMERA_FAR,
  zoom: 100,
} as const;

/**
 * How much of the shorter viewport side the halo covers.
 *
 * 30% restates the perspective framing `clean-refactor` measured for `/astro-v2`
 * (`AGENTS.md`: body 18% of viewport height, halo 35%) against the **shorter** side, so a
 * portrait phone gets the same presence as a wide monitor. Under an orthographic camera the
 * size is `zoom`, not distance, so this is the only knob.
 */
const HALO_COVERAGE = 0.3;

/** The character's plane. */
const CHARACTER_Z = 0;

/**
 * How far in from the corner the body's centre sits — `ASTRO_CORNER_INSET_RATIO`, in
 * `lib/astro/corner.ts`, where the arithmetic is testable without a canvas.
 */

/**
 * Where the pointer is, as a **direction to the pointer**, in `[-1, 1]` viewport space, y up.
 *
 * Two things are load-bearing here:
 *
 * - **The listener is on the window, not the canvas.** The layer is `pointer-events: none`
 *   so the page keeps its clicks, which means R3F's own hit test skips this element and
 *   `onPointerMove` never fires on it. A window listener sees the cursor wherever it is —
 *   over the header, the transcript, and the footer.
 * - **The gaze is relative to him, not to the viewport.** Absolute viewport coordinates made
 *   him stare away from the cursor whenever the cursor sat near him, because he lives in the
 *   bottom-right corner and never sits at `(0, 0)`. Subtracting his own position turns the
 *   pointer into the direction he should look, which is what "looking at the mouse" means on
 *   a corner presence.
 */
function lookDirectionFromPointer(event: PointerEvent): { x: number; y: number } | null {
  /* Mouse only. A finger that drags the page must not drag his eyes. */
  if (event.pointerType === "touch") return null;

  const pointer = {
    x: (event.clientX / window.innerWidth) * 2 - 1,
    y: -((event.clientY / window.innerHeight) * 2 - 1),
  };
  return gazeDirection(pointer, useAstroStore.getState().lookOrigin);
}

/** The character's corner position for the current camera, read inside the canvas. */
function CornerCharacter() {
  const size = useThree((state) => state.size);
  const camera = useThree((state) => state.camera);

  /* Orthographic: R3F sizes the frustum in pixels (`left = -width/2`) and divides by
     `zoom`, so a world unit occupies `zoom` pixels. Only `zoom` is ours, and the matrix
     has to be rebuilt because R3F does not know it changed. */
  camera.zoom = orthographicZoom(size.width, size.height, HALO_COVERAGE);
  camera.updateProjectionMatrix();

  const extent = orthographicHalfExtent(size.width, size.height, camera.zoom);
  const position = cornerPosition(extent, CHARACTER_Z);

  /*
   * His position in the *same* viewport space the pointer is written in, so the pointer
   * handler can subtract it. Orthographic projection makes this arithmetic rather than a
   * matrix: the frame spans `±halfWidth`, and three's camera space has y up, which is the
   * same convention as screen space with y up.
   */
  useAstroStore
    .getState()
    .setLookOrigin(position[0] / extent.halfWidth, position[1] / extent.halfHeight);

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
      const look = lookDirectionFromPointer(event);
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
          /* `orthographic`, not a declared camera element: R3F builds the default camera from
             this flag, and a declared `<orthographicCamera>` would just sit in the scene as an
             object the renderer never looks through. */
          orthographic
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
