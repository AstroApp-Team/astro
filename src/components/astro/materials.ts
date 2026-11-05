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

import { AdditiveBlending, BackSide, Color, ShaderMaterial, Vector3 } from "three";

import {
  ASTRO_V2_BODY_RADIUS,
  ASTRO_V2_HALO_RADIUS,
  ASTRO_V2_PALETTE,
  type AstroV2Tunables,
} from "../../lib/astro/astroV2.ts";

/**
 * The diagonal the body's gradient runs along — the sheet's `137deg`, in world units.
 *
 * Pointing up and slightly to the right, so `t = 0` is the top of the body and `t = 1`
 * its bottom-right, which is the order `ASTRO_V2_PALETTE` is written in. Normalised
 * per-instance rather than in the shader: `normalize` once beats a `normalize` per
 * fragment for a constant.
 */
const GRADIENT_DIR = new Vector3(0.35, 1, 0.15).normalize();

const color = (hex: string) => new Color(hex);

/* ── body ────────────────────────────────────────────────────────────────────── */

export const bodyUniforms = {
  /** Accumulated seconds. The scene owns this; it is not `clock.elapsedTime` so a pause can freeze the wave. */
  uTime: { value: 0 },
  /** Body radius, for turning a world-space offset into a `0..1` gradient coordinate. */
  uRadius: { value: ASTRO_V2_BODY_RADIUS },
  /** Where the gradient is centred — the group's position, so the wave travels with the character. */
  uCenter: { value: new Vector3(0, 0, 0) },
  uGradientDir: { value: GRADIENT_DIR.clone() },
  /** Where the middle stop sits on the ramp. The sheet's 54% is not the midpoint of a lerp. */
  uStopMid: { value: 0.54 },
  uColorTop: { value: color(ASTRO_V2_PALETTE.top) },
  uColorMid: { value: color(ASTRO_V2_PALETTE.mid) },
  uColorBottom: { value: color(ASTRO_V2_PALETTE.bottom) },
  /** Edge bloom, in the sheet's `#FF8B00`. */
  uRimColor: { value: color(ASTRO_V2_PALETTE.top) },
  uRimStrength: { value: 0.45 },
  /** Wave multipliers — the knobs `ASTRO_V2_TUNABLES` sets. */
  uWaveFreq: { value: 1 },
  uWaveAmp: { value: 1 },
  uWaveSpeed: { value: 1 },
  uColorPeriod: { value: 1 },
  uColorAmount: { value: 1 },
  uBrightness: { value: 1 },
  uGradientScale: { value: 1 },
};

const bodyVertexShader = /* glsl */ `
  varying vec3 vWorld;
  varying vec3 vViewNormal;
  varying vec3 vViewDir;

  void main() {
    vWorld = (modelMatrix * vec4(position, 1.0)).xyz;

    vec4 viewPosition = modelViewMatrix * vec4(position, 1.0);
    vViewDir = normalize(-viewPosition.xyz);
    vViewNormal = normalize(normalMatrix * normal);

    gl_Position = projectionMatrix * viewPosition;
  }
`;

const bodyFragmentShader = /* glsl */ `
  uniform float uTime;
  uniform float uRadius;
  uniform vec3 uCenter;
  uniform vec3 uGradientDir;
  uniform float uStopMid;
  uniform vec3 uColorTop;
  uniform vec3 uColorMid;
  uniform vec3 uColorBottom;
  uniform vec3 uRimColor;
  uniform float uRimStrength;
  uniform float uWaveFreq;
  uniform float uWaveAmp;
  uniform float uWaveSpeed;
  uniform float uColorPeriod;
  uniform float uColorAmount;
  uniform float uBrightness;
  uniform float uGradientScale;

  varying vec3 vWorld;
  varying vec3 vViewNormal;
  varying vec3 vViewDir;


  void main() {
    /*
     * The gradient coordinate comes from the fragment's **world position**, not from
     * its uv. A uv is a property of the sphere's parameterisation — it wraps at the
     * seam and squeezes at the poles — so a gradient built from it rotates with the
     * mesh and prints a seam down the back. Position has neither problem, and because
     * it is *world* position the bands also flow as the character drifts.
     */
    vec3 offset = vWorld - uCenter;
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
      + 0.55 * sin(vWorld.z * uWaveFreq * 0.83 + vWorld.y * uWaveFreq * 0.61 + phase * 0.45);

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

    vec3 col = t < uStopMid
      ? mix(uColorTop, uColorMid, smoothstep(0.0, uStopMid, t))
      : mix(uColorMid, uColorBottom, smoothstep(uStopMid, 1.0, t));

    /* Edge bloom: the rim picks up the top stop, which is the sheet's own rim colour. */
    float rim = pow(1.0 - clamp(dot(vViewNormal, vViewDir), 0.0, 1.0), 3.0);
    col += uRimColor * rim * uRimStrength;

    gl_FragColor = vec4(col * uBrightness, 1.0);

    #include <colorspace_fragment>
  }
`;

