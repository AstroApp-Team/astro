/**
 * Mask resolution (§7).
 *
 * A mask is a **channel filter**, not a transform filter. `channels` overrides per
 * channel, `bones` and `morphs` are sets, `extends` unions and `subtract` removes.
 * Nothing in here knows about poses; it answers one question — how much of this channel
 * passes — and the blend code multiplies by the answer.
 *
 * Masks resolve **once at load**. A mask that resolved per frame would walk its
 * `extends` graph 60 times a second for a result that never changes.
 *
 * A layer mask and a constraint mask **intersect**: a constraint masked to `arms`
 * inside a layer masked to `legs` writes nothing, and that is the intended reading,
 * not a conflict to report.
 */

import type { MaskDef } from "@core/models/animationStateMachine.ts";

export interface ResolvedMask {
  /** Allowed bone names. Empty with `unrestricted: false` means "no bones". */
  bones: Set<string>;
  /** Allowed morphs, keyed `mesh:target`. */
  morphs: Set<string>;
  /** Per-channel weights. Key is `bone.channel` or `mesh:target`. */
  channels: Map<string, number>;
  /** True when no mask was declared, so every channel passes at weight 1. */
  unrestricted: boolean;
}

export const OPEN_MASK: ResolvedMask = {
  bones: new Set(),
  morphs: new Set(),
  channels: new Map(),
  unrestricted: true,
};

type MaskTable = Record<string, MaskDef>;
type GroupTable = { bones: ReadonlyMap<string, string[]>; morph: ReadonlyMap<string, string[]> };

const EMPTY_GROUPS: GroupTable = { bones: new Map(), morph: new Map() };

/**
 * Resolve every mask in a definition once.
 *
 * `extends` and `subtract` are resolved depth-first with a memo, and the validator has
 * already rejected cycles, so the memo is an optimisation and not a guard.
 */
export function resolveAllMasks(
  masks: Record<string, MaskDef> | undefined,
  groups: GroupTable = EMPTY_GROUPS,
): Map<string, ResolvedMask> {
  const table = new Map<string, MaskDef>(Object.entries(masks ?? {}));
  const out = new Map<string, ResolvedMask>();

  const resolve = (name: string, stack: Set<string>): ResolvedMask => {
    const cached = out.get(name);
    if (cached != null) return cached;
    const def = table.get(name);
    if (def == null) {
      // An unknown mask is a load error the validator reports. Here it passes
      // everything, because a mask that cannot be resolved must not mute a pose.
      return OPEN_MASK;
    }
    if (stack.has(name)) return OPEN_MASK;
    stack.add(name);

    const resolved: ResolvedMask = {
      bones: new Set(),
      morphs: new Set(),
      channels: new Map(),
      unrestricted: false,
    };

    for (const bone of def.bones ?? []) {
      resolved.bones.add(bone);
    }
    for (const morph of def.morphs ?? []) {
      resolved.morphs.add(`${morph.mesh}:${morph.target}`);
    }

    // A group name is also a bone name, so groups expand into the same set.
    for (const bone of [...resolved.bones]) {
      const group = groups.bones.get(bone);
      if (group != null) {
        resolved.bones.delete(bone);
        for (const member of group) resolved.bones.add(member);
      }
    }
    for (const key of [...resolved.morphs]) {
      const group = groups.morph.get(key);
      if (group != null) {
        resolved.morphs.delete(key);
        for (const member of group) resolved.morphs.add(member);
      }
    }

    for (const parent of def.extends ?? []) {
      const inherited = resolve(parent, stack);
      for (const bone of inherited.bones) resolved.bones.add(bone);
      for (const morph of inherited.morphs) resolved.morphs.add(morph);
      for (const [channel, weight] of inherited.channels) {
        if (!resolved.channels.has(channel)) resolved.channels.set(channel, weight);
      }
    }
    for (const parent of def.subtract ?? []) {
      const removed = resolve(parent, stack);
      for (const bone of removed.bones) resolved.bones.delete(bone);
      for (const morph of removed.morphs) resolved.morphs.delete(morph);
      for (const channel of removed.channels.keys()) resolved.channels.set(channel, 0);
    }

    for (const [channel, weight] of Object.entries(def.channels ?? {})) {
      resolved.channels.set(channel, weight);
    }

    stack.delete(name);
    out.set(name, resolved);
    return resolved;
  };

  for (const name of table.keys()) {
    resolve(name, new Set());
  }

  return out;
}

