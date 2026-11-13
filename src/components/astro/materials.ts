/**
 * Astro v2's three materials, and the uniforms that fit them to the stylesheet.
 *
 * There is no light in this scene, and that is the design, not an omission: the
 * stylesheet paints Astro as something *emitting* its colour — a diagonal gradient
 * with a soft bloom, never a lit surface with a specular side. A `meshStandardMaterial`
 * would need a light rig to look like anything and would then add a second,
 * contradicting lighting model on top of the gradient. So all three materials are
 * `ShaderMaterial`s that compute their own colour and ignore lights entirely.
 *
 * One material instance each, at module scope. They are GPU programs plus a uniform
 * block, not per-render objects; building them in a component body would compile a
 * shader per render and, worse, make the uniform writes in `useFrame` land on an
 * object the renderer is not using.
 *
 * ## The uniforms are the tuning surface
 *
 * Nothing about the wave, the palette rotation or the halo's shape is baked into the
 * GLSL: `ASTRO_V2_TUNABLES` holds the defaults and `applyTunables` writes them onto
 * the uniform objects, so `/astro-v2` can slide them live and a future rig can
 * animate them. The values are in `core/models/astroV2.ts`, next to the numbers they
 * are fitted to.
 */

import { AdditiveBlending, BackSide, Color, ShaderMaterial, Vector2 } from "three";

import {
  ASTRO_V2_BODY_RADIUS,
  ASTRO_V2_PALETTE,
  type AstroV2Tunables,
} from "../../lib/astro/astroV2.ts";

/**
 * The diagonal the body's gradient runs along, in the screen plane.
 *
 * astroapp.com.br's Astro (a Rive file, `astro.riv`) draws the body as a linear
 * gradient on a disc rotated -45°: `#FF8B00` at the top-left, `#FA6B2F` at 54%,
 * `#FE3402` at the bottom-right. With +y up that is `(-1, 1)` — `t = 0` up-left.
 *
 * Two components on purpose. **No body or halo colour reads depth**: the camera is
 * orthographic, so `x, y` are screen position, and a colour that also reads `z` (or a
 * normal, or the view angle) paints the sphere's curvature onto him — the lit-ball look
 * that set him apart from the drawing. The geometry stays 3D; only the paint is flat.
 * `materials.test.ts` keeps it that way.
 */
const GRADIENT_DIR = new Vector2(-1, 1).normalize();

const color = (hex: string) => new Color(hex);

/* ── body ────────────────────────────────────────────────────────────────────── */

export const bodyUniforms = {
  /** Accumulated seconds. The scene owns this; it is not `clock.elapsedTime` so a pause can freeze the wave. */
  uTime: { value: 0 },
  /** Body radius, for turning a world-space offset into a `0..1` gradient coordinate. */
  uRadius: { value: ASTRO_V2_BODY_RADIUS },
  /** Where the gradient is centred — the group's position, so the wave travels with the character. */
  uCenter: { value: new Vector2(0, 0) },
  uGradientDir: { value: GRADIENT_DIR.clone() },
  /** Where the middle stop sits on the ramp. The sheet's 54% is not the midpoint of a lerp. */
  uStopMid: { value: 0.54 },
  uColorTop: { value: color(ASTRO_V2_PALETTE.top) },
  uColorMid: { value: color(ASTRO_V2_PALETTE.mid) },
  uColorBottom: { value: color(ASTRO_V2_PALETTE.bottom) },
  /** Wave multipliers — the knobs `ASTRO_V2_TUNABLES` sets. */
  uWaveFreq: { value: 1 },
  uWaveAmp: { value: 1 },
  uWaveSpeed: { value: 1 },
  uColorPeriod: { value: 1 },
  uColorAmount: { value: 1 },
  uBrightness: { value: 1 },
  uGradientScale: { value: 1 },
};

