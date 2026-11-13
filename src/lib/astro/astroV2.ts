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

import { ASTRO_GEOMETRY } from "./astro.ts";

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
 * widens the pair without changing their aspect. It was 1.3; at that size the pair
 * crowded the face next to astroapp.com.br's Astro, so it is 1.15, with `spread` moving
 * them 10% further apart to keep the face open.
 */
const EYE_SIZE_SCALE = 1.15;
const EYE_SPREAD = 1.1;

export const ASTRO_V2_EYE = {
  sizeScale: EYE_SIZE_SCALE,
  width: ASTRO_GEOMETRY.eyeWidth * ASTRO_V2_DIAMETER * EYE_SIZE_SCALE,
  /**
   * The sheet's own 2 : 1 oval, at `sizeScale`. Unchanged on purpose: the height is what
   * makes the pair read as eyes rather than as dots, and shortening it was a misreading
   * of "the geometry is a little tall" — the number that was wrong is `depth`.
   */
  height: ASTRO_GEOMETRY.eyeHeight * ASTRO_V2_DIAMETER * EYE_SIZE_SCALE,
  /**
   * How far the prism sinks into the body — the parallax that says "cavity".
   *
   * Halved from 0.078 on the rig's note: at the full depth the wall band grew wide
   * enough to catch the eye as a surface of its own, and the well read as a cylinder
   * lying on the body instead of a hole cut into it.
   */
  depth: 0.039,
  separation: ASTRO_GEOMETRY.eyeSeparation * ASTRO_V2_DIAMETER * EYE_SPREAD,
  /** `-49 / 833` of `D`. Positive y is up here, so the eye line is slightly above the centre. */
  line: (49 / 833) * ASTRO_V2_DIAMETER,
  /** The prism is sunk this far below the surface, so the shell's silhouette stays the sphere's. */
  sink: 0.42,
} as const;

/**
 * How far the halo reaches: the sheet's clear space, `1.9 R`.
 *
 * The layout's number — the corner keeps this much of him on screen. The glow itself
 * ends at `haloSize` and swells past it by its pulse and while he speaks, so the disc
 * it is drawn on is larger (see `AstroCharacter`).
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
 * `separation / 2 = 0.108`, `line = 0.065` and `R = 0.55`, the cap is `0.451`, so
 * `x` tops out at `0.108 + 0.34 = 0.448` and `y` at `0.065 + 0.26 = 0.325` — the
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
  /**
   * Spatial frequency of the colour wave, per world unit. Higher = finer ribbons. Low on
   * purpose: at 3.4 the bands broke into an archipelago of colour islands.
   */
  waveFreq: 2.2,
  /**
   * How far the wave moves the gradient coordinate, in gradient-widths. 0 = a clean
   * gradient. Small enough that the clamp at the ramp's ends is never hit, which is what
   * turned soft bands into hard-edged islands.
   */
  waveAmp: 0.09,
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
  /**
   * Where on the sheet's ramp the body's paint starts, `0..1`. The body spans
   * `rampStart..1`, so it sits on the orange rather than the amber, and — because the
   * halo's inner colour *is* the ramp's top stop — his edge can never melt into the glow,
   * whatever the wave and the drift do. Applied last, so nothing can push past it.
   */
  rampStart: 0.22,
  /**
   * Where the halo has faded to nothing, in body radii from his centre, on screen.
   *
   * Every halo distance is measured in the screen plane (`x, y`), never through the
   * sphere: the glow is a disc behind him, as on astroapp.com.br, not a shell around him.
   */
  haloSize: 1.6,
  /**
   * Where the halo is at **full strength**, in body radii. `1` is his silhouette: the glow
   * is thickest where it meets the body and decays outward — a bloom that hugs the disc.
   */
  haloEdgeStart: 1,
  /** Overall halo opacity. */
  haloOpacity: 1,
  /** How hard the fade falls off past `haloEdgeStart`: 1 eases out, higher is tighter. */
  haloPower: 1,
  /** The halo's breath: its reach swells and shrinks by this fraction. astroapp.com.br's is ~6%. */
  haloPulseAmount: 0.05,
  /** Seconds for one halo breath. astroapp.com.br's glow loops every 4 s. */
  haloPulsePeriod: 4,
  /** How much further the halo reaches at full voice, as a fraction of its size. */
  haloSpeechReach: 0.18,
  /** How much brighter the halo gets at full voice. */
  haloSpeechGlow: 0.3,
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
   * The inner wall of the eye wells — the side of the eye.
   *
   * **A tint, not a solid.** `eyeUniforms.uWallOpacity` draws the wall at 43%, so this hex
   * is composited against the body's gradient and the body's colour drifts through it.
   * Composited over `bottom` (`#FE3402`) it lands near `#D34620`: a muted, browner orange
   * than any body stop without being a hole punched in the character.
   *
   * The lighter `#FDC3A8` this started from read as a lit rim laid *on* the body, and the
   * near-black `#1A0400` that replaced it read as a hole; 43% of a midtone brown sits
   * between the two, which is what the wall is — a surface that is neither lit nor empty.
   *
   * One flat colour on purpose: the wall is two or three pixels at phone size, and a
   * gradient across it is noise. See `eyeUniforms.uInner` and `uWallOpacity`.
   */
  eyeWall: "#995F48",
  /**
   * Halo: bright `#FF8B00` against the body, redder `#FB5F25` as it spreads — the order
   * astroapp.com.br's two glow layers stack in. (They were the other way round.)
   */
  haloInner: "#FF8B00",
  haloOuter: "#FB5F25",
} as const;
