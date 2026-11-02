import * as THREE from "three";

import {
  ASTRO_COLOURS,
  ASTRO_EXPRESSIONS,
  ASTRO_GEOMETRY,
  type AstroExpression,
  type AstroExpressionSpec,
} from "@core/models/astro.ts";

/**
 * Astro, painted into a texture.
 *
 * The character is a flat vector drawing, not a 3D model — the stylesheet has 17
 * frames of the same circle with different eyes. So the canvas does not shade a
 * sphere: it *draws* one, on a plane, and the plane is what the scene raycasts.
 * That is why there is no `meshStandardMaterial` here and no light rig to speak
 * of: the lighting model is a bloom and a halo, both baked into this canvas
 * (`extra_docs/style/03-astro-form.md`).
 *
 * **Everything is synchronous.** The alternative — build an SVG string, load it
 * through `Image`, `drawImage` it — costs an image decode per expression state
 * and leaves the character invisible for a frame after every change. Canvas 2D
 * has arcs, ellipses and gradients; the sheet is 12 states of the same four
 * elements; drawing it directly is both shorter and instant.
 *
 * Sizes come from `@core/models/astro.ts`, which carries them as fractions of the
 * body diameter `D`. This file only decides one thing the model cannot: how many
 * pixels `D` is, and therefore how much of the plane the halo uses.
 */

/** Texture resolution. The body is ~281 px of this, the halo ~507 px across. */
const TEXTURE_SIZE = 512;

/**
 * The plane the texture is mapped onto, in world units.
 *
 * `2` is one halo: the glow is gone by `1.8 R = 0.9 D`, so a plane of `2 D`
 * exactly bounds it. Smaller and the halo is cut into a visible edge; larger and
 * the square's empty corners become part of the raycast target.
 */
export const ASTRO_PLANE_SIZE = 2;

/**
 * The body diameter in world units.
 *
 * `1.1` at the float camera (`fov 45`, `z 7.5`, ~6.2 units tall at z=0) is
 * ~120 px of body on a 390×688 phone — the reference size `03-astro-form.md`
 * names, and large enough to be an unambiguous tap target without covering the
 * paragraph it stands in front of.
 */
export const ASTRO_BODY_DIAMETER = 1.1;

/** World units per texture pixel. Every conversion below goes through this. */
const WORLD_PER_PX = ASTRO_PLANE_SIZE / TEXTURE_SIZE;

/** The body's diameter in texture pixels: 281.6. */
const BODY_PX = ASTRO_BODY_DIAMETER / WORLD_PER_PX;

/** Centre of the square, in texture pixels. */
const MID = TEXTURE_SIZE / 2;

/**
 * SVG user units → texture pixels.
 *
 * The stylesheet draws in a `833`-unit body; this canvas draws the same body in
 * `281.6` pixels. One number converts every measurement in the model file, glyph
 * coordinates included — which is why the glyph tables are transcribed in sheet
 * units rather than pre-scaled.
 */
const S = BODY_PX / 833;

/**
 * The halo's falloff, sampled from the stylesheet and documented as a CSS
 * `radial-gradient` in `03-astro-form.md` (recipe B).
 *
 * `stop` is the distance as a fraction of the halo's outer edge (`1.8 R`), `alpha`
 * the effective alpha of `#FB5F25` at that radius. Reproducing the measured curve
 * instead of a two-stop gradient is what makes the halo read as light rather than
 * as a soft-edged disc: a linear falloff has a visible shoulder where it ends.
 */
const HALO_STOPS: ReadonlyArray<readonly [number, number]> = [
  [0, 0.86],
  [0.567, 0.83],
  [0.622, 0.64],
  [0.672, 0.45],
  [0.728, 0.32],
  [0.778, 0.21],
  [0.833, 0.13],
  [0.889, 0.07],
  [0.939, 0.03],
  [1, 0],
];

/** Outer radius of the halo in pixels: `1.8 R = 0.9 D`. */
const HALO_PX = ASTRO_GEOMETRY.clearSpace * BODY_PX;

const BODY_R_PX = (ASTRO_GEOMETRY.bodyRadius * BODY_PX) | 0;

/**
 * The textures, one per expression state, created on first use.
 *
 * Twelve states at 512² RGBA is 12.6 MB of VRAM in the worst case, and a session
 * that has shown all twelve has earned it: a texture per state is what makes
 * switching expression a `map` assignment instead of a re-raster on the render
 * thread.
 */
const textures = new Map<AstroExpression, THREE.CanvasTexture>();