/* Exported for `materials.test.ts`, which guards that the paint reads only `x, y`. */
export const bodyVertexShader = /* glsl */ `
  varying vec2 vWorld;

  void main() {
    vWorld = (modelMatrix * vec4(position, 1.0)).xy;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

export const bodyFragmentShader = /* glsl */ `
  uniform float uTime;
  uniform float uRadius;
  uniform vec2 uCenter;
  uniform vec2 uGradientDir;
  uniform float uStopMid;
  uniform vec3 uColorTop;
  uniform vec3 uColorMid;
  uniform vec3 uColorBottom;
  uniform float uWaveFreq;
  uniform float uWaveAmp;
  uniform float uWaveSpeed;
  uniform float uColorPeriod;
  uniform float uColorAmount;
  uniform float uBrightness;
  uniform float uGradientScale;

  varying vec2 vWorld;

  void main() {
    /*
     * The gradient coordinate comes from the fragment's **world position** in the screen
     * plane, not from its uv or its depth. A uv wraps at the seam and squeezes at the
     * poles; depth bends the bands around the sphere's curvature. Screen-plane position
     * has neither, and because it is *world* position the bands flow as he drifts.
     */
    vec2 offset = vWorld - uCenter;
    float t = 0.5 - dot(offset, uGradientDir) * uGradientScale / (2.0 * uRadius);

    /*
     * The wave: three sine terms at incommensurate frequencies, so the pattern does
     * not repeat visibly across the body. It moves the gradient coordinate, not the
     * vertex — the silhouette stays a clean circle and only the colour ripples, which
     * is what keeps this from reading as a wobbling blob.
     */
    float phase = uTime * uWaveSpeed;
    float wave =
        sin(vWorld.x * uWaveFreq + phase)
      * cos(vWorld.y * uWaveFreq * 1.27 - phase * 0.8)
      + 0.55 * sin(vWorld.x * uWaveFreq * 0.83 + vWorld.y * uWaveFreq * 0.61 + phase * 0.45);

    t = clamp(t + wave * uWaveAmp, 0.0, 1.0);

    /*
     * The slow colour travel: a *position* along the sheet's ramp, not a hue rotation.
     *
     * Rotating hue is what made the body go yellow and then pink — neither is a colour
     * the stylesheet prints, and no amount of clamping the *output* helps, because the
     * rotation has already left the ramp. Sliding "t" instead is bounded by construction:
     * "t" is clamped to 0..1 below, the two stops at the ends are #FF8B00 and
     * #FE3402, and every value between them is the sheet's own gradient. colorAmount
     * is how far the slide may go (the slider caps at half a ramp, so the mid stop is
     * always reachable and no end is pinned flat for long).
     */
    float drift = 0.5 + 0.5 * sin(uTime / max(uColorPeriod, 0.001) * 6.2831853);
    t = clamp(t + (drift - 0.5) * 2.0 * uColorAmount, 0.0, 1.0);

    /*
     * Linear between stops, as the drawing's gradient is. A smoothstep here flattens the
     * colour around each stop into a plateau and steepens the band between them.
     * No edge term either: the drawing's silhouette is crisp, and a facing-angle rim is
     * what read as a lit 3D ball.
     */
    vec3 col = t < uStopMid
      ? mix(uColorTop, uColorMid, t / uStopMid)
      : mix(uColorMid, uColorBottom, (t - uStopMid) / (1.0 - uStopMid));

    /*
     * The silhouette's own antialiasing. The canvas runs without MSAA, and with no rim or
     * glow over the edge any more, the sphere's outline stair-steps. Coverage falls from
     * 1 to 0 over the last pixel inside the circle, so the edge blends onto the halo
     * behind it. uRadius breathes with the mesh, so this tracks the real outline.
     */
    float edge = length(offset) / uRadius;
    float coverage = 1.0 - smoothstep(1.0 - fwidth(edge), 1.0, edge);

    gl_FragColor = vec4(col * uBrightness, coverage);

    #include <colorspace_fragment>
  }
