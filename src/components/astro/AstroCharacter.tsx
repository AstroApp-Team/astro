/**
 * Astro v2's body: one sphere, two eye prisms, one halo shell — all shader-lit.
 *
 * Ported from the refactor branch's `presentation/canvas/astroV2/AstroV2Character.tsx`.
 * Two things were removed on the way over, and both were Theatre-only:
 *
 *   - the group is a plain `<group>`, not `editable.group`. `main` has no
 *     `@theatre/r3f`, so there is no rig to own the transform; the hero owns
 *     `position` in JSX and nothing else moves the group.
 *   - the hover handlers, which wrote `useSceneStore` — an outliner that does not
 *     exist on this branch. The press is the only mesh → page signal.
 *
 * ## Why the eyes are placed per frame instead of in the JSX
 *
 * Their position is the solution of "walk `d` along the surface from this point", and
 * their orientation is that surface's normal. That is a per-frame computation from
 * store state read with `getState()` — a subscription would re-render this group
 * sixty times a second to move two prisms the frame loop is already moving, and React
 * must not own a value the loop writes, or the two disagree and the eyes stutter.
 *
 * ## The prisms are sunk, and their faces point inward
 *
 * Each eye is an elliptical prism whose axis is the local normal, pushed a fraction of
 * its depth *into* the body. Its material draws back faces only and ignores depth, so
 * what the camera sees is the inside of a well: a bright plate at the bottom, a warm
 * wall around it. That is the sheet's sunken look, and being a shading trick it
 * survives oblique angles the way a flattened disc would not.
 */

import { type ThreeEvent, useFrame } from "@react-three/fiber";
import { useEffect, useRef } from "react";
import { MathUtils, type Mesh, Vector3 } from "three";

import {
  ASTRO_V2_BODY_RADIUS,
  ASTRO_V2_EYE,
  ASTRO_V2_LOOK_RANGE,
} from "../../lib/astro/astroV2.ts";
import { followPointer, followsPointer, resolveEyePose } from "../../lib/astro/pose.ts";
import { useAstroStore, useAstroV2Store } from "../../lib/astro/store.ts";

import { eyeGeometry } from "./eyeGeometry.ts";
import {
  applyTunables,
  bodyMaterial,
  bodyUniforms,
  eyeMaterial,
  eyeUniforms,
  haloMaterial,
  haloUniforms,
} from "./materials.ts";

/**
 * The `±1` attention the eyes follow, in world units.
 *
 * `1` is the sheet's most extreme placement, so these are only the conversion from the
 * sheet's normalised units to world units — `resolveEyePose` already decided how far a
 * given expression looks.
 */
const LOOK_WORLD = {
  x: ASTRO_V2_LOOK_RANGE.x,
  y: ASTRO_V2_LOOK_RANGE.y,
} as const;

/** Exponential smoothing. A one-euro filter would be the right tool; this is within a pixel of it here. */
function damp(current: number, target: number, lambda: number, delta: number): number {
  return MathUtils.lerp(current, target, 1 - Math.exp(-lambda * delta));
}

export type AstroCharacterProps = {
  /** Where the character sits, in the hero's camera space. */
  position?: [number, number, number];
  /** A press that reached the body. */
  onPress?: (event: ThreeEvent<PointerEvent>) => void;
};

/** A body with no handler: still tappable, the press just does nothing. */
const NO_PRESS = () => {};

