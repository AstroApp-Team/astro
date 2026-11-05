/**
 * The rig editor's read/write view of the Theatre.js project.
 *
 * Everything the studio panels show about keyframes comes from here, and the reason is that
 * there are three plausible sources and only one is live:
 *
 * 1. the exported `states/portfolio-project.state.json` — the canonical file, but stale the
 *    moment the Studio saves (its Save writes `astro.local.state.json`, and `getProject` merges
 *    that over the canonical file **per sheet**, so the canonical JSON no longer describes what
 *    the canvas is playing);
 * 2. the scene's JSX — the *initial* values only, with no keyframes at all;
 * 3. `studio.createContentOfSaveFile(projectId)` — the project's current on-disk state, which
 *    includes the Studio's unsaved edits.
 *
 * So (3) is the source whenever the Studio is loaded, and (1) is the fallback for a production
 * build or a phone, where the Studio never initialises: a read-only, last-shipped timeline is
 * still far better than an empty panel that says "nothing rigged yet".
 *
 * Writes go through `studio.transaction`, which is what makes a prop edit *keyframe at the
 * playhead* rather than set a static override — the documented behaviour of `set()` on a
 * sequenced prop. There is no other supported writer: Theatre has no public API for "add a
 * keyframe at t", and hand-editing its state is forbidden.
 */

import type { IStudio } from "@theatre/studio";
import type { ISheet } from "@theatre/core";

import { PROJECT_ID, projectStates } from "@infra/theatre/states/index.ts";

export type Keyframe = { position: number; value: unknown };

export type TrackRow = {
  objectKey: string;
  /** Decoded prop path, e.g. `position.x`. */
  path: string;
  /** The encoded path the state file uses, e.g. `["position","x"]`. */
  encoded: string;
  keyframes: Keyframe[];
};

type RawState = {
  sheetsById?: Record<
    string,
    {
      sequence?: { length?: number; tracksByObject?: Record<string, RawTracks> };
      staticOverrides?: { byObject?: Record<string, unknown> };
    }
  >;
};

type RawTracks = {
  trackIdByPropPath?: Record<string, string>;
  trackData?: Record<string, { keyframes?: { position?: number; value?: unknown }[] }>;
};

/** The canonical export, used when the Studio is not loaded. */
const canonical = projectStates[PROJECT_ID] as RawState | undefined;

function liveState(studio: IStudio | null): RawState | null {
  if (studio == null) return null;
  try {
    return studio.createContentOfSaveFile(PROJECT_ID) as RawState;
  } catch {
    return null;
  }
}

export function sheetState(
  sheetId: string,
  studio: IStudio | null,
): RawState["sheetsById"] extends Record<string, infer V> | undefined ? V | undefined : never {
  const live = liveState(studio);
  return live?.sheetsById?.[sheetId] ?? canonical?.sheetsById?.[sheetId];
}

export function sequenceLength(sheetId: string, studio: IStudio | null): number {
  return sheetState(sheetId, studio)?.sequence?.length ?? 0;
}

/** `["position","x"]` → `position.x`. */
function decodePath(encoded: string): string {
  try {
    const parts = JSON.parse(encoded) as unknown;
    return Array.isArray(parts) ? parts.map(String).join(".") : encoded;
  } catch {
    return encoded;
  }
}

/**
 * Every keyframed track on a sheet, grouped per object and sorted by path.
 *
 * Objects with no tracks are absent — the caller adds the "rig has no keyframes" case from the
 * sheet's static overrides, which is where a pose set entirely outside the sequence lives.
 */
export function trackRows(sheetId: string, studio: IStudio | null): TrackRow[] {
  const tracksByObject = sheetState(sheetId, studio)?.sequence?.tracksByObject ?? {};
  const rows: TrackRow[] = [];
  for (const [objectKey, tracks] of Object.entries(tracksByObject)) {
    const byPath = tracks?.trackIdByPropPath ?? {};
    for (const [encoded, trackId] of Object.entries(byPath)) {
      const data = tracks?.trackData?.[trackId];
      const keyframes = (data?.keyframes ?? [])
        .map((kf) => ({ position: kf.position ?? 0, value: kf.value }))
        .sort((a, b) => a.position - b.position);
      rows.push({ objectKey, path: decodePath(encoded), encoded, keyframes });
    }
  }
  return rows.sort((a, b) =>
    a.objectKey === b.objectKey
      ? a.path.localeCompare(b.path)
      : a.objectKey.localeCompare(b.objectKey),
  );
}

/** Every object the sheet knows about, keyframed or not. */
export function objectKeys(sheetId: string, studio: IStudio | null): string[] {
  const state = sheetState(sheetId, studio);
  const keys = new Set<string>(Object.keys(state?.sequence?.tracksByObject ?? {}));
  for (const key of Object.keys(state?.staticOverrides?.byObject ?? {})) keys.add(key);
  return [...keys].sort();
}

