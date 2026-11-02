/**
 * `AssetResolver` over Theatre.js sequence tracks.
 *
 * The core knows nothing about Theatre: it asks for a clip id and gets keyframes in
 * seconds. This module is the only place that knows where those keyframes physically live,
 * and it reads them out of the **merged project state** (`projectStates[PROJECT_ID]`) rather
 * than out of the running sheet, because the state is the same object in dev and production
 * and it needs no DOM — `ISheet` does.
 *
 * Clip ids are `"<SheetId>/<ObjectKey>"`, e.g. `"FloatScene/Float Sphere"`. A bare object
 * key is accepted when exactly one sheet has it; an ambiguous one is an error naming the
 * candidates, because silently picking the first is how a demo plays the wrong clip.
 *
 * ── This is the "timelines are Theatre" seam ───────────────────────────────
 *
 * Nothing is baked to disk and nothing is resampled on a fixed grid: the keyframes are read
 * out of the exported state on first use and held in a cache. So the workflow is the one
 * the app already has — rig on `/rig/<scene>`, press the Studio's Save, reload — and the
 * machine plays exactly those curves, bézier handles included (`theatreTracks.ts` in core
 * does the sampling, so it is unit-tested without a browser).
 *
 * The one thing a Theatre sequence cannot carry is a morph channel: the Studio's R3F
 * adapter keyframes transforms, not blend shapes. A definition that wants a morph needs a
 * static clip beside this resolver, and `morphCurve()` says so by name instead of returning
 * `null`.
 */

import type {
  AssetResolver,
  BoneChannelAsset,
  ClipAsset,
} from "@core/interfaces/animationAssets.ts";
import {
  quatFromEuler,
  sampleNumberTrack,
  unionKeyTimes,
  type TheatreKeyframe,
} from "@core/usecases/animationStateMachine/theatreTracks.ts";
import { PROJECT_ID, projectStates } from "@infra/theatre/states/index.ts";

/* ── The slice of the exported state this module reads ────────────────── */

interface RawTrack {
  keyframes?: TheatreKeyframe[];
}

interface RawObjectTracks {
  trackIdByPropPath?: Record<string, string>;
  trackData?: Record<string, RawTrack>;
}

interface RawSequence {
  length?: number;
  tracksByObject?: Record<string, RawObjectTracks>;
}

interface RawProjectState {
  sheetsById?: Record<string, { sequence?: RawSequence }>;
}

/** What one sheet contributes, for the Studio pane and for error messages. */
export interface TheatreClipInfo {
  /** `<SheetId>/<ObjectKey>` — the id a definition's `clip` field takes. */
  id: string;
  sheetId: string;
  objectKey: string;
  duration: number;
  channels: BoneChannelAsset["channel"][];
}

/* ── Track plumbing ──────────────────────────────────────────────────── */

function channel(
  bone: string,
  channelName: BoneChannelAsset["channel"],
  times: number[],
  values: number[],
): BoneChannelAsset {
  return {
    bone,
    channel: channelName,
    times: new Float32Array(times),
    values: new Float32Array(values),
  };
}

/** Expand `[position, x]` into the three per-axis tracks, or `null` if any is missing. */
function axisTracks(
  object: RawObjectTracks,
  prop: string,
): {
  x: readonly TheatreKeyframe[];
  y: readonly TheatreKeyframe[];
  z: readonly TheatreKeyframe[];
} | null {
  const byPath = object.trackIdByPropPath ?? {};
  const data = object.trackData ?? {};
  const one = (axis: string): readonly TheatreKeyframe[] | null => {
    const id = byPath[JSON.stringify([prop, axis])];
    const track = id == null ? undefined : data[id];
    return track?.keyframes ?? null;
  };
  const x = one("x");
  const y = one("y");
  const z = one("z");
  if (x == null || y == null || z == null) return null;
  return { x, y, z };
}

