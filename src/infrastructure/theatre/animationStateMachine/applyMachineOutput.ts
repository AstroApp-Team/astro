/**
 * The only module in this feature that touches three.js, and the only place that writes a
 * `MachineOutput` onto objects.
 *
 * Two rules, both of them lessons this repo already paid for:
 *
 * - **Write only what the output actually contains.** `MachineOutput` is sparse on purpose;
 *   iterating every bone and writing whatever the pose happens to hold would fight any
 *   other owner of those props (Theatre keyframes, the pointer, a scene).
 * - **Never set `matrixAutoUpdate = false`.** The `/surface` bug: writes on a mesh whose
 *   matrix update is off are invisible until someone calls `updateMatrix()`, and nothing in
 *   the output says who forgot.
 */

import type { BoneTransform, MachineOutput } from "@core/models/animationStateMachine.ts";
import type { Object3D } from "three";

export interface MachineTargets {
  /** Bone name → object. Names come from the definition, so a missing entry is a wiring bug. */
  bones: ReadonlyMap<string, Object3D>;
  /**
   * `${mesh}:${target}` → the mesh carrying the morph target.
   *
   * Typed as plain `Object3D`: `Mesh`'s own optional `morphTargetInfluences` does not survive
   * `exactOptionalPropertyTypes` when intersected onto `Object3D`, and requiring every call
   * site to spell out the intersection buys nothing — `applyMachineOutput` narrows it once,
   * next to the check that the array exists.
   */
  morphs: ReadonlyMap<string, Object3D>;
}

/** `${mesh}:${target}` → the morph influence index, resolved once per mesh. */
const morphIndexCache = new WeakMap<object, Map<string, number>>();

function morphIndex(mesh: Object3D, target: string): number {
  let byTarget = morphIndexCache.get(mesh);
  if (byTarget == null) {
    byTarget = new Map();
    morphIndexCache.set(mesh, byTarget);
  }
  const cached = byTarget.get(target);
  if (cached != null) return cached;

  /*
   * Resolve by name from the mesh's own morph list. Reading `geometry.morphAttributes`
   * alone is not enough: a primitive blurred into a single mesh has its dictionary on
   * `morphTargetDictionary`, and that is the order three applies influences in.
   */
  const dictionary = (mesh as { morphTargetDictionary?: Record<string, number> })
    .morphTargetDictionary;
  const index = dictionary?.[target];
  if (index == null) {
    throw new Error(
      `applyMachineOutput: mesh "${mesh.name || "(unnamed)"}" has no morph target "${target}"`,
    );
  }
  byTarget.set(target, index);
  return index;
}

function applyBone(object: Object3D, transform: BoneTransform): void {
  if (transform.position != null) {
    const [x, y, z] = transform.position;
    object.position.set(x, y, z);
  }
  if (transform.rotationQuat != null) {
    const [x, y, z, w] = transform.rotationQuat;
    /* The core normalizes; assigning is enough and avoids a second sqrt per bone. */
    object.quaternion.set(x, y, z, w);
  }
  if (transform.scale != null) {
    const [x, y, z] = transform.scale;
    object.scale.set(x, y, z);
  }
}

/**
 * Write `output` onto `targets`.
 *
 * Returns the number of bones and influences touched — a debug panel reads it to tell
 * "the machine produced nothing" from "the adapter dropped it".
 */
export function applyMachineOutput(
  output: MachineOutput,
  targets: MachineTargets,
): {
  bones: number;
  influences: number;
} {
  let bones = 0;
  let written = 0;

  for (const [name, transform] of Object.entries(output.bones)) {
    const object = targets.bones.get(name);
    if (object == null) {
      /* A silent `continue` here is the classic "the rig is wired wrong and nothing says
         so" bug: the definition validated its names against no rig, so this is where a
         typo surfaces. Throwing turns it into a red frame with the bone's name in it. */
      throw new Error(
        `applyMachineOutput: output writes bone "${name}", which the scene does not provide`,
      );
    }
    applyBone(object, transform);
    bones += 1;
  }

  for (const entry of output.morphs) {
    for (const [target, weight] of Object.entries(entry.weights)) {
      const mesh = targets.morphs.get(`${entry.mesh}:${target}`);
      if (mesh == null) {
        throw new Error(
          `applyMachineOutput: output writes morph "${entry.mesh}:${target}", which the scene does not provide`,
        );
      }
      const influences = (mesh as Object3D & { morphTargetInfluences?: number[] })
        .morphTargetInfluences;
      if (influences == null) {
        throw new Error(`applyMachineOutput: "${entry.mesh}" carries no morphTargetInfluences`);
      }
      influences[morphIndex(mesh, target)] = weight;
      written += 1;
    }
  }

  return { bones, influences: written };
}