/** Resolve one mask reference: a name, an inline definition, or nothing. */
export function resolveMaskRef(
  ref: string | MaskDef | undefined,
  masks: Map<string, ResolvedMask>,
  defMasks: MaskTable,
  groups: GroupTable = EMPTY_GROUPS,
): ResolvedMask {
  if (ref == null) return OPEN_MASK;
  if (typeof ref === "string") {
    return masks.get(ref) ?? OPEN_MASK;
  }
  // An inline mask is resolved against the same table, keyed by a synthetic name so
  // its `extends` still reach the declared masks.
  const synthetic = "__inline__";
  const merged: MaskTable = { ...defMasks, [synthetic]: ref };
  const inline = resolveAllMasks(merged, groups).get(synthetic);
  return inline ?? OPEN_MASK;
}

/**
 * Layer mask ∩ constraint mask (§7).
 *
 * Intersection, not union: a constraint masked to `arms` inside a layer masked to
 * `legs` writes nothing.
 */
export function intersectMasks(a: ResolvedMask, b: ResolvedMask): ResolvedMask {
  if (a.unrestricted) return b;
  if (b.unrestricted) return a;

  const bones = new Set<string>();
  for (const bone of a.bones) {
    if (b.bones.has(bone)) bones.add(bone);
  }
  const morphs = new Set<string>();
  for (const morph of a.morphs) {
    if (b.morphs.has(morph)) morphs.add(morph);
  }
  const channels = new Map<string, number>();
  for (const [channel, weight] of a.channels) {
    channels.set(channel, weight * (b.channels.get(channel) ?? 1));
  }
  for (const [channel, weight] of b.channels) {
    if (!channels.has(channel)) channels.set(channel, weight * (a.channels.get(channel) ?? 1));
  }

  return { bones, morphs, channels, unrestricted: false };
}

/**
 * How much of a bone channel passes.
 *
 * `channels` is checked first and wins: a mask that names `spine.rotationQuat: 0.5`
 * means half a rotation, whatever the bone set says. With no channel entry the bone set
 * decides, at weight 1 or 0.
 */
export function maskBoneWeight(mask: ResolvedMask, bone: string, channel: string): number {
  const channelWeight = mask.channels.get(`${bone}.${channel}`);
  if (channelWeight != null) return channelWeight;
  if (mask.unrestricted) return 1;
  return mask.bones.has(bone) ? 1 : 0;
}

/** How much of a morph passes. The morph key is `mesh:target`. */
export function maskMorphWeight(mask: ResolvedMask, mesh: string, target: string): number {
  const key = `${mesh}:${target}`;
  const channelWeight = mask.channels.get(key);
  if (channelWeight != null) return channelWeight;
  if (mask.unrestricted) return 1;
  return mask.morphs.has(key) ? 1 : 0;
}

/** True when a bone passes the mask on at least one channel. */
export function maskIncludesBone(mask: ResolvedMask, bone: string): boolean {
  if (mask.unrestricted) return true;
  if (mask.bones.has(bone)) return true;
  for (const [channel, weight] of mask.channels) {
    if (weight > 0 && channel.startsWith(`${bone}.`)) return true;
  }
  return false;
}

/** True when a morph passes the mask. */
export function maskIncludesMorph(mask: ResolvedMask, mesh: string, target: string): boolean {
  if (mask.unrestricted) return true;
  if (mask.morphs.has(`${mesh}:${target}`)) return true;
  return (mask.channels.get(`${mesh}:${target}`) ?? 0) > 0;
}

export type { MaskDef };