`;

export const bodyMaterial = new ShaderMaterial({
  uniforms: bodyUniforms,
  vertexShader: bodyVertexShader,
  fragmentShader: bodyFragmentShader,
  /* For the edge's coverage alpha. It still draws after the halo, which is in the opaque pass. */
  transparent: true,
  toneMapped: false,
});

/* ── eyes ────────────────────────────────────────────────────────────────────── */

export const eyeUniforms = {
  /** Morph weights, damped toward the expression's pose by the scene. */
  uHappy: { value: 0 },
  uSleepy: { value: 0 },
  /** Vertical stretch of the prism, for `alert`/`wonder`. */
  uStretch: { value: 1 },
  uCore: { value: color(ASTRO_V2_PALETTE.core) },
  /**
   * The well's inner wall — the side of the eye, the band the prism's barrel shows around
   * the cream plate. A *tint*, not a shadow colour: it is drawn at `uWallOpacity` (43%), so
   * what reaches the screen is this hue over the body's gradient (see
   * `ASTRO_V2_PALETTE.eyeWall`).
   *
   * Flat on purpose. A gradient along the wall needs a normal, and a wall's normal is
   * perpendicular to the view ray everywhere — the only variation a facing term can
   * produce there is across the two pixels where the wall curves, which reads as noise
   * rather than as a cavity. A flat tint is what the stylesheet does with its feature
   * shadow: one colour, hard edge.
   */
  uInner: { value: color(ASTRO_V2_PALETTE.eyeWall) },
  /** The plate's alpha. 1: the cream is the one surface that must stay opaque. */
  uOpacity: { value: 1 },
  /**
   * The wall's alpha — the side of the eye only, hand-tunable.
   *
   * The material is `transparent` with normal blending, so this alpha composites the wall
   * against the body already drawn underneath it: 0.43 shows 43% of `eyeWall` and 57% of
   * the body's gradient. That is a *translucent* wall rather than a dimmed one — the body's
   * colour comes through and moves with the wave, which is the effect worth having at the
   * two-to-three-pixel band the barrel occupies.
   *
   * The plate keeps `uOpacity` (1.0) regardless: it is the eye, and a translucent hole would
   * stop reading as a hole. Applied per-fragment by `isPlate`, so one draw call covers both.
   */
  uWallOpacity: { value: 0.43 },
};

const eyeVertexShader = /* glsl */ `
  attribute vec3 aHappy;
  attribute vec3 aSleepy;

  uniform float uHappy;
  uniform float uSleepy;
  uniform float uStretch;

  /**
   * The fragment's *object-space* normal z, interpolated.
   *
   * The prism is built as a CylinderGeometry rotated onto z (eyeGeometry.ts bakes the
   * rotation with rotateX), so the two surfaces have exact normals: the flat cap is
   * ±z (abs(normal.z) = 1) and the barrel is radial (normal.z = 0). Passing that one
   * component is what lets the fragment shader make a **binary** choice — plate or wall —
   * instead of a ramp across a view angle.
   */
  varying float vNormalZ;

  void main() {
    /*
     * The morph, explicitly: rest position plus each target's offset times its weight.
     * Weights are clamped in the scene, so a blend past 1 cannot invert the prism.
     */
    vec3 morphed = position + aHappy * uHappy + aSleepy * uSleepy;
    morphed.y *= uStretch;

    vec4 viewPosition = modelViewMatrix * vec4(morphed, 1.0);

    /*
     * The normal is the *rest* one, and only its z is needed. A morph that bends the
     * outline changes the true normal by a few degrees, which cannot move a boundary this
     * shader draws between two sets of faces that are flat in object space.
     */
    vNormalZ = normal.z;

    gl_Position = projectionMatrix * viewPosition;
  }
`;

export const eyeFragmentShader = /* glsl */ `
  uniform vec3 uCore;
  uniform vec3 uInner;
  uniform float uOpacity;
  uniform float uWallOpacity;

  varying float vNormalZ;

  void main() {
    /*
     * Only back faces are drawn (the material is BackSide), so what the camera sees is the
     * *inside* of the well: the far cap through the hole, plus the barrel around it.
     *
     * The split is **geometric, not angular**. Every face of the prism is flat in object
     * space, so its normal z is exactly 1 (the cap) or exactly 0 (the barrel): a step on
     * abs(normal.z) therefore lands exactly on the cap's own edge, with nothing
     * interpolating between the two colours. This replaced a dot(normal, viewDir) ramp,
     * which is a *view* quantity: across the barrel it varies with the angle, so the wall
     * shaded light-to-dark like the side of a cylinder — the effect the rig saw and the
     * exact thing that broke the "hole in the body" reading. Flat white plate, flat light
     * orange barrel, hard edge, and neither one is touched by the body's gradient or wave.
     */
    float isPlate = step(0.5, abs(vNormalZ));
    vec3 col = mix(uInner, uCore, isPlate);

    /*
     * Alpha splits on the same step as the colour, so "only the side" is exact: the wall is
     * the barrel's fragments, the plate is the cap's, and nothing interpolates between them.
     */
    float alpha = mix(uWallOpacity, uOpacity, isPlate);

    gl_FragColor = vec4(col, alpha);

    #include <colorspace_fragment>
  }
