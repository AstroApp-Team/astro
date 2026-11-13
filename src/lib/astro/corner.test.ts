import { describe, expect, it } from "vite-plus/test";

import { ASTRO_V2_BODY_RADIUS, ASTRO_V2_HALO_RADIUS } from "./astroV2.ts";
import {
  ASTRO_CORNER_EDGE_RATIO,
  ASTRO_CORNER_HALO_WORLD,
  ASTRO_CORNER_INSET_RATIO,
  ASTRO_HERO_SCALE,
  anchoredPosition,
  characterScale,
  clampAnchor,
  cornerPosition,
  orthographicHalfExtent,
  orthographicZoom,
  visibleHalfExtent,
} from "./corner.ts";

/** The camera the overlay declares: orthographic, `zoom` derived from the canvas size. */
/** The overlay's own coverage (`HALO_COVERAGE` in `AstroOverlay.tsx`), so these cases
 * describe the framing that actually ships. */
const OVERLAY_COVERAGE = 0.25;

function framing(widthPx: number, heightPx: number, coverage = OVERLAY_COVERAGE) {
  const zoom = orthographicZoom(widthPx, heightPx, coverage);
  return orthographicHalfExtent(widthPx, heightPx, zoom);
}

describe("orthographic framing", () => {
  it("maps pixels to world units through zoom", () => {
    /* zoom is pixels-per-world-unit, so the frame is the canvas divided by it. */
    expect(orthographicHalfExtent(800, 600, 100)).toEqual({ halfWidth: 4, halfHeight: 3 });
  });

  it("keeps the canvas's aspect ratio rather than squaring the frame", () => {
    /* Deriving both halves from one dimension would put him off-centre on a phone: the
       half extents have to carry the canvas's own ratio. */
    const portrait = framing(390, 844);
    expect(portrait.halfHeight / portrait.halfWidth).toBeCloseTo(844 / 390, 5);
  });

  it("sizes the halo against the longer side, on either orientation", () => {
    /* `coverage` is a fraction of the **longer** side, so the halo occupies that fraction of
       max(width, height) in pixels — measured against the halo, not the body. Sizing by the
       shorter side measured a portrait phone by its narrow width, which is what made him an
       icon on a handset and correct on a monitor. */
    for (const [w, h] of [
      [1440, 900],
      [390, 844],
      [844, 390],
    ] as const) {
      const zoom = orthographicZoom(w, h, 0.25);
      const haloPx = 2 * ASTRO_CORNER_HALO_WORLD * zoom;
      expect(haloPx).toBeCloseTo(Math.max(w, h) * 0.25, 3);
    }
  });

  it("gives a portrait phone the monitor's framing instead of its own width", () => {
    /* The report was "he's too small on phone, fine on desktop". At the overlay's 25% the
       monitor is unchanged from the old 30%-of-shorter-side rule (360px), while the phone
       grows by a third — 211px of glow instead of 156px, ~111px of body instead of 82px. */
    const haloSpan = (w: number, h: number) =>
      2 * ASTRO_CORNER_HALO_WORLD * orthographicZoom(w, h, 0.25);

    expect(haloSpan(1440, 900)).toBeCloseTo(360, 3);
    expect(haloSpan(390, 844)).toBeCloseTo(211, 3);
    expect(haloSpan(390, 844)).toBeGreaterThan(156 * 1.3);
  });
});

