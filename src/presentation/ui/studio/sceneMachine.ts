/**
 * A machine per scene, seeded from that scene's own sheet.
 *
 * The studio used to open the shipped `machine-demo` definition no matter which sheet was on the
 * canvas. That is wrong in a way that is invisible until you author something: two scenes shared
 * one machine, so a state added while rigging `StingScene` appeared in `FloatScene`'s graph too,
 * and a clip id from one sheet resolved to nothing in the other. A definition names clips as
 * `SheetId/ObjectKey`, so a definition belongs to exactly one sheet.
 *
 * The seed is deliberately boring: one clip state per keyframed object on the sheet, each with its
 * own timeline. It gives the graph something true to draw, the left column something drag-able,
 * and — because those are real Theatre clips — the preview actually plays. Everything after that
 * is the author's edit, stored per scene under its own draft key.
 */

import type { MachineDefinition, TimelineDef } from "@core/models/animationStateMachine.ts";

/** `Float Sphere` → `float-sphere`, and a leading digit is not a legal id start. */
function slug(value: string): string {
  const base = value
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/g, "-")
    .replaceAll(/^-+|-+$/g, "");
  return /^[a-z]/.test(base) ? base : `s-${base}`;
}

export type SceneClip = { objectKey: string; clip: string; duration: number };

/**
 * Build the seed for one scene.
 *
 * `entry` points at the first state (or at nothing when the sheet has no keyframed objects) and
 * every state carries its own `timeline`: the runtime schedules timelines, and a state without one
 * would be a state that plays the sheet's raw sequence — not what "rig this scene" should mean.
 */
export function seedSceneMachine(
  sceneId: string,
  clips: SceneClip[],
  sequenceLength: number,
): MachineDefinition {
  const timelines: TimelineDef[] = [];
  const states = clips.map((clip, index) => {
    /*
     * Both ids carry the ordinal: a sheet can hold two clips of one object (a walk and an idle,
     * say), and `tl-${objectKey}` then collides with itself — two rows with one id, one of which
     * the store silently overwrites.
     */
    const id = `${slug(clip.objectKey)}-${String(index + 1)}`;
    const timelineId = `tl-${slug(clip.objectKey)}-${String(index + 1)}`;
    timelines.push({
      id: timelineId,
      duration: Math.max(0.1, clip.duration),
      playStyle: { kind: "loop" },
      speed: 1,
      clip: clip.clip,
    });
    return {
      id,
      type: "clip" as const,
      timeline: timelineId,
      clip: clip.clip,
      speed: 1,
      ...(index === 0 ? {} : { tags: [] }),
    };
  });

  /*
   * A sheet with no keyframed objects still gets a valid machine, and that is not cosmetic: the
   * loader rejects a layer with no `entry` (`no-entry`), so a seed built from zero clips was an
   * *invalid* definition, and the store's `apply` refuses to write on top of an invalid one — every
   * edit in that scene (a new timeline, an input, a state) was silently dropped. `astro-v2`'s
   * sheet carries no Theatre tracks, which is why "create a timeline" did nothing there and
   * nothing was ever said about it.
   *
   * The placeholder is a clip state bound to an empty timeline, not a `direct` state: a `direct`
   * state is input-driven and the loader requires `entries` on it (`direct-entries`), while a clip
   * state is satisfied by a `timeline` reference. The timeline carries no `clip`, so it animates
   * nothing — it is a real row to re-point, not a fake pose.
   */
  const placeholder: { states: Record<string, unknown>[]; timelines: TimelineDef[] } =
    states.length > 0
      ? { states: [], timelines: [] }
      : {
          states: [{ id: "idle", type: "clip" as const, timeline: "tl-idle", speed: 1 }],
          timelines: [
            {
              id: "tl-idle",
              duration: Math.max(0.5, sequenceLength > 0 ? sequenceLength : 1),
              playStyle: { kind: "loop" },
              speed: 1,
            },
          ],
        };
  const allStates = [...states, ...placeholder.states];
  timelines.push(...placeholder.timelines);
  const first = allStates[0]?.id as string | undefined;
  return {
    schemaVersion: 1,
    name: `${sceneId}-machine`,
    inputs: [],
    layers: [
      {
        id: "base",
        priority: 0,
        blend: "override",
        weight: 1,
        states: allStates,
        transitions: [],
        anyState: [],
        entry: first == null ? [] : [{ to: first }],
      },
    ],
    timelines,
    ...(sequenceLength > 0 ? { sequence: { length: sequenceLength } } : {}),
  } as unknown as MachineDefinition;
}

/** The default timeline a `+` in the left column creates: a real clip row, not an empty shell. */
export function newTimelineFor(
  sheetId: string,
  clip: string | null,
  duration: number,
): Partial<TimelineDef> {
  return {
    duration: Math.max(0.1, duration),
    playStyle: { kind: "loop" },
    speed: 1,
    ...(clip == null ? {} : { clip }),
    id: `${slug(sheetId)}-tl`,
  };
}
