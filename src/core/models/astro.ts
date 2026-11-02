/**
 * Astro — the character's vocabulary, as numbers.
 *
 * Every value here is transcribed from `assets/astro-stylesheet.svg` and
 * documented for humans in `extra_docs/style/`. Nothing in this file needs a
 * renderer to be understood, which is the point: the character is described by
 * ratios of its own diameter `D`, so the same numbers drive a 32 px badge and a
 * 833 px sheet render without a second set of measurements.
 *
 * Coordinates are expressed as fractions of `D` with **y down**, matching SVG.
 * The stylesheet's absolute units (`R = 416.5`, `D = 833`) appear only in the
 * comments.
 */

/**
 * The 12 distinct states the stylesheet draws. The sheet has 17 frames; three
 * `idle`s and four `look-left`s are literal duplicates, so 12 is the vocabulary.
 */
export const ASTRO_STATES = [
  "idle",
  "look-left",
  "look-right",
  "look-right-shifted",
  "alert",
  "wonder",
  "happy",
  "doze",
  "sleep",
  "deep-sleep",
  "think-right",
  "think-left",
] as const;

export type AstroExpression = (typeof ASTRO_STATES)[number];

/** The three feature shapes the character ever has. */
export type AstroFeature = "open" | "happy" | "dash";

/** The optional marks that live outside the body. One at a time, never two. */
export type AstroGlyph = "none" | "alert" | "question" | "zs-2" | "zs-3";

/**
 * Astro's palette. Six values, no tints, no gradients beyond the body's one
 * three-stop linear gradient.
 */
export const ASTRO_COLOURS = {
  /** The halo. `#FB5F25`, blurred at `σ = 0.15 D`. */
  glow: "#FB5F25",
  bodyTop: "#FF8B00",
  bodyMid: "#FA6B2F",
  bodyBottom: "#FE3402",
  /** Eyes and punctuation. Never pure white — the sheet's `white` is a Figma artefact. */
  cream: "#FEFBF5",
  /** The duplicate drawn under features that have moved. `#FA6B2F` at 0.55. */
  featureShadow: "#995F48",
} as const;

/**
 * The construction ratios. Every one of these is a fraction of the body
 * **diameter** `D`, so a component that knows only `D` can draw the character.
 */
export const ASTRO_GEOMETRY = {
  /** Body radius, as a fraction of `D`. The body is always a perfect circle. */
  bodyRadius: 0.5,
  /** Halo disc radius: `501 / 833`. */
  glowRadius: 0.601,
  /** Halo blur, `stdDeviation` as a fraction of `D`: `125 / 833`. */
  glowBlur: 0.15,
  /** Rim bloom behind the body: `50 / 833`, flush, in `#FF8B00`. */
  bloomBlur: 0.06,
  /** Open eye, `58 × 111 / 833`. */
  eyeWidth: 0.07,
  eyeHeight: 0.133,
  /** Happy crescent, `94 × 52 / 833`. */
  happyWidth: 0.113,
  happyHeight: 0.062,
  /** Asleep dash, `90 × 28.7 / 833`. */
  dashWidth: 0.108,
  dashHeight: 0.034,
  /** Eye separation, `148 / 833`. Filled by the spec table below per state. */
  eyeSeparation: 0.178,
  /** Feature shadow opacity on `#995F48`. */
  shadowOpacity: 0.43,
  /** Keep this much empty space around the centre or the halo is cropped: 1.8 R. */
  clearSpace: 0.9,
} as const;

/** One expression, fully described: what to draw and where. */
export type AstroExpressionSpec = {
  readonly feature: AstroFeature;
  /** Feature pair centre, as a fraction of `D` from the body centre, y down. */
  readonly midpointX: number;
  readonly midpointY: number;
  /** Centre-to-centre separation, as a fraction of `D`. */
  readonly separation: number;
  /** Offset of the `#995F48` copy, as a fraction of `D`. `null` = no shadow. */
  readonly shadow: { readonly x: number; readonly y: number } | null;
  readonly glyph: AstroGlyph;
  /**
   * A reaction, not a resting mood. The owner must schedule a return to the
   * previous state; `isTransient` reads this flag.
   */
  readonly transient: boolean;
};