/** The sheet's static (non-keyframed) values for an object, flattened to `path → value`. */
export function staticValues(
  sheetId: string,
  objectKey: string,
  studio: IStudio | null,
): Record<string, unknown> {
  const byObject = sheetState(sheetId, studio)?.staticOverrides?.byObject ?? {};
  const flat: Record<string, unknown> = {};
  flatten(byObject[objectKey], "", flat);
  return flat;
}

function flatten(value: unknown, prefix: string, out: Record<string, unknown>): void {
  if (value == null) return;
  if (typeof value === "number" || typeof value === "boolean" || typeof value === "string") {
    if (prefix !== "") out[prefix] = value;
    return;
  }
  if (typeof value === "object") {
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      flatten(child, prefix === "" ? key : `${prefix}.${key}`, out);
    }
  }
}

/* ── Live object access ───────────────────────────────────────────────── */

export function liveObject(sheet: ISheet, objectKey: string) {
  return sheet.__experimental_getExistingObject(objectKey);
}

/**
 * The current value of one prop, straight off the live object.
 *
 * `undefined` when the object or path does not exist — which is normal and not an error: the
 * camera and lights of a scene are created by drei, not by `sheet.object`, so a track can exist
 * for an object the public API refuses to hand out.
 */
export function liveValue(
  sheet: ISheet,
  objectKey: string,
  path: string,
): number | boolean | string | undefined {
  const object = liveObject(sheet, objectKey);
  if (object == null) return undefined;
  const parts = path.split(".");
  let cursor: unknown = object.value;
  for (const part of parts) {
    if (cursor == null || typeof cursor !== "object") return undefined;
    cursor = (cursor as Record<string, unknown>)[part];
  }
  return typeof cursor === "number" || typeof cursor === "boolean" || typeof cursor === "string"
    ? cursor
    : undefined;
}

/**
 * Set a prop, keyframing it at the sequence's current position.
 *
 * `set()` on a sequenced prop is documented to write a keyframe rather than a static override,
 * and it is the only writer that keeps Theatre's own model consistent (selection, undo level,
 * dope sheet). A prop that is not sequenced gets a static override, which is still the right
 * thing to author from here.
 */
export function writeProp(
  studio: IStudio | null,
  sheet: ISheet,
  objectKey: string,
  path: string,
  value: number | boolean | string,
): { ok: true } | { ok: false; reason: string } {
  if (studio == null) {
    return { ok: false, reason: "The Studio is only available in dev, on a desktop browser." };
  }
  const object = liveObject(sheet, objectKey);
  if (object == null) {
    return { ok: false, reason: `“${objectKey}” is not a sheet object — nothing to write to.` };
  }

  const leaf = leafPointer(object, path);
  if (leaf == null) {
    return { ok: false, reason: `${path} is not a pointer on “${objectKey}”.` };
  }

  try {
    studio.transaction(({ set }) => {
      set(leaf as never, value as never);
    });
    return { ok: true };
  } catch (error) {
    return { ok: false, reason: error instanceof Error ? error.message : String(error) };
  }
}

type Pointerish = Record<string, unknown> & { getValue?: () => unknown };

/** The leaf `Pointer` for `position.x` on a live object, or `null` if the path is not one. */
function leafPointer(object: { props: unknown }, path: string): Pointerish | null {
  const parts = path.split(".");
  let cursor: unknown = object.props;
  for (const part of parts.slice(0, -1)) {
    if (cursor == null || typeof cursor !== "object") return null;
    cursor = (cursor as Record<string, unknown>)[part];
  }
  const leafKey = parts.at(-1);
  if (leafKey == null || cursor == null || typeof cursor !== "object") return null;
  const leaf = (cursor as Pointerish)[leafKey];
  return leaf == null ? null : (leaf as Pointerish);
}

/**
 * Delete the keyframe at `at` on one prop.
 *
 * This is Theatre's own delete: `unset()` on a sequenced pointer removes the keyframe at the
 * *current* sequence position, so the position is moved there first and restored afterwards. The
 * alternative — rewriting `tracksByObject` in the state file — is the second writer this project
 * keeps refusing to become; `unset` goes through the Studio's transaction and lands in its undo
 * stack, which a hand-edited JSON does not.
 */