`;

export const eyeMaterial = new ShaderMaterial({
  uniforms: eyeUniforms,
  vertexShader: eyeVertexShader,
  fragmentShader: eyeFragmentShader,
  /**
   * The character's eyes shine *through* the body: a sunken well that is occluded by
   * the surface it is sunk into would be invisible from the front. `depthTest` off,
   * `depthWrite` off, and a render order after the body — so they are always the top
   * layer of the character. The halo is drawn before the body, so it cannot wash them out.
   */
  depthTest: false,
  depthWrite: false,
  transparent: true,
  side: BackSide,
  toneMapped: false,
});

/* ── halo ────────────────────────────────────────────────────────────────────── */

export const haloUniforms = {
  /** Half-size of the quad the glow is drawn on, in the group's units. Big enough for its widest breath. */
  uSize: { value: ASTRO_V2_BODY_RADIUS * 2.2 },
  /** The body's radius *this frame* (it breathes), so the glow keeps hugging it. */
  uBodyRadius: { value: ASTRO_V2_BODY_RADIUS },
  /** Full strength out to here, in body radii. */
  uEdgeStart: { value: 1 },
  /** Faded to nothing here, in body radii. */
  uEdgeEnd: { value: 1.9 },
  uOpacity: { value: 1 },
  /** Shapes the fade: 1 eases out, higher falls off faster. */
  uPower: { value: 1 },
  uColorInner: { value: color(ASTRO_V2_PALETTE.haloInner) },
  uColorOuter: { value: color(ASTRO_V2_PALETTE.haloOuter) },
  /**
   * The body's colour drift, in ramp units, handed in by the scene each frame, so the two
   * stay in lockstep. It only slides between the halo's two printed colours.
   */
  uDrift: { value: 0 },
  /** The body's clock, handed in per frame — the breath rides the same pause-aware time. */
  uTime: { value: 0 },
  uPulseAmount: { value: 0.05 },
  uPulsePeriod: { value: 4 },
  /**
   * How loud Astro is speaking, `0..1`, already smoothed by the scene.
   *
   * The scene feeds it from `astroVoiceLevel` (see `lib/astro/voice-level.ts`); anything
   * else that wants the halo to swell — a listening cue, a build finishing — can write it.
   */
  uSpeech: { value: 0 },
  uSpeechReach: { value: 0.18 },
  uSpeechGlow: { value: 0.3 },
};

export const haloVertexShader = /* glsl */ `
  uniform float uSize;

  varying vec2 vLocal;

  void main() {
    /* A flat quad facing the camera, in the group's own units (so his scale applies). */
    vLocal = position.xy * uSize;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(vLocal, 0.0, 1.0);
  }