/**
 * The clip a `"<SheetId>/<ObjectKey>"` id names.
 *
 * Position and scale become one 3-stride channel each. Rotation is the awkward one: the
 * Studio writes **three Euler tracks**, and the core consumes **one quaternion track**, so
 * the axes are resampled on the union of their key times and converted per key — reading
 * each Euler axis as its own channel would let the three drift apart and produce a
 * non-normalized rotation that nothing downstream could diagnose.
 *
 * `bone` is the name the channels are written under. It defaults to the Theatre object key,
 * which is right when a scene's objects are its bones; a rig whose bones are named
 * differently passes a map (`boneMap`), and the same timeline drives it.
 */
function readClip(
  state: RawProjectState,
  sheetId: string,
  objectKey: string,
  bone: string,
): ClipAsset {
  const sequence = state.sheetsById?.[sheetId]?.sequence;
  if (sequence?.tracksByObject == null) {
    throw new Error(
      `theatreAssetResolver: sheet "${sheetId}" has no sequence (a sheet id was passed where a sequence was expected)`,
    );
  }
  const object = sequence.tracksByObject[objectKey];
  if (object == null) {
    const names = Object.keys(sequence.tracksByObject);
    throw new Error(
      `theatreAssetResolver: no object "${objectKey}" in sheet "${sheetId}"; it has ${names.join(", ") || "none"}`,
    );
  }

  const bones: BoneChannelAsset[] = [];

  const position = axisTracks(object, "position");
  if (position != null) {
    const times = unionKeyTimes([position.x, position.y, position.z]);
    const values = times.flatMap((t) => [
      sampleNumberTrack(position.x, t),
      sampleNumberTrack(position.y, t),
      sampleNumberTrack(position.z, t),
    ]);
    bones.push(channel(bone, "position", times, values));
  }

  const scale = axisTracks(object, "scale");
  if (scale != null) {
    const times = unionKeyTimes([scale.x, scale.y, scale.z]);
    const values = times.flatMap((t) => [
      sampleNumberTrack(scale.x, t),
      sampleNumberTrack(scale.y, t),
      sampleNumberTrack(scale.z, t),
    ]);
    bones.push(channel(bone, "scale", times, values));
  }

  const euler = axisTracks(object, "rotation");
  if (euler != null) {
    const times = unionKeyTimes([euler.x, euler.y, euler.z]);
    const values = times.flatMap((t) =>
      quatFromEuler(
        sampleNumberTrack(euler.x, t),
        sampleNumberTrack(euler.y, t),
        sampleNumberTrack(euler.z, t),
      ),
    );
    bones.push(channel(bone, "rotationQuat", times, values));
  }

  if (bones.length === 0) {
    const paths = Object.keys(object.trackIdByPropPath ?? {});
    throw new Error(
      `theatreAssetResolver: object "${objectKey}" in "${sheetId}" has no position, scale or rotation tracks (found ${paths.join(", ") || "none"}); Theatre sequences carry no morph channels — use a static resolver for those`,
    );
  }

  return { id: `${sheetId}/${objectKey}`, duration: sequence.length ?? 1, bones, morphs: [] };
}

/* ── The resolver ────────────────────────────────────────────────────── */

export interface TheatreAssetResolverOptions {
  /** Read a different state than the live project's, e.g. a fixture in a test. */
  state?: unknown;
  /**
   * Theatre object key → the bone the machine writes to. Omitted, the object key is the
   * bone name, which is right for a scene whose objects *are* the rig it animates.
   */
  boneMap?: Record<string, string>;
}

/**
 * Every clip a state file defines, for the Studio pane's picker. Sorted by id so the list
 * does not shuffle between reloads.
 */
export function listTheatreClips(state: unknown = projectStates[PROJECT_ID]): TheatreClipInfo[] {
  const raw = state as RawProjectState;
  const out: TheatreClipInfo[] = [];
  for (const [sheetId, sheet] of Object.entries(raw.sheetsById ?? {})) {
    for (const [objectKey, object] of Object.entries(sheet.sequence?.tracksByObject ?? {})) {
      const channels: BoneChannelAsset["channel"][] = [];
      if (axisTracks(object, "position") != null) channels.push("position");
      if (axisTracks(object, "scale") != null) channels.push("scale");
      if (axisTracks(object, "rotation") != null) channels.push("rotationQuat");
      if (channels.length === 0) continue;
      out.push({
        id: `${sheetId}/${objectKey}`,
        sheetId,
        objectKey,
        duration: sheet.sequence?.length ?? 1,
        channels,
      });
    }
  }
  return out.sort((a, b) => a.id.localeCompare(b.id));
}