/** `833`, the stylesheet's body diameter. Ratios above are `units / 833`. */
const D = 833;

/** The eye line: `-49 / 833`. Open eyes sit slightly above the equator. */
const EYE_LINE = -49 / D;
/** Closed, content: `-98.5 / 833`. */
const HAPPY_LINE = -98.5 / D;
/** Closed, asleep: `-51.8 / 833` — three units *below* the open eye line. */
const DOZE_LINE = -51.8 / D;
/** Raised (startled / recalling): `-214 / 833`. */
const HIGH_LINE = -214 / D;

/**
 * The 12 states.
 *
 * `separation` is the sheet's own number per state, not a rule: the happy pair is
 * `172` wide because a crescent's visual mass is its outer edge, the open pair is
 * `148`, and the dashes are `180`. Reproducing the asymmetries is cheaper than
 * inventing a rule and having the character look subtly wrong.
 */
export const ASTRO_EXPRESSIONS: Record<AstroExpression, AstroExpressionSpec> = {
  idle: {
    feature: "open",
    midpointX: 0,
    midpointY: EYE_LINE,
    separation: 148 / D,
    shadow: null,
    glyph: "none",
    transient: false,
  },
  "look-left": {
    feature: "open",
    midpointX: -103.5 / D,
    midpointY: EYE_LINE,
    separation: 148 / D,
    shadow: null,
    glyph: "none",
    transient: false,
  },
  "look-right": {
    feature: "open",
    midpointX: 118.5 / D,
    midpointY: EYE_LINE,
    separation: 148 / D,
    shadow: null,
    glyph: "none",
    transient: false,
  },
  "look-right-shifted": {
    feature: "open",
    midpointX: 225.5 / D,
    midpointY: -55 / D,
    separation: 148 / D,
    shadow: { x: 12 / D, y: 0 },
    glyph: "none",
    transient: false,
  },
  alert: {
    feature: "open",
    midpointX: -126.5 / D,
    midpointY: HIGH_LINE,
    separation: 148 / D,
    shadow: { x: -9 / D, y: -7 / D },
    glyph: "alert",
    transient: true,
  },
  wonder: {
    feature: "open",
    midpointX: -126.5 / D,
    midpointY: HIGH_LINE,
    separation: 148 / D,
    shadow: { x: -9 / D, y: -7 / D },
    glyph: "none",
    transient: true,
  },
  happy: {
    feature: "happy",
    midpointX: 0,
    midpointY: HAPPY_LINE,
    separation: 172 / D,
    shadow: { x: 1 / D, y: -5 / D },
    glyph: "none",
    transient: true,
  },
  doze: {
    feature: "dash",
    midpointX: 0,
    midpointY: DOZE_LINE,
    separation: 180 / D,
    shadow: { x: 6 / D, y: -4.7 / D },
    glyph: "none",
    transient: false,
  },
  sleep: {
    feature: "dash",
    midpointX: 0,
    midpointY: DOZE_LINE,
    separation: 180 / D,
    shadow: null,
    glyph: "zs-2",
    transient: false,
  },
  "deep-sleep": {
    feature: "dash",
    midpointX: 0,
    midpointY: DOZE_LINE,
    separation: 180 / D,
    shadow: null,
    glyph: "zs-3",
    transient: false,
  },
  "think-right": {
    feature: "open",
    midpointX: 225.5 / D,
    midpointY: -55 / D,
    separation: 148 / D,
    shadow: { x: 12 / D, y: 0 },
    glyph: "question",
    transient: true,
  },
  "think-left": {
    feature: "open",
    midpointX: -126.5 / D,
    midpointY: HIGH_LINE,
    separation: 148 / D,
    shadow: { x: -9 / D, y: -7 / D },
    glyph: "question",
    transient: true,
  },
};

/** The `theatreKey` of the character's editable group. */
export const ASTRO_NODE_KEY = "Astro";

/** The default expression, and the one every transient returns to. */
export const ASTRO_DEFAULT_EXPRESSION: AstroExpression = "idle";
