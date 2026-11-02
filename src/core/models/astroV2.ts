/**
 * Astro v2 — the character as geometry, in world units.
 *
 * v1 is a plane wearing a 2D canvas texture: twelve drawings, swapped. That is the
 * right model for a *drawing* and the wrong one for a character — a pose is a
 * picture, so the eyes cannot travel continuously, a tilt is not available, and the
 * body cannot react to being off-centre. v2 keeps the same proportions and palette
 * (`astro.ts` is still the source of those numbers) and expresses them as a lit-by-
 * nothing sphere, two sunken eye prisms and a halo shell.
 *
 * Everything here is a number a shader or a mesh reads, so this file has no
 * renderer in it: `astroV2Pose.test.ts` can check the mapping from an expression to
 * an eye pose without a GL context.
 */

import { ASTRO_GEOMETRY } from "@core/models/astro.ts";

/**
 * Body diameter in world units.
 *
 * The same 1.1 `astroTexture.ts` pins the v1 body at, so both versions are the same
 * size under the same camera (`ASTRO_V2_CAMERA` is `ASTRO_CAMERA`) and a screenshot
 * of one can be diffed against the other.
 */
export const ASTRO_V2_DIAMETER = 1.1;

/** Body radius. A sphere, not an ellipse: the stylesheet's body is a circle. */
export const ASTRO_V2_BODY_RADIUS = ASTRO_V2_DIAMETER / 2;

/**
 * The eye prisms.
 *
 * Sized from the sheet's own ratios (`58 × 111 / 833`), given a depth, and mounted
 * on the sphere's surface rather than on a plane — `line` is the sheet's `-49 / 833`
 * turned into world units, and `separation` its `148 / 833`. The depth is the one
 * number the sheet cannot supply: it is what makes a sunken prism read as a hole
 * instead of a sticker.
 *
 * The sheet's ratios are the *proportions* to keep, not the size to copy: on a phone
 * the body is ~120 px across, and `58 × 111 / 833` puts each eye at ~9 × 17 px, where
 * the well's walls are two pixels and the prism reads as a sticker again. `sizeScale`
 * widens the pair without changing their aspect or their spacing ratio.
 */
export const ASTRO_V2_EYE = {
  sizeScale: 1.3,
  width: ASTRO_GEOMETRY.eyeWidth * ASTRO_V2_DIAMETER * 1.3,
  /**
   * The sheet's own 2 : 1 oval, at `sizeScale`. Unchanged on purpose: the height is what
   * makes the pair read as eyes rather than as dots, and shortening it was a misreading
   * of "the geometry is a little tall" — the number that was wrong is `depth`.
   */
  height: ASTRO_GEOMETRY.eyeHeight * ASTRO_V2_DIAMETER * 1.3,
  /**
   * How far the prism sinks into the body — the parallax that says "cavity".
   *
   * Halved from 0.078 on the rig's note: at the full depth the wall band grew wide
   * enough to catch the eye as a surface of its own, and the well read as a cylinder
   * lying on the body instead of a hole cut into it.
   */
  depth: 0.039,
  separation: ASTRO_GEOMETRY.eyeSeparation * ASTRO_V2_DIAMETER,
  /** `-49 / 833` of `D`. Positive y is up here, so the eye line is slightly above the centre. */
  line: (49 / 833) * ASTRO_V2_DIAMETER,
  /** The prism is sunk this far below the surface, so the shell's silhouette stays the sphere's. */
  sink: 0.42,
} as const;

/**
 * Halo shell radius: the sheet's clear space, `1.9 R`.
 *
 * The shell is a sphere in front of the body, so its *centre* faces the camera and
 * would cover the character — the shader's whole job is to make that centre
 * transparent and the grazing band opaque. Its radius is the size of that band, which
 * is why the stylesheet's `clearSpace` is the authority here: a shell tighter than
 * `1.8 R` crops the glow into a visible ring.
 */
export const ASTRO_V2_HALO_RADIUS = ASTRO_V2_BODY_RADIUS * 1.9;

/**
 * How far the eye pair travels when the character looks around, in world units.
 *
 * `+x` right, `+y` up, `|look| <= 1` after clamping. Small numbers on purpose: the
 * eyes stay on the front tenth of the sphere, because a pair that slides to the rim
 * reads as a bug rather than as attention.
 *
 * Sized against the scene's own limit, not by eye: `AstroV2Character` caps
 * `hypot(x, y)` at `0.82 R` so the prism never reaches the silhouette (where the
 * surface root turns imaginary and the eye shows only its rim). At
 * `separation / 2 = 0.098`, `line = 0.065` and `R = 0.55`, the cap is `0.451`, so
 * `x` tops out at `0.098 + 0.34 = 0.438` and `y` at `0.065 + 0.26 = 0.325` — the
 * widest gaze that still lands inside the cap. These were `0.24 / 0.17`, which the rig
 * read as "the eyes stay too close to the centre"; the pair now crosses most of the
 * face at the screen's edge and is still never clamped on a straight horizontal pull
 * (a diagonal pull can clamp, which is what the radial clamp is for).
 */
