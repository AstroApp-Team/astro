/**
 * Pure rules for the float page — the reverse demonstration.
 *
 * `/showcase` is a page laid over a rigged scene. `/float` is a React page with a
 * rigged sphere laid over *it*, and the interactions run the other way: a tap on
 * the 3D object appends a row to a table in the page, and the page answers by
 * moving the object. Both directions are plain data, so both live here, where they
 * can be tested without a canvas, a DOM, or a Theatre sheet.
 *
 * Zero imports: no `@theatre/core`, no `three`, no `window`, no timers. The page
 * supplies the numbers; this module decides what they mean.
 */

/** The `theatreKey` of the one object the float scene mounts. */
export const FLOAT_SPHERE_KEY = "Float Sphere";

/** What the sphere says when you hit it. */
export const HIT_MESSAGE = "you got me!";

/**
 * Rows are capped. The page is a phone screen and the log is a demo, so the list
 * keeps the most recent rows and drops the oldest rather than growing a scroll
 * region the user has to fight.
 */
export const MAX_HITS = 40;

/** One row of the page's log. */
export type FloatHit = {
  /** 1-based, and it is the row number the table prints. */
  id: number;
  text: string;
  /** The sheet's playhead when the hit landed, in seconds. */
  playhead: number;
  /** The accent colour the hit rolled, so a row can be identified by its swatch. */
  hue: string;
};

/** Is this raycast hit the sphere? Everything else on the page is not. */
export function isFloatSphere(nodeId: string | null): boolean {
  return nodeId === FLOAT_SPHERE_KEY;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function clamp(value: number, low: number, high: number): number {
  return Math.min(high, Math.max(low, value));
}

/**
 * Where to send the sphere next.
 *
 * The sphere's position is the rig's, so "move the sphere" is "seek the playhead",
 * and the set of places it can go is the range the clip is rigged over. A uniform
 * draw scaled onto `[0, length - 0.05]` is the whole idea — the 0.05 is what keeps a
 * draw of 1 off the sequence's end, so the result is always inside the loop — with
 * one addition: a draw that lands within `minGap` of where the sphere already is
 * gets mirrored by half the loop.
 * Without that, a tap on a six-second orbit lands on the same spot often enough to
 * read as a click that did nothing, which is the exact failure this page is here to
 * demonstrate the absence of.
 *
 * `random` is a parameter so the mirroring is testable without stubbing globals.
 */
export function nextSeekTime(
  length: number,
  from: number,
  random: () => number = Math.random,
  minGap = 0.6,
): number {
  if (length <= 0) return 0;

  const draw = clamp(random(), 0, 1);
  let at = round2(draw * (length - 0.05));

  if (Math.abs(at - from) < minGap) {
    at = round2((at + length / 2) % length);
  }

  return at;
}

/**
 * The log, as one value.
 *
 * `rows` is what the table renders and it is capped; `count` is the running total,
 * which is why a row number keeps counting after the cap starts dropping rows, and
 * `dropped` is what the footer admits. Keeping the three in one object is what makes
 * `appendHit` a function of its input instead of a function of two states the page
 * has to keep in agreement.
 */
export type FloatHitLog = {
  rows: FloatHit[];
  count: number;
  dropped: number;
};

export const EMPTY_HIT_LOG: FloatHitLog = { rows: [], count: 0, dropped: 0 };

/**
 * Append a hit.
 *
 * Returns a new log — the page keeps it in state, and a mutation in place would make
 * the previous render's rows and the next render's rows the same objects, which is
 * the kind of thing a memoising render path cannot tell apart.
 */
export function appendHit(log: FloatHitLog, playhead: number, hue: string): FloatHitLog {
  const count = log.count + 1;
  const row: FloatHit = {
    id: count,
    text: HIT_MESSAGE,
    playhead: round2(playhead),
    hue,
  };

  const rows = [...log.rows, row];
  const overflow = Math.max(0, rows.length - MAX_HITS);

  return { rows: rows.slice(-MAX_HITS), count, dropped: log.dropped + overflow };
}

/**
 * A sentence about the log for the page's footer.
 *
 * `dropped` is printed because "40 hits" from a capped list is a number the user
 * should not have to trust.
 */
export function hitSummary(log: FloatHitLog): string {
  if (log.rows.length === 0) return "No hits yet — the sphere is waiting.";

  const last = log.rows[log.rows.length - 1];
  const tail = log.dropped > 0 ? ` · ${log.dropped} earlier rows dropped` : "";

  return `${log.count} hit${log.count === 1 ? "" : "s"} · last at t ${last?.playhead ?? 0}s${tail}`;
}
