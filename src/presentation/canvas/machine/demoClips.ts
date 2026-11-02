/**
 * The demo's clips.
 *
 * A clip is data — keyframes in seconds — and this file is the "asset" the demo resolver
 * serves. It exists as TypeScript rather than a GLTF so the page has no network dependency
 * and no asset pipeline: the point of the demo is the machine, not the model.
 */

import type { BoneChannelAsset, ClipAsset } from "@core/interfaces/animationAssets.ts";

function bone(
  name: string,
  channelName: BoneChannelAsset["channel"],
  times: number[],
  values: number[],
): BoneChannelAsset {
  return {
    bone: name,
    channel: channelName,
    times: new Float32Array(times),
    values: new Float32Array(values),
  };
}

/** `idle`: the root bobs 4 cm and settles. */
export const IDLE_CLIP: ClipAsset = {
  id: "demo.idle",
  duration: 2,
  bones: [
    bone("root", "position", [0, 1, 2], [0, 0, 0, 0, 0.08, 0, 0, 0, 0]),
    bone("hand", "position", [0, 2], [1.1, 0.1, 0, 1.1, 0.1, 0]),
  ],
  morphs: [],
};

/** `wave`: the hand lifts and swings, while the head blinks once via its own morph track. */
export const WAVE_CLIP: ClipAsset = {
  id: "demo.wave",
  duration: 1.2,
  bones: [
    bone("root", "position", [0, 1.2], [0, 0, 0, 0, 0, 0]),
    bone(
      "hand",
      "position",
      [0, 0.3, 0.6, 0.9, 1.2],
      [1.1, 0.1, 0, 1.3, 0.9, 0, 0.95, 0.95, 0, 1.3, 0.9, 0, 1.1, 0.1, 0],
    ),
  ],
  morphs: [
    {
      mesh: "head",
      target: "blink",
      times: new Float32Array([0, 0.15, 0.3, 1.2]),
      values: new Float32Array([0, 1, 0, 0]),
    },
  ],
};