describe("cornerPosition", () => {
  it("puts the body in the bottom-right on a phone, not the top-right", () => {
    const [x, y] = cornerPosition(framing(390, 844));
    const { halfHeight, halfWidth } = framing(390, 844);

    /* three's camera space has y up, so the bottom of the frame is negative. */
    expect(y).toBeLessThan(0);
    expect(x).toBeGreaterThan(0);
    expect(-y).toBeGreaterThan(halfHeight / 2);
    expect(x).toBeGreaterThan(halfWidth / 2);
  });

  it("stays in the corner at both ends of the aspect range", () => {
    for (const [w, h] of [
      [320, 700],
      [800, 800],
      [1440, 900],
      [2400, 1000],
    ] as const) {
      const extent = framing(w, h);
      const [x, y] = cornerPosition(extent);
      expect(y).toBeLessThan(0);
      expect(x).toBeGreaterThan(0);
      /* Past the midline in both directions, on every aspect — that is the corner. */
      expect(x).toBeGreaterThan(extent.halfWidth / 2);
      expect(-y).toBeGreaterThan(extent.halfHeight / 2);
    }
  });

  it("clamps the inset when the frame is tighter than the halo", () => {
    /* The clamp is the guard for a framing where the halo alone would exceed the frame:
       zooming in enough (0.9 coverage) makes a phone's half-width smaller than the halo's
       inset, and without the clamp the centre would land back on the midline. */
    const tight = framing(390, 844, 0.9);
    expect(ASTRO_CORNER_HALO_WORLD * ASTRO_CORNER_INSET_RATIO).toBeGreaterThan(
      tight.halfWidth * ASTRO_CORNER_EDGE_RATIO,
    );
    const [x] = cornerPosition(tight);
    expect(x).toBeCloseTo(tight.halfWidth - tight.halfWidth * ASTRO_CORNER_EDGE_RATIO, 5);
    expect(x).toBeGreaterThan(tight.halfWidth / 2);
  });

  it("uses the halo's own inset when the frame has room, and the clamp when it does not", () => {
    /* Which of the two applies is a property of the framing, not of the screen: at the
       overlay's 25%-of-the-longer-side framing a monitor's half-width (4.36 units) leaves
       room for the halo's 0.93-unit inset, while a portrait phone's (2.01) does not — the
       clamp binds there and the glow bleeds ~18px off the edge instead of pushing him
       toward the middle. Both outcomes are the design; what must never happen is the centre
       drifting left of the corner. */
    const monitor = framing(1440, 900);
    expect(ASTRO_CORNER_HALO_WORLD * ASTRO_CORNER_INSET_RATIO).toBeLessThan(
      monitor.halfWidth * ASTRO_CORNER_EDGE_RATIO,
    );
    expect(cornerPosition(monitor)[0]).toBeCloseTo(
      monitor.halfWidth - ASTRO_CORNER_HALO_WORLD * ASTRO_CORNER_INSET_RATIO,
      5,
    );

    const portrait = framing(390, 844);
    expect(ASTRO_CORNER_HALO_WORLD * ASTRO_CORNER_INSET_RATIO).toBeGreaterThan(
      portrait.halfWidth * ASTRO_CORNER_EDGE_RATIO,
    );
    expect(cornerPosition(portrait)[0]).toBeCloseTo(
      portrait.halfWidth - portrait.halfWidth * ASTRO_CORNER_EDGE_RATIO,
      5,
    );
    expect(cornerPosition(portrait)[0]).toBeGreaterThan(portrait.halfWidth / 2);
  });

  it("keeps the whole body on screen, and lets the rim of the halo cross the edge", () => {
    const extent = framing(390, 844);
    const [x, y] = cornerPosition(extent);

    expect(x + ASTRO_V2_BODY_RADIUS).toBeLessThan(extent.halfWidth);
    expect(y - ASTRO_V2_BODY_RADIUS).toBeGreaterThan(-extent.halfHeight);

    /* The inset is measured against the halo, so a slice of the glow goes off-screen on
       purpose. Flush placement with no halo visible is the failure this guards. */
    expect(x + ASTRO_CORNER_HALO_WORLD).toBeGreaterThan(extent.halfWidth);
    expect(ASTRO_CORNER_INSET_RATIO).toBeGreaterThan(0.5);
  });

  it("measures the inset against the sheet's halo, 1.9× the body", () => {
    expect(ASTRO_V2_HALO_RADIUS / ASTRO_V2_BODY_RADIUS).toBeCloseTo(1.9, 5);
    expect(ASTRO_CORNER_HALO_WORLD).toBeCloseTo(ASTRO_V2_HALO_RADIUS, 5);
    expect(ASTRO_CORNER_HALO_WORLD).toBeGreaterThan(ASTRO_V2_BODY_RADIUS);
  });
});