/**
 * A resolver that keeps a cache per id: the sheet's state cannot change while the app runs
 * (a Studio Save re-reads the page), so re-walking the keyframes every frame is pure waste.
 */
export function theatreAssetResolver(options: TheatreAssetResolverOptions = {}): AssetResolver {
  /*
   * The state is read **per call**, not when the resolver is built.
   *
   * A resolver built at a page's module scope can run before `project.ts` has populated
   * `projectStates` (module init order across the state → project → resolver chain is not
   * something a caller can see), and an eagerly captured `undefined` then fails every later
   * lookup with "the resolver cannot produce <clip>" — a message that points at the clip, not
   * at the moment the resolver was made. Reading it lazily costs one property access.
   */
  const state = (): RawProjectState =>
    (options.state ?? projectStates[PROJECT_ID]) as RawProjectState;
  const boneMap = options.boneMap ?? {};
  const clips = new Map<string, ClipAsset>();

  const resolveId = (id: string): { sheetId: string; objectKey: string } => {
    const slash = id.indexOf("/");
    if (slash > 0) return { sheetId: id.slice(0, slash), objectKey: id.slice(slash + 1) };
    const matches = Object.entries(state().sheetsById ?? {})
      .filter(([, sheet]) => sheet.sequence?.tracksByObject?.[id] != null)
      .map(([sheetId]) => `${sheetId}/${id}`);
    if (matches.length === 1) {
      const only = matches[0] ?? "";
      return { sheetId: only.slice(0, only.indexOf("/")), objectKey: id };
    }
    throw new Error(
      matches.length === 0
        ? `theatreAssetResolver: no clip "${id}" in the project state; ids are "<SheetId>/<ObjectKey>"`
        : `theatreAssetResolver: clip "${id}" is ambiguous, it exists in ${matches.join(", ")}`,
    );
  };

  return {
    clip(id: string): ClipAsset {
      const cached = clips.get(id);
      if (cached != null) return cached;
      const { sheetId, objectKey } = resolveId(id);
      const clip = readClip(state(), sheetId, objectKey, boneMap[objectKey] ?? objectKey);
      clips.set(id, clip);
      return clip;
    },
    /** Theatre has no morph channel, so this is a loud, named failure, not a `null`. */
    morphCurve(id: string): never {
      throw new Error(
        `theatreAssetResolver: morph curves are not in a Theatre sequence ("${id}"); supply a static resolver beside this one`,
      );
    },
  };
}

/**
 * Two resolvers behind one: the first that answers wins.
 *
 * The demo needs both — a static clip for the morph channel Theatre cannot carry, and the
 * project state for everything rigged in the Studio. `morphCurve` is asked in turn instead of
 * being forwarded to the first resolver, so a static morph curve still resolves when the
 * clip came from Theatre.
 */
export function combinedResolver(primary: AssetResolver, fallback: AssetResolver): AssetResolver {
  return {
    /*
     * "No answer" is a *falsy* result as well as a throw.
     *
     * A static resolver answers undefined for an id it does not know — it has no reason to
     * throw — and the first version of this function forwarded that undefined straight out,
     * so a Theatre clip behind a static primary was never asked for and the definition failed
     * validation with "the resolver cannot produce <id>". Catch and falsy both fall through.
     */
    clip: (id) => {
      let first: ClipAsset | null | undefined;
      try {
        first = primary.clip(id);
      } catch {
        first = null;
      }
      if (first != null) return first;
      return fallback.clip(id);
    },
    morphCurve: (id) => {
      try {
        const curve = primary.morphCurve(id);
        if (curve != null) return curve;
      } catch {
        /* The primary has no morph curves at all — that is the Theatre resolver, not an error. */
      }
      return fallback.morphCurve(id);
    },
  };
}