export function deleteKeyframe(
  studio: IStudio | null,
  sheet: ISheet,
  objectKey: string,
  path: string,
  at: number,
): { ok: true } | { ok: false; reason: string } {
  if (studio == null) return { ok: false, reason: "The Studio is only available in dev." };
  const object = liveObject(sheet, objectKey);
  if (object == null) return { ok: false, reason: `“${objectKey}” is not a sheet object.` };
  const leaf = leafPointer(object, path);
  if (leaf == null) return { ok: false, reason: `${path} is not a pointer.` };

  const restore = sheet.sequence.position;
  try {
    sheet.sequence.position = at;
    studio.transaction(({ unset }) => {
      unset(leaf as never);
    });
    return { ok: true };
  } catch (error) {
    return { ok: false, reason: error instanceof Error ? error.message : String(error) };
  } finally {
    sheet.sequence.position = restore;
  }
}

/**
 * Move one keyframe from `from` to `to`, keeping its value.
 *
 * Two public operations instead of one internal one: write the old value at the new time, then
 * delete the old keyframe. The consequence is that the keyframe's handles are recomputed rather
 * than carried — a drag in Theatre's dope sheet preserves them — and that is the honest limit of
 * doing this through the public API. It is still a real move: the value is the one from the
 * original keyframe, read from the state file, not whatever the playhead happened to show.
 */
export function moveKeyframe(
  studio: IStudio | null,
  sheet: ISheet,
  sheetId: string,
  objectKey: string,
  path: string,
  from: number,
  to: number,
): { ok: true } | { ok: false; reason: string } {
  if (studio == null) return { ok: false, reason: "The Studio is only available in dev." };
  if (Math.abs(to - from) < 1e-4) return { ok: true };
  const row = trackRows(sheetId, studio).find(
    (candidate) => candidate.objectKey === objectKey && candidate.path === path,
  );
  const frame = row?.keyframes.find((candidate) => Math.abs(candidate.position - from) < 1e-3);
  if (frame == null) return { ok: false, reason: `No keyframe at ${from.toFixed(3)}s on ${path}.` };
  const value = frame.value;
  if (typeof value !== "number" && typeof value !== "boolean" && typeof value !== "string") {
    return { ok: false, reason: `${path} is not a scalar — this panel only moves scalars.` };
  }
  const written = writeProp(studio, sheet, objectKey, path, value);
  if (!written.ok) return written;
  const deleted = deleteKeyframe(studio, sheet, objectKey, path, from);
  if (!deleted.ok) return deleted;
  sheet.sequence.position = to;
  return { ok: true };
}

/** The sequence playhead, in seconds. */
export function playheadOf(sheet: ISheet): number {
  return sheet.sequence.position;
}

export function seekTo(sheet: ISheet, at: number): void {
  sheet.sequence.position = Math.max(0, at);
}

export type { ISheet };

/**
 * Set the sequence's duration.
 *
 * `sequence.pointer.length` is the sheet's own clock: shortening it does not delete keyframes,
 * it clips playback (a keyframe past the end simply never plays). That is Theatre's behaviour,
 * so this panel does not pretend to tidy up after it — the header says how many keyframes are
 * past the end instead.
 */
export function setSequenceLength(
  studio: IStudio | null,
  sheet: ISheet,
  length: number,
): { ok: true } | { ok: false; reason: string } {
  const next = Math.max(0.1, Math.min(600, length));
  if (studio == null) {
    /* Without the Studio the sheet is the shipped one: `pointer.length` is a `Pointer`. */
    try {
      (sheet.sequence.pointer as unknown as { length: number }).length = next;
      return { ok: true };
    } catch (error) {
      return { ok: false, reason: error instanceof Error ? error.message : String(error) };
    }
  }
  try {
    studio.transaction(({ set }) => {
      set(sheet.sequence.pointer.length, next);
    });
    return { ok: true };
  } catch (error) {
    return { ok: false, reason: error instanceof Error ? error.message : String(error) };
  }
}

/**
 * Playback rate, in `sequence.playbackRate`.
 *
 * A speed multiplier is a *transport* setting, not an edit: it is not saved with the sheet, and
 * the runtime's own clock is unaffected — which is exactly what an author wants when checking a
 * 6 s cycle at 0.25×.
 */
export function readSpeed(sheet: ISheet): number {
  const sequence = sheet.sequence as unknown as { playbackRate?: number };
  return typeof sequence.playbackRate === "number" ? sequence.playbackRate : 1;
}

export function setSpeed(sheet: ISheet, rate: number): void {
  const sequence = sheet.sequence as unknown as { playbackRate?: number };
  sequence.playbackRate = Math.max(0.05, Math.min(8, rate));
}

/** Keyframes that sit past the sequence's end — playback clips them, the panel should say so. */
export function keyframesPastEnd(sheetId: string, studio: IStudio | null, length: number): number {
  let count = 0;
  for (const row of trackRows(sheetId, studio)) {
    for (const frame of row.keyframes) if (frame.position > length + 1e-6) count += 1;
  }
  return count;
}