export const ASTRO_V2_LOOK_RANGE = { x: 0.34, y: 0.26 } as const;

/**
 * The shader's tunables, as defaults.
 *
 * Every one of these is a uniform, not a baked constant: the whole point of v2 is
 * that the wave and the halo can be fitted to the stylesheet by turning knobs
 * (`useAstroV2Store` is the page's set of them) rather than by editing GLSL. The
 * defaults are what the sheet looks like.
 */
export const ASTRO_V2_TUNABLES = {
  /** Spatial frequency of the colour wave, per world unit. Higher = finer ribbons. */
  waveFreq: 3.4,
  /** How far the wave moves the gradient coordinate, in gradient-widths. 0 = a clean gradient. */
  waveAmp: 0.2,
  /** Wave phase per second. The character is calm: a full ripple takes several seconds. */
  waveSpeed: 0.45,
  /** Seconds for one full palette breath. Slow enough to be felt, not watched. */
  colorPeriod: 26,
  /**
   * How far the gradient coordinate may travel, in ramp-widths. 0 = the sheet's gradient
   * exactly as drawn.
   *
   * This is a *position* on the sheet's own ramp, not a hue rotation: 0.32 of a hue turn
   * was yellow on `#FF8B00` and pink on `#FE3402`, i.e. two colours the stylesheet does
   * not contain. Sliding along the ramp cannot leave the three printed stops, which is
   * the whole reason the number is small and bounded (the slider stops at 0.5).
   */
  colorAmount: 0.16,
  /** Brightness multiplier on the body. Over 1 clips the cream off the top of the ramp. */
  brightness: 1,
  /** Gradient width relative to the body: 1 spans the body diagonally, 0.8 is a tighter ramp. */
  gradientScale: 1,
  /** Halo shell radius, in body radii. */
  haloSize: 1.9,
  /**
   * The angle where the halo is at **full strength**, as `1 - |dot(normal, view)|`.
   *
   * `0.16` is the body's own silhouette at the default `haloSize` of 1.9:
   * `sqrt(1 - (1/1.9)²) ≈ 0.85` facing, `1 - 0.85 ≈ 0.15` shallow. The glow is therefore
   * thickest exactly where it meets the body and decays *outward*, which is the sheet's
   * halo — a bloom that hugs the disc. (It was inverted: full strength out at the shell's
   * rim left a bright ring with a dark gap against the body.) The shader feather the
   * seam at the body's silhouette itself, so this number only has to be near it.
   */
  haloEdgeStart: 0.16,
  /** Where the glow has decayed to nothing: near the shell's own rim (`1`). */
  haloEdgeEnd: 0.95,
  /** Overall halo opacity. */
  haloOpacity: 1,
} as const;

/**
 * The tunables with widened numbers.
 *
 * `typeof ASTRO_V2_TUNABLES` would be a record of literals (`waveFreq: 3.4`), so a
 * slider's `number` could not be assigned to it and every setter would need a cast. The
 * defaults stay `as const` (the sheet's numbers are a fact), but the *type* the store
 * and the uniforms exchange is deliberately `number` per field.
 */
export type AstroV2Tunables = { [K in keyof typeof ASTRO_V2_TUNABLES]: number };

/** The `theatreKey` of v2's editable group. v1's is `"Astro"`; the two never collide. */
export const ASTRO_V2_NODE_KEY = "Astro V2";

/** Body gradient stops, in the sheet's order: top of the body to bottom-right. */
export const ASTRO_V2_PALETTE = {
  top: "#FF8B00",
  mid: "#FA6B2F",
  bottom: "#FE3402",
  /** The eyes: cream, never white. */
  core: "#FEFBF5",
  /**
   * The inner wall of the eye wells: the sheet's midtone orange, lifted toward the cream
   * so the well reads as a lit cavity rather than as a hole cut in the body.
   *
   * Derived, not printed: the midpoint between the sheet's `#FA6B2F` and the eye's own
   * `#FEFBF5` — light enough that the well reads as a lit cavity and not as a second
   * orange ring, still orange enough to hold the eye's edge against the body. It is one
   * flat colour on purpose: the wall is two or three pixels at phone size, and a gradient
   * across it is noise, not shading. See `eyeUniforms.uInner`.
   */
  eyeWell: "#FDC3A8",
  /** Halo shell: the sheet's glow, and the bloom it fades into. */
  haloInner: "#FB5F25",
  haloOuter: "#FF8B00",
} as const;