/** The texture for a state, drawn on first call. */
export function astroTexture(expression: AstroExpression): THREE.CanvasTexture {
  const cached = textures.get(expression);
  if (cached != null) return cached;

  const canvas = drawAstro(expression);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  /**
   * Nearest-neighbour would alias the halo into a staircase on a phone at DPR
   * 1.5; mipmaps would shimmer it. Linear + no mipmaps is the flat-vector choice.
   */
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.generateMipmaps = false;
  textures.set(expression, texture);
  return texture;
}

/**
 * Drop every cached texture.
 *
 * Deliberately not wired to a component unmount: the cache is module state, a
 * route change re-enters the same states, and disposing on unmount would rebuild
 * every texture on every visit. Call it from a dev-tools hook or a test teardown.
 */
export function disposeAstroTextures(): void {
  for (const texture of textures.values()) texture.dispose();
  textures.clear();
}

/**
 * Draw one expression state onto a fresh canvas.
 *
 * Layer order is the stylesheet's, bottom to top: halo, rim bloom, body,
 * features, punctuation. Nothing here reads the expression's *meaning* — the
 * model already resolved "what does `alert` look like" into a feature, a pair
 * position and a glyph.
 */
export function drawAstro(expression: AstroExpression): HTMLCanvasElement {
  const spec = ASTRO_EXPRESSIONS[expression];
  const canvas = document.createElement("canvas");
  canvas.width = TEXTURE_SIZE;
  canvas.height = TEXTURE_SIZE;

  const ctx = canvas.getContext("2d");
  if (ctx == null) return canvas;

  ctx.clearRect(0, 0, TEXTURE_SIZE, TEXTURE_SIZE);
  drawHalo(ctx);
  drawBloom(ctx);
  drawBody(ctx);
  drawFeatures(ctx, spec);
  drawGlyph(ctx, spec.glyph);

  return canvas;
}

/** 1 — the glow disc: `#FB5F25`, `σ = 0.15 D`, gone by `1.8 R`. */
function drawHalo(ctx: CanvasRenderingContext2D): void {
  const gradient = ctx.createRadialGradient(MID, MID, 0, MID, MID, HALO_PX);
  for (const [stop, alpha] of HALO_STOPS) {
    gradient.addColorStop(stop, hexAlpha(ASTRO_COLOURS.glow, alpha));
  }
  ctx.fillStyle = gradient;
  ctx.beginPath();
  ctx.arc(MID, MID, HALO_PX, 0, Math.PI * 2);
  ctx.fill();
}

/**
 * 2a — rim bloom: a flush duplicate of the body in `#FF8B00`, `σ = 0.06 D`.
 *
 * `ctx.filter` would be the literal translation of `feGaussianBlur`, but Canvas
 * 2D filters are recent enough that a phone WebView may ignore the property
 * silently and draw a hard orange disc. A ring gradient is the same light with no
 * support question: transparent until `0.84 R`, brightest just inside the
 * silhouette, gone by `1.08 R`.
 */
function drawBloom(ctx: CanvasRenderingContext2D): void {
  const outer = BODY_R_PX * 1.08;
  const gradient = ctx.createRadialGradient(MID, MID, BODY_R_PX * 0.84, MID, MID, outer);
  gradient.addColorStop(0, hexAlpha(ASTRO_COLOURS.bodyTop, 0));
  gradient.addColorStop(0.625, hexAlpha(ASTRO_COLOURS.bodyTop, 0.55));
  gradient.addColorStop(1, hexAlpha(ASTRO_COLOURS.bodyTop, 0));
  ctx.fillStyle = gradient;
  ctx.beginPath();
  ctx.arc(MID, MID, outer, 0, Math.PI * 2);
  ctx.fill();
}

/**
 * 2b — the body: a perfect circle with a **fixed world-space** linear gradient.
 *
 * The gradient's endpoints are `centre + (-284, -324)` to `centre + (+290,
 * +296.5)` in sheet units, i.e. a 137° diagonal that moves with the body and never
 * rotates with it. Both facts are copied, not re-derived: a radial gradient here
 * reads as a lit sphere, and an `objectBoundingBox` gradient rotates with the
 * plane when the rig tilts it.
 */
