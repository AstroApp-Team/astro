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
 * 5. **He is the start button, and he can be moved.** A press on him starts the
 *    conversation (a second one there while it is live is just a greeting), and holding
 *    and dragging puts him anywhere on screen. The press has to be a real DOM element —
 *    `DragHandle` below — because the layer is `pointer-events: none`: a purely arithmetic
 *    hit test can decide that a press *was* on him, but it cannot stop the button underneath
 *    from also receiving it, and it cannot use pointer capture to keep a drag alive once the
 *    finger outruns his disc.
 */

import { Canvas, useThree } from "@react-three/fiber";
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";

import { ASTRO_REACTION_MS } from "../../lib/astro/expression.ts";
import {
  ASTRO_CORNER_HALO_WORLD,
  anchoredPosition,
  clampAnchor,
  cornerPosition,
  orthographicHalfExtent,
  orthographicZoom,
} from "../../lib/astro/corner.ts";
import {
  gazeDirection,
  pixelsToViewport,
  tapIntent,
  viewportToPixels,
} from "../../lib/astro/interaction.ts";
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

/**
 * How far a press may travel before it becomes a drag instead of a tap.
 *
 * Not zero: a tap on a phone moves a few pixels, and a character whose every tap turned into
 * a two-pixel drag would never start a conversation. Not large either, or the first part of a
 * drag would be swallowed. Eight pixels is about a fingertip's wobble.
 */
const DRAG_SLOP_PX = 8;

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

/** The character's position for the current camera, read inside the canvas. */
function CornerCharacter() {
  const size = useThree((state) => state.size);
  const camera = useThree((state) => state.camera);
  const getThree = useThree((state) => state.get);
  /* Subscribed, not read with `getState()`: a drag has to move the mesh, and this is the one
     prop on the character that comes from the page. */
  const anchor = useAstroStore((state) => state.anchor);
  const heroSpot = useAstroStore((state) => state.heroSpot);

  /* Orthographic: R3F sizes the frustum in pixels (`left = -width/2`) and divides by
     `zoom`, so a world unit occupies `zoom` pixels. Only `zoom` is ours. */
  const zoom = orthographicZoom(size.width, size.height, HALO_COVERAGE);
  const extent = orthographicHalfExtent(size.width, size.height, zoom);

  let position: [number, number, number];
  if (anchor != null) {
    position = anchoredPosition(anchor, extent, CHARACTER_Z);
  } else if (heroSpot != null) {
    position = [heroSpot.x * extent.halfWidth, heroSpot.y * extent.halfHeight, CHARACTER_Z];
  } else {
    position = cornerPosition(extent, CHARACTER_Z);
  }

  /* Applied in a layout effect, not during render, and on a camera read from `get()`
     rather than the subscribed `camera`: the React Compiler (panicThreshold
     `all_errors`, see vite.config.ts) rejects mutating a value a hook returned. The
     layout effect still lands before the next frame is drawn. The matrix has to be
     rebuilt because R3F does not know the zoom changed. `camera` stays in the deps so
     a replaced camera gets the zoom too. */
  useLayoutEffect(() => {
    const live = getThree().camera;
    live.zoom = zoom;
    live.updateProjectionMatrix();
  }, [getThree, camera, zoom]);

  /*
   * His position in the *same* viewport space the pointer is written in, so the pointer
   * handler can subtract it. Orthographic projection makes this arithmetic rather than a
   * matrix: the frame spans `±halfWidth`, and three's camera space has y up, which is the
   * same convention as screen space with y up.
   *
   * Published from an effect: writing to a store during render is a side effect the
   * React Compiler refuses to compile around.
   */
  const originX = position[0] / extent.halfWidth;
  const originY = position[1] / extent.halfHeight;
  /* `zoom` is pixels per world unit, so this is the glow's radius on screen — the one
     quantity the press handler needs and the canvas is the only place that knows. */
  const haloRadiusPx = ASTRO_CORNER_HALO_WORLD * zoom;
  useLayoutEffect(() => {
    useAstroStore.getState().setLookOrigin(originX, originY, haloRadiusPx);
  }, [originX, originY, haloRadiusPx]);

  return <AstroCharacter position={position} />;
}