export const bodyMaterial = new ShaderMaterial({
  uniforms: bodyUniforms,
  vertexShader: bodyVertexShader,
  fragmentShader: bodyFragmentShader,
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
   * The well's inner wall: one flat colour, the sheet's midtone orange brightened.
   *
   * Solid on purpose. A gradient along the wall needs a normal, and a wall's normal is
   * perpendicular to the view ray everywhere — the only variation a facing term can
   * produce there is across the two pixels where the wall curves, which reads as noise
   * rather than as a cavity. A flat tint is what the stylesheet does with its feature
   * shadow: one colour, hard edge.
   */
  uInner: { value: color(ASTRO_V2_PALETTE.eyeWell) },
  uOpacity: { value: 1 },
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

const eyeFragmentShader = /* glsl */ `
  uniform vec3 uCore;
  uniform vec3 uInner;
  uniform float uOpacity;

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

    gl_FragColor = vec4(col, uOpacity);

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
   * layer of the character, which is also why they are drawn before the halo's
   * additive pass cannot wash them out (see `haloMaterial`'s order).
   */
  depthTest: false,
  depthWrite: false,
  transparent: true,
  side: BackSide,
  toneMapped: false,
});

/* ── halo ────────────────────────────────────────────────────────────────────── */

export const haloUniforms = {
  /** Shell radius. The vertex shader scales the unit sphere by this, so size is a uniform, not a scale. */
  uSize: { value: ASTRO_V2_HALO_RADIUS },
  /** `1 - |dot(normal, view)|` where the glow is at **full strength** — the body's silhouette. */
  uEdgeStart: { value: 0.16 },
  /** …and where it has decayed to nothing, just inside the shell's own rim. */
  uEdgeEnd: { value: 0.95 },
  /**
   * `bodyRadius / shellRadius`, so the shader can feather the seam at the body's own
   * silhouette instead of trusting `uEdgeStart` to stay in step with `haloSize`.
   */
  uBodyRatio: { value: 1 / 1.9 },
  uOpacity: { value: 0.86 },
  /** Half-width of the feather at the body's silhouette, in shallow units. */
  uInnerFade: { value: 0.1 },
  uColorInner: { value: color(ASTRO_V2_PALETTE.haloInner) },
  uColorOuter: { value: color(ASTRO_V2_PALETTE.haloOuter) },
  /** Shapes the decay: 1 is linear between the two edges, 2 falls off faster. */
  uPower: { value: 1.6 },
  /**
   * The body's colour drift, in ramp units, handed in by the scene each frame.
   *
   * The halo is a separate program with its own `uTime`, so it cannot derive this from
   * the body's clock without a second accumulation that drifts. Passing the number keeps
   * the two in lockstep by construction, and because it only slides between the sheet's
   * two glow colours it cannot name a third one.
   */
  uDrift: { value: 0 },
};

const haloVertexShader = /* glsl */ `
  uniform float uSize;

  varying vec3 vViewNormal;
  varying vec3 vViewDir;

  void main() {
    vec3 scaled = position * uSize;

    vec4 viewPosition = modelViewMatrix * vec4(scaled, 1.0);
    vViewDir = normalize(-viewPosition.xyz);
    vViewNormal = normalize(normalMatrix * normal);

    gl_Position = projectionMatrix * viewPosition;
  }
`;

const haloFragmentShader = /* glsl */ `
  uniform float uEdgeStart;
  uniform float uEdgeEnd;
  uniform float uOpacity;
  uniform float uInnerFade;
  uniform vec3 uColorInner;
  uniform vec3 uColorOuter;
  uniform float uPower;
  uniform float uBodyRatio;
  uniform float uDrift;

  varying vec3 vViewNormal;
  varying vec3 vViewDir;

  void main() {
    /*
     * The shell is in front of the body, so it cannot be hidden by depth — the alpha
     * has to do the hiding. shallow is 0 where the shell faces the camera (over the
     * body's middle) and 1 at its silhouette, so a ramp on it is exactly "the glow is
     * the band where the surface turns away", which is the stylesheet's halo.
     */
    float facing = clamp(abs(dot(normalize(vViewNormal), normalize(vViewDir))), 0.0, 1.0);
    float shallow = 1.0 - facing;

    /*
     * The decay runs **outward**: full strength where the glow meets the body, nothing
     * near the shell's rim. Inverted, this read as a bright ring floating a few pixels
     * off the disc with a dark gap between them — the sheet's halo is a bloom that hugs
     * the body and dissolves into the page, not an outline.
     */
    float ramp = 1.0 - smoothstep(uEdgeStart, uEdgeEnd, shallow);
    ramp = pow(clamp(ramp, 0.0, 1.0), uPower);

    /*
     * The seam against the body. uEdgeStart is a *number* — the user can slide it — but
     * the body's silhouette is at sqrt(1 - (bodyR/shellR)²) of shallow, which moves with
     * haloSize. Feathering around the geometry's own edge rather than around the slider
     * keeps the join clean at every size, and leaves the slider free to shape the decay.
     */
    /*
     * shallow at the body's silhouette — the *complement* of the facing angle there.
     * Getting this backwards (using the facing angle itself) puts the feather at 0.85
     * while the visible band starts at 0.15, so the multiply is zero across the whole
     * band and the halo disappears with no error to explain it.
     */
    float bodyShallow = 1.0 - sqrt(max(1.0 - uBodyRatio * uBodyRatio, 0.0));
    float feather = smoothstep(bodyShallow - uInnerFade, bodyShallow + uInnerFade, shallow);

    /* Both stops are printed sheet colours (#FB5F25 to #FF8B00), so the drift slides
       between them instead of rotating the hue off the palette. */
    vec3 col = mix(uColorInner, uColorOuter, clamp(shallow + uDrift, 0.0, 1.0));
    gl_FragColor = vec4(col, ramp * feather * uOpacity);

    #include <colorspace_fragment>
  }
`;

export const haloMaterial = new ShaderMaterial({
  uniforms: haloUniforms,
  vertexShader: haloVertexShader,
  fragmentShader: haloFragmentShader,
  transparent: true,
  depthTest: false,
  depthWrite: false,
  /**
   * Additive: a glow adds light to whatever is behind it, and the page under the
   * canvas is dark. Additive also means the shell's transparent middle contributes
   * nothing rather than blending a dark rim over the body.
   */
  blending: AdditiveBlending,
  toneMapped: false,
});

/**
 * Write the tunables onto the uniform objects.
 *
 * One function, not a write per slider: the page owns the numbers, and every consumer
 * (a slider, a future Theatre track, a test) goes through this so no uniform can be
 * missed when one is added. `uTime` and the eye weights are deliberately not here —
 * those are the scene's per-frame animation, not the look's constants.
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
  haloUniforms.uEdgeEnd.value = tunables.haloEdgeEnd;
  haloUniforms.uOpacity.value = tunables.haloOpacity;
  haloUniforms.uSize.value = ASTRO_V2_BODY_RADIUS * tunables.haloSize;
  haloUniforms.uBodyRatio.value = 1 / tunables.haloSize;
}
