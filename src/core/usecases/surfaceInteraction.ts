/**
 * The pure half of "a React page used as a texture".
 *
 * Three questions, all answerable with numbers and no DOM:
 *
 *   1. A raycast hit a textured mesh at a UV. Which pixel of the page is that?
 *   2. That pixel is inside a button's rect. Which button?
 *   3. What does pressing a button do to app state, and what does the log say?
 *
 * The rects are published by the page (it measures its own buttons), and the
 * raycast is delivered by the mesh. Neither side touches the other: the mesh hands
 * over a UV, this turns it into an action id, and the page acts on the action. That
 * keeps the project's rule intact — the store is the only 2D ↔ 3D channel, and a
 * mesh never reaches into a DOM node.
 */

import type { SurfaceSpec } from "@core/models/surface.ts";

/** What a button on a surface page does. */
export const SURFACE_ACTIONS = ["paint-sphere", "spin-square"] as const;

export type SurfaceAction = (typeof SURFACE_ACTIONS)[number];

/** Runtime guard for an action id arriving from a `data-` attribute. */
export function isSurfaceAction(value: unknown): value is SurfaceAction {
  return (SURFACE_ACTIONS as readonly unknown[]).includes(value);
}

/** A point in a surface page's own coordinate space: CSS pixels, origin top-left. */
export type SurfacePoint = { x: number; y: number };

/**
 * A button's box, measured in the page's own space.
 *
 * Measured by the page, not declared: the counter inside the button's label changes
 * its width, and a hardcoded rect is a rect that stops matching the first time the
 * label grows.
 */
export type SurfaceRect = {
  action: SurfaceAction;
  x: number;
  y: number;
  width: number;
  height: number;
};

/** Where the press came from. The log records both, because they are the demo. */
export const SURFACE_SOURCES = ["texture", "page"] as const;

export type SurfaceSource = (typeof SURFACE_SOURCES)[number];

/** A press that landed. */
export type SurfaceHit = { action: SurfaceAction; source: SurfaceSource; point: SurfacePoint };

/**
 * A UV → a page pixel.
 *
 * The flip on `y` is the whole trick and it is not arbitrary: three uploads an
 * image with `flipY = true` (the default), so UV `v = 1` is the **top** row of the
 * canvas the DOM was drawn into. A raycast reports `v = 1` at the top of the plane,
 * the page's top row is `y = 0`, so `y = (1 - v) * height`. Skip the flip and every
 * hit is mirrored vertically — the button at the bottom of the page answers taps at
 * the top, which reads as "the buttons are off by a bit" rather than as a flip.
 *
 * Returns `null` outside the unit square. On a sphere the UV wraps, so a hit on the
 * far side of the sphere is a real point on the page — that is intended, and the
 * page's buttons are reachable from the back of the sphere too.
 */
export function uvToSurfacePoint(uvX: number, uvY: number, spec: SurfaceSpec): SurfacePoint | null {
  if (!Number.isFinite(uvX) || !Number.isFinite(uvY)) return null;
  if (uvX < 0 || uvX > 1 || uvY < 0 || uvY > 1) return null;

  return {
    x: Math.min(spec.width, Math.max(0, uvX * spec.width)),
    y: Math.min(spec.height, Math.max(0, (1 - uvY) * spec.height)),
  };
}

/**
 * The rect a point lands in, or `null`.
 *
 * Document order, first match wins: the rects come off a `querySelectorAll` of the
 * host, so the first entry is the topmost in the DOM. Buttons do not overlap on
 * these pages, and if a future page makes them overlap, the one written first wins
 * — which is the same answer as "the one on top", and is at least *an* answer.
 */
export function findSurfaceRect(
  rects: readonly SurfaceRect[],
  point: SurfacePoint,
): SurfaceRect | null {
  for (const rect of rects) {
    if (rect.width <= 0 || rect.height <= 0) continue;
    if (point.x < rect.x || point.x > rect.x + rect.width) continue;
    if (point.y < rect.y || point.y > rect.y + rect.height) continue;
    return rect;
  }
  return null;
}

/**
 * The colours the square page's button cycles the sphere through.
 *
 * Deliberately not adjacent hues: the point of the demo is a colour change visible
 * from across the scene, and two neighbouring blues read as "did anything happen?".
 */
export const SPHERE_COLORS: readonly string[] = [
  "#38bdf8",
  "#f472b6",
  "#a3e635",
  "#fbbf24",
  "#c084fc",
  "#fb7185",
  "#2dd4bf",
  "#f97316",
] as const;

/**
 * The next colour, never the current one.
 *
 * `random` is a parameter, same as in `floatInteraction.ts`: the function stays
 * pure and testable, and the caller decides what randomness means.
 */
export function nextSphereColor(current: string | null, random: () => number): string {
  const index = current == null ? -1 : SPHERE_COLORS.indexOf(current);
  if (index === -1) {
    const picked =
      SPHERE_COLORS[Math.floor(random() * SPHERE_COLORS.length) % SPHERE_COLORS.length];
    return picked ?? SPHERE_COLORS[0]!;
  }

  const offset = Math.floor(random() * (SPHERE_COLORS.length - 1));
  const next = SPHERE_COLORS[(index + 1 + offset) % SPHERE_COLORS.length];
  return next ?? SPHERE_COLORS[0]!;
}