/**
 * The press target: a transparent disc over the character that is the only part of this
 * layer a press can reach.
 *
 * It exists because the arithmetic hit test could not do two things. It could not *stop* the
 * press: with the layer `pointer-events: none`, a tap on him also reached whatever button sat
 * underneath, so starting a conversation by tapping the character would have pressed the
 * page's own Start button as well. And it could not survive a drag: once the finger leaves
 * his disc there is nothing left listening, and pointer capture needs an element to capture
 * *to*. A real button gets both for free — and keyboard users get a labelled control.
 *
 * The disc is positioned from the same `[-1, 1]` numbers everything else uses, so it cannot
 * drift from the character: percentages of the viewport need no resize listener, and the
 * anchor and the look origin are already in that space.
 */
function DragHandle() {
  const anchor = useAstroStore((state) => state.anchor);
  const lookOrigin = useAstroStore((state) => state.lookOrigin);
  const lookRadius = useAstroStore((state) => state.lookRadius);
  const live = useAstroStore((state) => state.live);
  const [dragging, setDragging] = useState(false);

  const settleTimer = useRef<number | undefined>(undefined);
  const drag = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    grabX: number;
    grabY: number;
    moved: boolean;
  } | null>(null);

  useEffect(() => () => window.clearTimeout(settleTimer.current), []);

  const centre = anchor ?? lookOrigin;
  const radius = lookRadius > 0 ? Math.max(lookRadius * POKE_RADIUS_RATIO, 22) : 0;

  /**
   * Pointer pixels → an anchor, clamped by the character's own body radius.
   *
   * Uses the viewport's orthographic zoom directly so clamping stays exact while
   * Astro animates between shrunk and full-size radii.
   */
  const anchorAt = (x: number, y: number) => {
    const next = pixelsToViewport({ x, y }, window.innerWidth, window.innerHeight);
    const zoom = orthographicZoom(window.innerWidth, window.innerHeight, HALO_COVERAGE);
    return clampAnchor(next, orthographicHalfExtent(window.innerWidth, window.innerHeight, zoom));
  };

  const onPointerDown = (event: ReactPointerEvent<HTMLButtonElement>) => {
    event.preventDefault();
    /* Capture, so a drag keeps arriving after the cursor leaves the disc — which it does
       immediately, because the disc is small and a drag is not. */
    event.currentTarget.setPointerCapture(event.pointerId);

    const origin = viewportToPixels(centre, window.innerWidth, window.innerHeight);
    drag.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      /* The offset between the finger and his centre, so he does not jump to the cursor. */
      grabX: event.clientX - origin.x,
      grabY: event.clientY - origin.y,
      moved: false,
    };
    setDragging(true);
    useAstroStore.getState().setDragging(true);
  };

  const onPointerMove = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const current = drag.current;
    if (current == null || current.pointerId !== event.pointerId) return;

    if (Math.hypot(event.clientX - current.startX, event.clientY - current.startY) > DRAG_SLOP_PX) {
      current.moved = true;
    }
    if (!current.moved) return;

    useAstroStore
      .getState()
      .setAnchor(anchorAt(event.clientX - current.grabX, event.clientY - current.grabY));
  };

  /**
   * Up ends the gesture, and a gesture that never moved is a tap.
   *
   * When disconnected it starts the voice session, and while connected it greets.
   */
  const onPointerUp = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const current = drag.current;
    drag.current = null;
    setDragging(false);
    const store = useAstroStore.getState();
    store.setDragging(false);
    if (current == null || current.pointerId !== event.pointerId || current.moved) return;

    store.react();
    window.clearTimeout(settleTimer.current);
    settleTimer.current = window.setTimeout(() => store.settle(), ASTRO_REACTION_MS.max);

    if (tapIntent(store.live) !== "start") return;

    /*
     * He is the start button, but a locked page has no session to start — `voice` is `null`
     * while the gate is up. A tap there still has to *answer*, or a first-time visitor taps
     * the character and concludes nothing works: it puts the cursor in the password field,
     * which is the one thing standing between them and a conversation.
     */
    if (store.voice) {
      store.voice.start();
      return;
    }

    document.querySelector<HTMLInputElement>("ion-input input")?.focus();
  };

  const onPointerCancel = () => {
    drag.current = null;
    setDragging(false);
    useAstroStore.getState().setDragging(false);
  };

  return (
    <button
      type="button"
      className={`astro-handle${dragging ? " astro-handle--dragging" : ""}`}
      /* Hidden until the canvas has told us how big he is — a zero-radius disc is a control
         that exists but cannot be hit. */
      style={{
        left: `${50 + centre.x * 50}%`,
        top: `${50 - centre.y * 50}%`,
        width: radius * 2,
        height: radius * 2,
        visibility: radius > 0 ? "visible" : "hidden",
      }}
      aria-label={
        live ? "Astro está ouvindo — toque para cumprimentá-lo" : "Começar a conversar com o Astro"
      }
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerCancel}
    />
  );
}