function drawBody(ctx: CanvasRenderingContext2D): void {
  const gradient = ctx.createLinearGradient(
    MID - 284 * S,
    MID - 324 * S,
    MID + 290 * S,
    MID + 296.5 * S,
  );
  gradient.addColorStop(0, ASTRO_COLOURS.bodyTop);
  gradient.addColorStop(0.543802, ASTRO_COLOURS.bodyMid);
  gradient.addColorStop(1, ASTRO_COLOURS.bodyBottom);

  ctx.fillStyle = gradient;
  ctx.beginPath();
  ctx.arc(MID, MID, BODY_R_PX, 0, Math.PI * 2);
  ctx.fill();
}

/**
 * 3 — the eye pair, or the pair of arcs/dashes that replaces it.
 *
 * The pair is drawn as a unit: midpoint, then `± separation / 2`. The model's
 * separation is per-state on purpose (148 open, 172 happy, 180 dash) because the
 * sheet varies it — a single constant is the difference between "the sheet's
 * character" and "a smiley".
 */
function drawFeatures(ctx: CanvasRenderingContext2D, spec: AstroExpressionSpec): void {
  const cx = MID + spec.midpointX * BODY_PX;
  const cy = MID + spec.midpointY * BODY_PX;
  const half = (spec.separation * BODY_PX) / 2;

  if (spec.shadow != null) {
    const dx = spec.shadow.x * BODY_PX;
    const dy = spec.shadow.y * BODY_PX;
    ctx.fillStyle = hexAlpha(ASTRO_COLOURS.featureShadow, ASTRO_GEOMETRY.shadowOpacity);
    ctx.strokeStyle = hexAlpha(ASTRO_COLOURS.featureShadow, ASTRO_GEOMETRY.shadowOpacity);
    /**
     * The doze lids are the one state whose shadow is *wider* than the cream
     * shape (96 vs 90) — that extra weight is what makes a 3:1 dash read as a
     * closed eyelid rather than as a stray line.
     */
    const widen = spec.feature === "dash" ? 3 : 0;
    drawFeaturePair(ctx, spec, cx + dx, cy + dy, half, widen);
  }

  ctx.fillStyle = ASTRO_COLOURS.cream;
  ctx.strokeStyle = ASTRO_COLOURS.cream;
  drawFeaturePair(ctx, spec, cx, cy, half, 0);
}

/**
 * One shape, twice, at `± half`.
 *
 * `widen` grows each shape by that many sheet units beyond its nominal width —
 * the shadow-only knob above. It is in sheet units, like every other number here,
 * so the caller's `3` means the sheet's `(96 - 90) / 2`.
 */
function drawFeaturePair(
  ctx: CanvasRenderingContext2D,
  spec: AstroExpressionSpec,
  cx: number,
  cy: number,
  half: number,
  widen: number,
): void {
  for (const sign of [-1, 1] as const) {
    const x = cx + sign * half;
    if (spec.feature === "open") {
      const rx = (ASTRO_GEOMETRY.eyeWidth * BODY_PX) / 2 + widen * S;
      const ry = (ASTRO_GEOMETRY.eyeHeight * BODY_PX) / 2;
      ctx.beginPath();
      ctx.ellipse(x, cy, rx, ry, 0, 0, Math.PI * 2);
      ctx.fill();
      continue;
    }

    /**
     * A crescent and a dash are the same path at two amplitudes, which is what
     * the sheet does: a quadratic bow with a round cap. `happy` is the
     * reconstruction `04-astro-expressions.md` gives as indistinguishable below
     * 200 px; `dash` is the same bow at ~30 % of the rise and 3.1× wider than
     * tall.
     */
    const happy = spec.feature === "happy";
    const width = happy ? ASTRO_GEOMETRY.happyWidth : ASTRO_GEOMETRY.dashWidth;
    const thickness = happy ? 22 : 18;
    const rise = happy ? -30 : -9;
    const span = (width * BODY_PX) / 2 + widen * S;

    ctx.lineWidth = thickness * S;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(x - span, cy);
    ctx.quadraticCurveTo(x, cy + rise * S, x + span, cy);
    ctx.stroke();
  }
}

/** 4 — the one optional mark outside the body. Never two at once. */
function drawGlyph(ctx: CanvasRenderingContext2D, glyph: AstroExpressionSpec["glyph"]): void {
  ctx.fillStyle = ASTRO_COLOURS.cream;
  ctx.strokeStyle = ASTRO_COLOURS.cream;
  ctx.lineJoin = "round";
  ctx.lineCap = "round";

  if (glyph === "alert") {
    drawExclamation(ctx);
    return;
  }
  if (glyph === "question") {
    drawQuestion(ctx);
    return;
  }
  if (glyph === "zs-2") {
    drawZs(ctx, 2);
    return;
  }
  if (glyph === "zs-3") {
    drawZs(ctx, 3);
  }
}