`;

export const haloFragmentShader = /* glsl */ `
  uniform float uBodyRadius;
  uniform float uEdgeStart;
  uniform float uEdgeEnd;
  uniform float uOpacity;
  uniform float uPower;
  uniform vec3 uColorInner;
  uniform vec3 uColorOuter;
  uniform float uDrift;
  uniform float uTime;
  uniform float uPulseAmount;
  uniform float uPulsePeriod;
  uniform float uSpeech;
  uniform float uSpeechReach;
  uniform float uSpeechGlow;

  varying vec2 vLocal;

  void main() {
    /*
     * Distance from his centre **on screen**, in body radii. It was a facing angle on a
     * sphere shell, which put the falloff on the sphere's curvature instead of on
     * the page — a glow that thinned near the body and bunched up at the rim.
     */
    float d = length(vLocal) / uBodyRadius;

    /*
     * The fade band breathes and swells with his voice; the start stays on his silhouette,
     * so the glow never pulls away from the body and leaves a gap.
     */
    float breath = 1.0 + uPulseAmount * sin(uTime * 6.2831853 / max(uPulsePeriod, 0.001));
    float reach = breath * (1.0 + uSpeechReach * uSpeech);
    float end = uEdgeStart + max(uEdgeEnd - uEdgeStart, 0.001) * reach;

    float fade = smoothstep(uEdgeStart, end, d);

    /*
     * Fades to transparent *in its own colour*. astroapp.com.br's Rive glow fades toward
     * transparent black and darkens into a muddy ring before it disappears; that is a
     * side effect of the Rive export, not the design.
     */
    float alpha = pow(1.0 - fade, uPower);

    /*
     * Speaking brightens the fade by lifting it toward 1 with an exponent, never by
     * multiplying: a multiply clips at 1 and leaves a flat plateau with a hard ring
     * where it ends.
     */
    alpha = pow(alpha, 1.0 / (1.0 + uSpeechGlow * uSpeech)) * uOpacity;

    vec3 col = mix(uColorInner, uColorOuter, clamp(fade + uDrift, 0.0, 1.0));
    gl_FragColor = vec4(col, min(alpha, 1.0));

    #include <colorspace_fragment>
  }
`;

export const haloMaterial = new ShaderMaterial({
  uniforms: haloUniforms,
  vertexShader: haloVertexShader,
  fragmentShader: haloFragmentShader,
  /**
   * The glow sits **behind** the body, as in the drawing: drawn first, then covered by
   * the opaque body. That needs the *opaque* pass — three always draws transparent
   * materials after opaque ones, whatever their `renderOrder` — so `transparent` is off
   * and `renderOrder` -1 (in `AstroCharacter`) puts it ahead of the body. Blending still
   * applies: three only drops it for `NormalBlending` on an opaque material.
   *
   * Additive: a glow adds light to whatever is behind it, and the page under the canvas
   * is dark. Depth is ignored so nothing can clip the disc.
   */
  transparent: false,
  depthTest: false,
  depthWrite: false,
  blending: AdditiveBlending,
  toneMapped: false,
});

/**
 * Write the tunables onto the uniform objects.
 *
 * One function, not a write per slider: the page owns the numbers, and every consumer
 * (a slider, a future Theatre track, a test) goes through this so no uniform can be
 * missed when one is added. `uTime`, `uSpeech` and the eye weights are deliberately not
 * here — those are the scene's per-frame animation, not the look's constants.
 */
export function applyTunables(tunables: AstroV2Tunables): void {
  bodyUniforms.uWaveFreq.value = tunables.waveFreq;
  bodyUniforms.uWaveAmp.value = tunables.waveAmp;
  bodyUniforms.uWaveSpeed.value = tunables.waveSpeed;
  bodyUniforms.uColorPeriod.value = tunables.colorPeriod;
  bodyUniforms.uColorAmount.value = tunables.colorAmount;
  bodyUniforms.uBrightness.value = tunables.brightness;
  bodyUniforms.uGradientScale.value = tunables.gradientScale;

  haloUniforms.uEdgeStart.value = tunables.haloEdgeStart;
  haloUniforms.uEdgeEnd.value = tunables.haloSize;
  haloUniforms.uOpacity.value = tunables.haloOpacity;
  haloUniforms.uPower.value = tunables.haloPower;
  haloUniforms.uPulseAmount.value = tunables.haloPulseAmount;
  haloUniforms.uPulsePeriod.value = tunables.haloPulsePeriod;
  haloUniforms.uSpeechReach.value = tunables.haloSpeechReach;
  haloUniforms.uSpeechGlow.value = tunables.haloSpeechGlow;
  haloUniforms.uSize.value = ASTRO_V2_BODY_RADIUS * haloReach(tunables);
}

/**
 * The furthest the glow can reach, in body radii: its widest breath at full voice, plus
 * the body's own ±1.5% breath. The quad is this big so the fade is never cropped.
 */
export function haloReach(tunables: AstroV2Tunables): number {
  const band = Math.max(tunables.haloSize - tunables.haloEdgeStart, 0);
  const widest = (1 + tunables.haloPulseAmount) * (1 + tunables.haloSpeechReach);
  return (tunables.haloEdgeStart + band * widest) * 1.02;
}