export default function AstroOverlay() {
  /* A tab the user has left is a paused render: this layer is a presence, not a process. */
  const [visible, setVisible] = useState(true);
  const hidden = useAstroStore((state) => state.hidden);
  useEffect(() => {
    const onVisibility = () => setVisible(!document.hidden);
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, []);

  useEffect(() => {
    const follow = (event: PointerEvent) => {
      /* Mouse only: a finger that drags to scroll the page would drag his eyes with it. The
         touch path is `pointerdown` — one position per touch, held like a resting cursor. */
      if (event.pointerType === "touch" || useAstroStore.getState().hidden) return;

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
   * Every press is also a look.
   *
   * The touch equivalent of `pointermove`: a finger has no hover, so the point it lands on is
   * the only "where the cursor is" it gets, and it is held there like a resting cursor. This
   * stays on the window rather than on the handle because a press anywhere on the page should
   * turn his eyes — that is the whole point of a corner presence — and the handle's own press
   * is one of those presses.
   *
   * What is *not* here any more is the arithmetic hit test: the tap and the drag belong to
   * `DragHandle`, which is the only element in this layer that events can reach. See its
   * comment for why a distance test was not enough.
   */
  useEffect(() => {
    const poke = (event: PointerEvent) => {
      if (useAstroStore.getState().hidden) return;
      const look = lookDirectionFromPointer(event);
      useAstroStore.getState().setLook(look.x, look.y);
    };

    window.addEventListener("pointerdown", poke);
    return () => window.removeEventListener("pointerdown", poke);
  }, []);

  /*
   * Rendered by `App` as a direct child of `<IonApp>`, not inside `IonContent`:
   * `IonContent` is its own stacking context, so a `position: fixed` child of it paints
   * inside that box and can be covered by the page's own scroll content. Not on
   * `document.body` either: Ionic stacks its modals inside `<ion-app>`, so a body-level
   * layer painted over the transcript sheet. Here he sits over the page and under its
   * overlays, and `pointer-events: none` means he never eats a press.
   */
  return (
    <div className={`astro-overlay${hidden ? " astro-overlay--hidden" : ""}`}>
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
          frameloop={visible && !hidden ? "always" : "never"}
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
      {/* Outside the boundary on purpose: a WebView with no WebGL loses the character, and
          with him the page's only start button would go too — the notice inside
          `CanvasBoundary` is then the thing to press, which is why it is a real button. */}
      {!hidden && <DragHandle />}
    </div>
  );
}