/** A row of the page's action log. */
export type SurfaceActionRow = {
  id: number;
  action: SurfaceAction;
  source: SurfaceSource;
  /** Where the press landed on the page, in CSS pixels. `null` for a page-side press. */
  point: SurfacePoint | null;
  /** The playhead the spin started from, in seconds. `null` for a press that is not a spin. */
  from: number | null;
};

export type SurfaceActionLog = {
  rows: SurfaceActionRow[];
  count: number;
};

export const EMPTY_SURFACE_LOG: SurfaceActionLog = { rows: [], count: 0 };

/** The log is a demo surface on a phone, not an audit trail. */
export const MAX_SURFACE_ROWS = 40;

/**
 * Appends a row, newest first, capped.
 *
 * Same shape as the float log: `count` keeps counting past the cap, so the summary
 * tells the truth about how many presses happened while the visible list stays
 * bounded.
 */
export function appendSurfaceAction(
  log: SurfaceActionLog,
  action: SurfaceAction,
  source: SurfaceSource,
  point: SurfacePoint | null,
  from: number | null,
): SurfaceActionLog {
  const row: SurfaceActionRow = { id: log.count + 1, action, source, point, from };
  return {
    rows: [row, ...log.rows].slice(0, MAX_SURFACE_ROWS),
    count: log.count + 1,
  };
}

/** What a press was, in the page's own words. */
export function describeAction(action: SurfaceAction): string {
  return action === "paint-sphere" ? "paint the colour sphere" : "spin the square page";
}

/** One line under the log: what has been pressed, and from where. */
export function surfaceSummary(log: SurfaceActionLog): string {
  if (log.count === 0) return "Nothing pressed yet.";

  const fromTexture = log.rows.filter((row) => row.source === "texture").length;
  const paints = log.rows.filter((row) => row.action === "paint-sphere").length;
  const spins = log.rows.filter((row) => row.action === "spin-square").length;
  const shown = log.rows.length === log.count ? "" : ` (showing last ${log.rows.length})`;

  return (
    `${log.count} press${log.count === 1 ? "" : "es"}${shown} — ${fromTexture} through the texture, ` +
    `${log.count - fromTexture} from the page. ${paints} paint${paints === 1 ? "" : "s"}, ${spins} spin${spins === 1 ? "" : "s"}.`
  );
}

/**
 * Is a press a request to spin?
 *
 * Named as a predicate so the page's effect reads as intent, and so the test suite
 * pins the one action that moves the playhead.
 */
export function isSpinRequest(action: SurfaceAction): boolean {
  return action === "spin-square";
}

/**
 * Rows in one tile of a page's looping list.
 *
 * The list is rendered twice, stacked, and the pair is translated by `-offset` wrapped
 * into `[0, LOOP_TILE_HEIGHT)`: at any offset the viewer sees the tail of tile 1 and the
 * head of tile 2, so scrolling past the end arrives at the beginning with no seam, in
 * either direction. That only holds if the tile the CSS lays out is exactly this many
 * rows of exactly `LOOP_ROW_HEIGHT`, which is why the page sets the tile's height and
 * every row's height inline from these constants instead of trusting a stylesheet to
 * agree with them.
 */
export const LOOP_ROWS = 12;

/** One row of the loop, in page pixels. A raycast target is a row: 50 px is readable. */
export const LOOP_ROW_HEIGHT = 50;

/**
 * Marks a subtree that is a visual duplicate of the looped page.
 *
 * `SurfaceLoop` renders the page twice so the scroll has no seam. This says which copy is
 * the duplicate — it is a label, not a filter, and the rect measurer does not read it.
 *
 * Filtering on it is the bug it was written for. As the offset grows, the first tile's copy
 * walks out of the window's top and the copy the user is looking at *is* the duplicate. A
 * measurer that skips it publishes no rect for the button on screen: the button is drawn,
 * the tap lands on empty texture, and it reads as a raycast that dies in the lower half of
 * the mesh. What keeps a phantom rect out of the registry is the window clip — a copy
 * outside the window is not drawn, so it publishes nothing.
 *
 * It is deliberately not `aria-hidden`: the parked hosts already carry that, and a
 * measurer that skips `aria-hidden` subtrees skips every surface button there is.
 */
export const SURFACE_GHOST_ATTR = "data-surface-ghost";

/** Marks the element that clips a looped page — the loop's window. */
export const SURFACE_WINDOW_ATTR = "data-surface-window";

/**
 * A hit region this thin is not a button the user can aim at.
 *
 * Deliberately small. On the sphere the texture is wrapped pole to pole, so the rows near
 * the poles are drawn in a thin band, and a button clipped to 20 px of the window is
 * drawn 20 px tall on the mesh — visible, and the tap the user aims at it is a tap on
 * those 20 px. A generous minimum makes a button visible and unhittable, which is worse
 * than a generous minimum being protective.
 */