describe("the perspective framing it replaced", () => {
  it("still computes half extents from fov and distance", () => {
    /* Kept because the corner arithmetic is projection-agnostic, and this is the shape the
       `clean-refactor` figures were measured against (fov 45 at z 7.5). */
    const { halfHeight } = visibleHalfExtent({ aspect: 1.6, cameraZ: 7.5, fovDeg: 45 });
    expect(halfHeight).toBeCloseTo(Math.tan((45 * Math.PI) / 360) * 7.5, 5);
  });
});

/**
 * Dragging.
 *
 * The anchor is stored in `[-1, 1]` viewport space — the same space the pointer and the look
 * origin use — so these cases are about the two things that space costs: an anchor has to be
 * clamped against a *body radius that grows relative to the frame as the frame shrinks*, and it
 * has to survive a resize that moves the edges in under it.
 */
describe("dragging", () => {
  const phone = orthographicHalfExtent(390, 844, orthographicZoom(390, 844, OVERLAY_COVERAGE));
  const desktop = orthographicHalfExtent(1440, 900, orthographicZoom(1440, 900, OVERLAY_COVERAGE));

  it("maps the centre of the frame to the origin", () => {
    expect(anchoredPosition({ x: 0, y: 0 }, phone)).toEqual([0, 0, 0]);
  });

  it("maps the anchor as a fraction of the visible half extents", () => {
    const [x, y] = anchoredPosition({ x: 0.5, y: -0.25 }, desktop);
    expect(x).toBeCloseTo(desktop.halfWidth * 0.5, 10);
    expect(y).toBeCloseTo(-desktop.halfHeight * 0.25, 10);
  });

  it("keeps the body inside the frame rather than letting it be dropped half off", () => {
    const [x, y] = anchoredPosition({ x: 1, y: 1 }, phone);
    expect(x + ASTRO_V2_BODY_RADIUS).toBeLessThanOrEqual(phone.halfWidth + 1e-10);
    expect(y + ASTRO_V2_BODY_RADIUS).toBeLessThanOrEqual(phone.halfHeight + 1e-10);
  });

  it("clamps per axis, against whichever side of the frame is the scarcer one", () => {
    /* The margin is the body radius over the half extent, so the clamp is not "a phone clamps
       harder" — it is per axis. Portrait: width is scarce. Landscape: height is. Both facts
       matter, because the halo is sized off the *longer* side, which makes the shorter side the
       one the body crowds. */
    const dropped = { x: 0.95, y: 0.95 };
    const onPhone = clampAnchor(dropped, phone);
    const onDesktop = clampAnchor(dropped, desktop);

    expect(onPhone.x).toBeLessThan(onDesktop.x);
    expect(onDesktop.y).toBeLessThan(onPhone.y);
  });

  it("leaves an anchor that already fits untouched", () => {
    expect(clampAnchor({ x: 0.1, y: -0.2 }, desktop)).toEqual({ x: 0.1, y: -0.2 });
  });

  it("cannot invert its own bounds in a frame narrower than the body", () => {
    /* The clamp margin is capped at 1, so a pathological viewport yields the centre rather
       than a bound smaller than its own lower bound — which would flip him to the far edge. */
    const tiny = { halfWidth: 0.01, halfHeight: 0.01 };
    const clamped = clampAnchor({ x: 0.8, y: -0.8 }, tiny);
    expect(clamped).toEqual({ x: 0, y: 0 });
  });
});

describe("characterScale", () => {
  it("enlarges Astro on the hero stage and returns to 1 once building or anchored", () => {
    expect(ASTRO_HERO_SCALE).toBeGreaterThan(1.4);
    expect(characterScale(true, false)).toBe(ASTRO_HERO_SCALE);
    expect(characterScale(true, true)).toBe(1);
    expect(characterScale(false, false)).toBe(1);
    expect(characterScale(false, true)).toBe(1);
  });
});
