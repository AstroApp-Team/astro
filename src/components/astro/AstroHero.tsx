/**
 * Astro on the voice page: the character as the page's hero.
 *
 * This is the temporary integration — the v2 character from the refactor branch,
 * mounted in a normal flow box on `/voice` instead of the full-bleed overlay the
 * refactor's `/astro-v2` used. Two consequences of that change, both deliberate:
 *
 *   - **no `eventSource` / `eventPrefix="client"`.** Those exist to make a
 *     transparent overlay over a React page raycast correctly. Here the canvas is
 *     its own hit target inside a box that contains nothing but the character, so
 *     R3F's default offset math is right, and no press gate is needed: a press can
 *     only land on the canvas.
 *   - **`touch-action: pan-y`, not `none`.** A `none` host eats the page's scroll,
 *     which on a phone means the voice page cannot be scrolled past the hero. A
 *     vertical drag scrolls and cancels the mesh press; a tap still presses.
 *
 * It is **not** dev-gated, and nothing here imports `@theatre/*`, so the same code
 * path runs in a Capacitor WebView on a phone.
 */

import { Canvas, type ThreeEvent } from "@react-three/fiber";
import { useEffect, useRef, useState } from "react";

import { ASTRO_REACTION_MS } from "../../lib/astro/expression.ts";
import { ASTRO_FACE_PICKER } from "../../lib/astro/interaction.ts";
import { isAsleep } from "../../lib/astro/pose.ts";
import { useAstroStore } from "../../lib/astro/store.ts";
import { CanvasBoundary } from "../CanvasBoundary.tsx";

import { AstroCharacter } from "./AstroCharacter.tsx";

/**
 * Framing for the hero box.
 *
 * The refactor measured its character against `[0, 1.6, 7.5]` / `fov 45` on a
 * full-viewport canvas, which put the body at ~18% of the canvas height. This box is
 * much shorter than a viewport, so the same lens would draw a 40 px spark on a
 * phone; `z 5.5` brings the body to ~24% and the halo to ~46% of the box, which is
 * the size the style guide's hero implies without the halo clipping the box.
 *
 * The character sits at `y 1.6` because that is where the camera's view centre is
 * (the camera looks down `-z` from its own position), so the spark is centred in the
 * box rather than floating above it.
 */
const HERO_CAMERA = { position: [0, 1.6, 5.5], fov: 45 } as const;

/** The character's position in the hero's camera space. */
const CHARACTER_POSITION: [number, number, number] = [0, 1.6, 0];

export default function AstroHero() {
  const expression = useAstroStore((state) => state.expression);
  const hostRef = useRef<HTMLDivElement>(null);
  /** The reaction's exit. One timer at a time; a second press re-arms it. */
  const settleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  /**
   * A hidden tab stops the frame loop.
   *
   * R3F renders every frame regardless of visibility, and a phone with the app
   * backgrounded is paying for fragments it will never show — the same reasoning
   * that makes the voice session hang up on `document.hidden`.
   */
  const [visible, setVisible] = useState(!document.hidden);

  useEffect(() => {
    const onVisibility = () => setVisible(!document.hidden);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      if (settleTimerRef.current != null) clearTimeout(settleTimerRef.current);
      /* A pointer that left with the page must not leave the eyes aimed off-centre. */
      useAstroStore.getState().setLook(0, 0);
    };
  }, []);

  /** Clear a reaction, then start the next one. `react()` decides what the tap means. */
  const poke = (event: ThreeEvent<PointerEvent>) => {
    /* The raycast reaches the halo shell too; without this the last hit wins. */
    event.stopPropagation();
    useAstroStore.getState().react();
    if (settleTimerRef.current != null) clearTimeout(settleTimerRef.current);
    settleTimerRef.current = setTimeout(
      () => useAstroStore.getState().settle(),
      ASTRO_REACTION_MS.max,
    );
  };

  /**
   * Pointer attention, in the store's normalised `[-1, 1]`.
   *
   * Read off the host's rect rather than `offsetX/offsetY`: the frame loop damps this
   * toward a target, so the input only has to be steady, and the rect is the same for
   * every event in the box. `y` is negated because the sheet's coordinates are y-down
   * and three's are y-up.
   */
  const follow = (event: React.PointerEvent<HTMLDivElement>) => {
    const rect = hostRef.current?.getBoundingClientRect();
    if (rect == null || rect.width === 0 || rect.height === 0) return;

    const x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    const y = -(((event.clientY - rect.top) / rect.height) * 2 - 1);
    /* Radial clamp, so a corner pointer does not ask for an eye the surface cannot hold. */
    const r = Math.hypot(x, y);
    const k = r > 1 ? 1 / r : 1;
    useAstroStore.getState().setLook(x * k, y * k);
  };

  const pick = (state: (typeof ASTRO_FACE_PICKER)[number]) => {
    if (settleTimerRef.current != null) clearTimeout(settleTimerRef.current);
    useAstroStore.getState().setExpression(state);
  };

  return (
    <div className="astro-hero">
      <div
        ref={hostRef}
        className="astro-hero__canvas"
        style={{ touchAction: "pan-y" }}
        onPointerMove={follow}
        onPointerLeave={() => useAstroStore.getState().setLook(0, 0)}
      >
        {/* Scoped to the canvas: a WebView with no usable GL context must not take the
            voice page down with it. The transcript and the buttons are plain DOM. */}
        <CanvasBoundary what="the character">
          <Canvas
            frameloop={visible ? "always" : "never"}
            dpr={[1, 1.5]}
            gl={{
              antialias: false,
              powerPreference: "high-performance",
              failIfMajorPerformanceCaveat: false,
              alpha: true,
            }}
            camera={HERO_CAMERA}
          >
            <AstroCharacter position={CHARACTER_POSITION} onPress={poke} />
          </Canvas>
        </CanvasBoundary>
      </div>

      <div className="astro-hero__bar">
        <span className="astro-hero__readout">
          <strong>{expression}</strong>
          {isAsleep(expression) ? " · asleep — tap to wake" : " · tap the spark"}
        </span>
        <div className="astro-hero__states">
          {ASTRO_FACE_PICKER.map((state) => (
            <button
              key={state}
              type="button"
              className={`astro-hero__state${state === expression ? " astro-hero__state--active" : ""}`}
              aria-pressed={state === expression}
              onClick={() => pick(state)}
            >
              {state}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