export function AstroCharacter({
  position = [0, 1.6, 0],
  onPress = NO_PRESS,
}: AstroCharacterProps) {
  const tunables = useAstroV2Store((state) => state.tunables);
  /*
   * Subscribed normally: the expression changes on a press or a session event, not
   * per frame, and the render it triggers is what hands the pose constants to the
   * frame loop below.
   */
  const expression = useAstroStore((state) => state.expression);

  const bodyRef = useRef<Mesh>(null);
  const leftEyeRef = useRef<Mesh>(null);
  const rightEyeRef = useRef<Mesh>(null);

  /** Smoothed morph weights, so a pose change is an expression and not a jump cut. */
  const morph = useRef({ happy: 0, sleepy: 0, stretch: 1 });
  /** Smoothed attention, in sheet-normalised `[-1, 1]`. */
  const look = useRef({ x: 0, y: 0 });
  /** The body's world position, reused per frame so the loop allocates nothing. */
  const world = useRef(new Vector3());

  /** The pose's constants, resolved in render so the loop does not recompute them per frame. */
  const pose = resolveEyePose(expression);

  useEffect(() => {
    applyTunables(tunables);
  }, [tunables]);

  useFrame((_, delta) => {
    /* Clamped: a restored tab hands in a multi-second delta, and a step that large lands mid-wave. */
    const dt = Math.min(delta, 1 / 20);

    /* ── expression ── */
    /*
     * The morph targets are baked into the eye geometry as two attributes, and the
     * renderer's own morph machinery is bypassed on purpose (see `eyeGeometry.ts`): the
     * shader does `position + aHappy * uHappy + aSleepy * uSleepy`. Two weights, damped
     * separately — a sleepy face must not snap through a happy frame to get there.
     */
    morph.current.happy = damp(morph.current.happy, pose.happy, 14, dt);
    morph.current.sleepy = damp(morph.current.sleepy, pose.sleepy, 10, dt);
    morph.current.stretch = damp(morph.current.stretch, pose.stretch, 12, dt);

    eyeUniforms.uHappy.value = morph.current.happy;
    eyeUniforms.uSleepy.value = morph.current.sleepy;
    eyeUniforms.uStretch.value = morph.current.stretch;

    /* ── the wave ── */
    /*
     * `uTime` accumulates frame deltas instead of reading the clock, so a paused tab
     * stops the ripple rather than resuming mid-wave after a wall-clock jump. The speed
     * multiplier is applied in the shader; applying it here too would square it.
     */
    bodyUniforms.uTime.value += dt;

    /*
     * The gradient's anchor is the body's **world** position. The hero can move the
     * group, and the gradient has to travel with the character while the wave's phase
     * keeps reading absolute space — that difference is what makes the colours flow
     * across the body as it drifts instead of being pinned to it.
     */
    if (bodyRef.current) {
      bodyRef.current.getWorldPosition(world.current);
      bodyUniforms.uCenter.value.copy(world.current);
    }

    /* ── where the eyes look ── */
    const store = useAstroStore.getState();
    /*
     * `followPointer` is the pure rule: the expression's resting look plus the pointer's
     * contribution, radially clamped, and *not at all* for a reaction or a sleeping face —
     * the first mouse move must not undo a state the user just triggered.
     *
     * This is the whole reason v2 exists over the drawn version: attention was quantised
     * to the sheet's seven placements, because it was moving a picture. A vector of
     * continuous attentions can be damped, and damping is what makes it read as looking
     * instead of snapping.
     */
    const attention = followPointer(pose, store.look, followsPointer(expression)).look;

    look.current.x = damp(look.current.x, attention.x, 7, dt);
    look.current.y = damp(look.current.y, attention.y, 7, dt);

    const eyeX = look.current.x * LOOK_WORLD.x;
    const eyeY = look.current.y * LOOK_WORLD.y;

    const radius = ASTRO_V2_BODY_RADIUS;
    const { depth, width, height, separation, line, sink } = ASTRO_V2_EYE;

    /* Breathing: ±1.5%, slow, and in phase between the two eyes because it is one number. */
    const breathe = 1 + Math.sin(bodyUniforms.uTime.value * 0.9) * 0.015;

    if (bodyRef.current) {
      bodyRef.current.scale.setScalar(radius * breathe);
    }

    for (const [ref, side] of [
      [leftEyeRef, -1],
      [rightEyeRef, 1],
    ] as const) {
      const eye = ref.current;
      if (!eye) {
        continue;
      }

      const x = side * separation * 0.5 + eyeX;
      const y = line + eyeY;

      /*
       * Solve `x² + y² + z² = r²` for the surface point, with the horizontal offset
       * clamped so an extreme pointer position cannot push an eye past the silhouette
       * (where the root turns imaginary) and the normal can never lie in the tangent
       * plane (where the prism shows only its rim).
       */
      const horizontal = Math.min(Math.hypot(x, y), radius * 0.82);
      const z = Math.sqrt(Math.max(radius * radius - horizontal * horizontal, 0.01));

      /* Sunk: the prism's centre sits inside the surface, so its rim is buried. */
      eye.position.set(x, y, z - depth * sink);

      /*
       * Aim the prism's axis along the normal. Two `atan2`s rather than `lookAt`: the eye
       * is a child of the group, and `lookAt` takes *world* coordinates — it would
       * silently fold the group's rotation into the eye's.
       */
      eye.rotation.set(-Math.atan2(y, z), Math.atan2(x, z), 0);

      /*
       * The geometry is a unit prism: `x, y` on the unit circle and `z ∈ [-0.5, 0.5]`
       * after its own rotation, so the scale is the half-extents. The vertical scale is
       * also where the expression's `open` compression lands, which is why it is not
       * baked into the morph.
       */
      eye.scale.set(width / 2, (height / 2) * morph.current.stretch, depth);
    }

    /* ── the halo ── */
    haloUniforms.uSize.value = radius * tunables.haloSize;

    /*
     * The halo's colour drift rides the same clock as the body's, so the two cannot drift
     * apart. The body's shader computes its own; the halo is a separate program and needs
     * the number handed to it. Half the body's amplitude: the glow is a wider, softer
     * shape, and a full-ramp slide there swings its whole ring.
     */
    haloUniforms.uDrift.value =
      Math.sin((bodyUniforms.uTime.value / Math.max(tunables.colorPeriod, 0.001)) * Math.PI * 2) *
      tunables.colorAmount *
      0.5;
  });

  return (
    <group position={position}>
      {/*
        The halo renders *after* the body (`renderOrder` 1) and additively, so its
        transparent middle adds nothing over the sphere and only the rim glows. Its
        material ignores depth on purpose: the shell is larger than the body, and a depth
        test there would let a wall the camera can see through hide the body's silhouette.
      */}
      <mesh material={haloMaterial} renderOrder={1}>
        <sphereGeometry args={[1, 64, 48]} />
      </mesh>

      <mesh
        ref={bodyRef}
        material={bodyMaterial}
        scale={ASTRO_V2_BODY_RADIUS}
        onPointerDown={onPress}
      >
        <sphereGeometry args={[1, 72, 48]} />
      </mesh>

      {/*
        The eyes last: their material has `depthTest: false`, so they shine through the
        sphere from any angle — the sheet's eyes are light, not paint.
      */}
      <mesh
        ref={leftEyeRef}
        geometry={eyeGeometry}
        material={eyeMaterial}
        scale={[ASTRO_V2_EYE.width / 2, ASTRO_V2_EYE.height / 2, ASTRO_V2_EYE.depth]}
        renderOrder={2}
      />
      <mesh
        ref={rightEyeRef}
        geometry={eyeGeometry}
        material={eyeMaterial}
        scale={[ASTRO_V2_EYE.width / 2, ASTRO_V2_EYE.height / 2, ASTRO_V2_EYE.depth]}
        renderOrder={2}
      />
    </group>
  );
}
