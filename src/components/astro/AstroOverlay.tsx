/**
 * Astro as a corner presence over the voice page — one character, in the bottom-right
 * of the viewport, drawing over the page rather than sitting beside it.
 *
 * Three things make this shape different from a normal canvas box:
 *
 * 1. **The canvas is `pointer-events: none`, so the page keeps its clicks.** The layer
 *    covers the whole viewport, and every button underneath it must still work. That
 *    also means R3F's own listeners never fire (the hit test skips this element), so
 *    there is no `eventSource` and no raycast here: the pointer is read from a plain
 *    `pointermove` on the window, and a tap on him is a distance test against his screen
 *    position — mesh-level `onPointerDown` is dead code in this shape, for both the mouse
 *    and a finger.
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

import { ASTRO_REACTION_MS } from "../../lib/astro/expression.ts";
import {
  ASTRO_CORNER_HALO_WORLD,
  cornerPosition,
  orthographicHalfExtent,
  orthographicZoom,
} from "../../lib/astro/corner.ts";
import { gazeDirection, hitsCharacter, viewportToPixels } from "../../lib/astro/interaction.ts";
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
 * How much of the **longer** viewport side the halo **diameter** covers.
 *
 * `orthographicZoom` is `max(w, h) · coverage / (2 · haloRadius)`, so the whole glow spans
 * `coverage` of the longer side and the body — at `1.9` halo radii — spans `coverage / 1.9`
 * of it.
 *
 * Sizing against the shorter side was the phone problem: a portrait handset was measured by
 * its narrow width, which is the dimension it has least of, so he came out ~62px across on a
 * 390px screen — an icon — while the same rule looked right on a monitor whose shorter side
 * is 900px. 25% of the longer side restates the monitor's old framing (360px of 1440) and
 * gives a 390×844 phone 211px instead of 156px.
 *
 * Under an orthographic camera the size is `zoom`, not distance, so this is the only knob —
 * and the only thing to change if he needs to be bigger again.
 */
const HALO_COVERAGE = 0.25;

/**
 * How much of the glow radius counts as "on him" for a press.
 *
 * Not the whole halo: the outer third of the glow is a fade that overlaps the page's own
 * controls in the bottom-right (the mic), and a press on a button must stay a press on the
 * button. 0.75 of the glow is still a ~58px target on a phone, well past the 44px minimum.
 */
const POKE_RADIUS_RATIO = 0.75;

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
 *
 * Both pointers are welcome here. Which *events* call it is what differs: a mouse calls it on
 * every move (the cursor has a position even when it is still), a finger only calls it on
 * `pointerdown` — the touch equivalent of "the cursor is there now". A finger that drags to
 * scroll must not drag his eyes, so `pointermove` stays mouse-only at the call site.
 */
function lookDirectionFromPointer(event: PointerEvent): { x: number; y: number } {
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
  useAstroStore.getState().setLookOrigin(
    position[0] / extent.halfWidth,
    position[1] / extent.halfHeight,
    /* `zoom` is pixels per world unit, so this is the glow's radius on screen — the one
         quantity the press handler needs and the canvas is the only place that knows. */
    ASTRO_CORNER_HALO_WORLD * camera.zoom,
  );

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
      /* Mouse only: a finger that drags to scroll the page would drag his eyes with it. The
         touch path is `pointerdown` — one position per touch, held like a resting cursor. */
      if (event.pointerType === "touch") return;

      const look = lookDirectionFromPointer(event);
      useAstroStore.getState().setLook(look.x, look.y);
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
   * A press, hit-tested in screen space.
   *
   * This is the touch path as well as the mouse path — `pointerdown` covers both — and it
   * has to be arithmetic because the layer is `pointer-events: none`: the browser never
   * delivers a press to the canvas, so R3F's raycast never runs and `onPointerDown` on the
   * mesh is dead code here. A press that lands outside his disc is not touched at all, so
   * every button underneath keeps working.
   */
  useEffect(() => {
    let settleTimer: number | undefined;

    const poke = (event: PointerEvent) => {
      const { lookOrigin, lookRadius, setLook, react, settle } = useAstroStore.getState();
      const centre = viewportToPixels(lookOrigin, window.innerWidth, window.innerHeight);

      /*
       * Every press is also a look, and this runs before the hit test so a press anywhere in
       * the page turns his eyes toward it. It is the touch equivalent of `pointermove`: a
       * finger has no hover, so the point it lands on is the only "where the cursor is" it
       * gets, and it is held there like a resting cursor rather than tracked.
       */
      const look = lookDirectionFromPointer(event);
      setLook(look.x, look.y);

      if (
        !hitsCharacter(
          { x: event.clientX, y: event.clientY },
          centre,
          lookRadius * POKE_RADIUS_RATIO,
        )
      ) {
        return;
      }

      react();
      /* One reaction at a time: a second tap restarts the clock rather than stacking timers,
         so a satisfied `happy` cannot outlive the last tap. */
      window.clearTimeout(settleTimer);
      settleTimer = window.setTimeout(() => settle(), ASTRO_REACTION_MS.max);
    };

    window.addEventListener("pointerdown", poke);
    return () => {
      window.removeEventListener("pointerdown", poke);
      window.clearTimeout(settleTimer);
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
          /*
           * **Required, and not redundant with `.astro-overlay`'s `pointer-events: none`.**
           * R3F writes `pointerEvents` into its own root div *inline* — `'none'` only when
           * `eventSource` is set, `'auto'` otherwise (`@react-three/fiber`
           * `react-three-fiber.esm.js:159: const pointerEvents = eventSource ? 'none' : 'auto'`) —
           * and an inline style beats a stylesheet rule. Left alone, the canvas sits above the
           * page at `z-index: 1` and swallows every click and tap in the viewport: the password
           * field could not be focused and its Unlock button never fired. `...style` is spread
           * *after* that inline default, so this wins.
           */
          style={{ pointerEvents: "none" }}
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