/**
 * `!` at 8 o'clock: a tapered cream bar and a dot, 101 sheet units apart.
 *
 * Transcription of the sheet's two shapes (bbox `45.3 × 140.7` centred at
 * `(-317, -384.5)`, dot `r 19.5` at `(-317, -283)`). The taper is drawn as a
 * four-point path rather than approximated with a stroke, because a rounded
 * stroke of this length reads as an `i`.
 */
function drawExclamation(ctx: CanvasRenderingContext2D): void {
  const cx = MID + -317 * S;
  const cy = MID + -384.5 * S;
  const topY = cy - 70.35 * S;
  const bottomY = cy + 70.35 * S;
  const topHalf = 22.65 * S;
  const bottomHalf = 10 * S;

  ctx.beginPath();
  ctx.moveTo(cx - topHalf, topY);
  ctx.lineTo(cx + topHalf, topY);
  ctx.lineTo(cx + bottomHalf, bottomY);
  ctx.lineTo(cx - bottomHalf, bottomY);
  ctx.closePath();
  ctx.fill();

  ctx.beginPath();
  ctx.arc(MID + -317 * S, MID + -283 * S, 19.5 * S, 0, Math.PI * 2);
  ctx.fill();
}

/**
 * `?` at 2 o'clock, leaning toward the body.
 *
 * The sheet composes this from five pieces (dot, bar, folder, inner ellipse,
 * hook); at the ~1 px per sheet unit this canvas runs at, the hook's inner
 * counters are sub-pixel, so the glyph is drawn as the shape it reads as: a
 * stroked arc, a short descending bar, the dot. Geometry is the sheet's outer
 * dimensions — dot at `(+429.1, -123.8)`, hook crown at `(+460.1, -366.8)` — so
 * the mark sits where the frames put it and clears the rim by the same margin.
 */
function drawQuestion(ctx: CanvasRenderingContext2D): void {
  ctx.save();
  ctx.translate(MID, MID);

  const crown = -366.8;
  const dot = -123.8;
  const radius = 64;
  const cy = crown + radius;
  const stroke = 34 * S;

  ctx.lineWidth = stroke;
  ctx.beginPath();
  ctx.arc(460 * S, cy * S, radius * S, Math.PI, 0, false);
  ctx.stroke();

  /** The stem of a `?` leaves the arc's right end and turns toward the dot. */
  ctx.beginPath();
  ctx.moveTo(460 * S + radius * S, cy * S);
  ctx.lineTo(460 * S + radius * S - 22 * S, (cy + 96) * S);
  ctx.stroke();

  ctx.beginPath();
  ctx.arc(429.1 * S, dot * S, 24 * S, 0, Math.PI * 2);
  ctx.fill();

  ctx.restore();
}

/**
 * Two or three `z`s, ascending to the upper right and growing as they go.
 *
 * Top-left corners and sizes are the sheet's own (`z1 29×45` at `(+268, -439)`,
 * `z2 36×55` at `(+316.5, -372)`, `z3 44×67` at `(+351.5, -497)`). The sheet keeps
 * them static; `05-motion.md` is where the stagger and fade live when they are
 * animated, and that is a scene's job, not a texture's.
 */
function drawZs(ctx: CanvasRenderingContext2D, count: 2 | 3): void {
  const frames: ReadonlyArray<readonly [number, number, number, number]> = [
    [268, -439, 29, 45],
    [316.5, -372, 36, 55],
    [351.5, -497, 44, 67],
  ];
  /** `deep-sleep` shows all three; `sleep` shows the first two. */
  const shown = count === 3 ? frames : frames.slice(0, 2);

  for (const [x, y, w, h] of shown) {
    ctx.lineWidth = h * 0.2 * S;
    ctx.beginPath();
    ctx.moveTo(MID + x * S, MID + y * S);
    ctx.lineTo(MID + (x + w) * S, MID + y * S);
    ctx.lineTo(MID + x * S, MID + (y + h) * S);
    ctx.lineTo(MID + (x + w) * S, MID + (y + h) * S);
    ctx.stroke();
  }
}

/** `#RRGGBB` + alpha → `rgba()`. The palette is six hex literals by design. */
function hexAlpha(hex: string, alpha: number): string {
  const r = Number.parseInt(hex.slice(1, 3), 16);
  const g = Number.parseInt(hex.slice(3, 5), 16);
  const b = Number.parseInt(hex.slice(5, 7), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}