export const MIN_VISIBLE_SIZE = 8;

/**
 * The part of a rect the user can actually see, in the same coordinates as the rect.
 *
 * A looped page clips its content at the window, and `getBoundingClientRect` reports the
 * element's full box whether or not it is inside the window. Without the intersection, a
 * button that has scrolled out of the texture — invisible, not drawn — keeps a rect that
 * reaches into the window, and a tap on a row that is on screen fires it. The press looks
 * like it belongs to the wrong thing.
 *
 * Returns null when the visible part is too small to aim at, so a button half clipped at
 * the edge of the window is not a target either.
 */
export function clipRectToWindow(
  rect: SurfaceRect,
  window: SurfaceRect,
  minSize: number = MIN_VISIBLE_SIZE,
): SurfaceRect | null {
  const left = Math.max(rect.x, window.x);
  const top = Math.max(rect.y, window.y);
  const right = Math.min(rect.x + rect.width, window.x + window.width);
  const bottom = Math.min(rect.y + rect.height, window.y + window.height);

  const width = right - left;
  const height = bottom - top;
  if (width < minSize || height < minSize) return null;

  return { ...rect, x: left, y: top, width, height };
}

/**
 * The button block at the head of the sphere page, in page pixels.
 *
 * It is a constant because the **whole page** is the loop tile: the button scrolls off
 * the top and comes back at the bottom, so the wrap point includes it. A tile whose
 * height is only the rows is a tile the browser lays out taller than the scroll wraps
 * at, and the seam shows as a jump every turn.
 *
 * 240, not any number: `LOOP_TILE_HEIGHT` must divide evenly by `MAX_WHEEL_DELTA` (the
 * test that walks one full tile forward and back asserts it). 150 made the tile 750,
 * 750 / 120 is 6.25, and the walk stopped landing on the start.
 */
export const LOOP_HEADER_HEIGHT = 240;

/** The height the scroll wraps at: one tile of the duplicated pair. */
export const LOOP_TILE_HEIGHT = LOOP_HEADER_HEIGHT + LOOP_ROWS * LOOP_ROW_HEIGHT;

/** How much of the loop a page shows at once, in page pixels. */
export const LOOP_STRIP_HEIGHT = 300;

/**
 * How far one wheel event may travel.
 *
 * `deltaY` is in no fixed unit: a mouse gives ~100 per notch, a trackpad gives 1–10 per
 * event at hundreds of events a second, and `deltaMode` can be lines (so the number is
 * per line, not per pixel). Clamping one event's travel is what makes a trackpad flick
 * and a mouse notch feel the same, and it stops one event jumping past the tile.
 */
export const MAX_WHEEL_DELTA = 120;

/** One `deltaMode: lines` notch, in pixels. Firefox reports lines; a row is ~32 px. */
export const WHEEL_LINE_PIXELS = 32;

/**
 * One wheel event's travel, in pixels.
 *
 * `WheelEvent.deltaMode` says what `deltaY` is counted in: 0 pixels, 1 lines, 2 pages.
 * Firefox and a mouse report lines, so a notch arrives as `3`, and a page that scrolls
 * `3` px per notch reads as a wheel that barely moves. Convert first, clamp second —
 * clamping a line-mode delta before the conversion is what makes it invisible.
 */
export function wheelDeltaToPixels(deltaY: number, deltaMode: number): number {
  const perLine = deltaMode === 1 ? WHEEL_LINE_PIXELS : 1;
  return clampWheelDelta(deltaY * perLine);
}

/**
 * Finger pixels to texture pixels for a drag on the real page.
 *
 * A drag is the touch half of the same command as a wheel: the pointer is over a mesh,
 * the finger travels in viewport pixels, and the list moves in texture pixels. 1:1 makes
 * a 200 px swipe scroll 200 of a 600 px tile, which is a third of the list for a full
 * swipe across the phone. 1.6 is the tuning: a swipe from the top of the mesh to the
 * bottom of it is roughly one tile.
 */
export const SCROLL_DRAG_FACTOR = 1.6;

/** One wheel event's travel, clamped. Non-finite input scrolls nothing. */
export function clampWheelDelta(deltaY: number): number {
  if (!Number.isFinite(deltaY)) return 0;
  return Math.min(MAX_WHEEL_DELTA, Math.max(-MAX_WHEEL_DELTA, deltaY));
}

/**
 * Advance a looping scroll offset by one wheel event, or by one drag step.
 *
 * The result is always inside `[0, tileHeight)`, in both directions: JS `%` keeps the
 * sign of the dividend, so a negative offset needs the extra `+ tileHeight`. A page
 * translated by an offset that runs off the end of its duplicated pair shows a blank
 * strip, which is the seam this wrap removes.
 */
export function advanceLoopScroll(
  offset: number,
  delta: number,
  tileHeight: number = LOOP_TILE_HEIGHT,
): number {
  if (!(tileHeight > 0)) return 0;
  const base = Number.isFinite(offset) ? offset : 0;
  const next = base + clampWheelDelta(delta);
  return ((next % tileHeight) + tileHeight) % tileHeight;
}
