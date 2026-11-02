/**
 * The one place the demo page and the Studio pane meet.
 *
 * Both sides need the same three facts — which resolver to read clips from, which definition
 * is live, and what the Theatre object keys map onto — and if either side kept its own copy
 * the pane would bake a clip the page could not play. Module scope, exported, no store: the
 * values cannot change while the app runs (a Save reloads the page).
 */

import type { AssetResolver } from "@core/interfaces/animationAssets.ts";
import { staticResolver } from "@core/interfaces/animationAssets.ts";
import type { MachineDefinition } from "@core/models/animationStateMachine.ts";
import {
  combinedResolver,
  theatreAssetResolver,
} from "@infra/theatre/animationStateMachine/theatreAssetResolver.ts";
import {
  loadDefinition,
  loadShippedDefinition,
} from "@infra/theatre/animationStateMachine/machineDefinitionStore.ts";
import { IDLE_CLIP, WAVE_CLIP } from "@presentation/canvas/machine/demoClips.ts";

/**
 * Theatre object key → the bone the demo rig writes to.
 *
 * The demo head has three bones (`root`, `hand`, `head`); the production sheets animate
 * whole objects. Mapping every object onto `head` is what makes "rig a timeline in the
 * Studio, press play here" visible on this bench. A real rig passes its own map — nothing in
 * the machine or the baker depends on this table.
 */
export const THEATRE_BONE_MAP: Record<string, string> = {
  "Float Sphere": "head",
  SheetBall: "head",
  "Surface Plane": "head",
  Astro: "head",
  "Sting-Core": "head",
};

/** `localStorage` key holding a definition edited in the Studio, until it is saved to disk. */
export const DEFINITION_OVERRIDE_KEY = "astro.machine.definition";

/** Static clips for what Theatre cannot carry (morph curves), then the project state. */
export function machineResolver(): AssetResolver {
  return combinedResolver(
    staticResolver([IDLE_CLIP, WAVE_CLIP]),
    theatreAssetResolver({ boneMap: THEATRE_BONE_MAP }),
  );
}

/** A definition edited in the Studio, or `null` when the shipped one is live. */
export function readDefinitionOverride(): MachineDefinition | null {
  if (typeof localStorage === "undefined") return null;
  const raw = localStorage.getItem(DEFINITION_OVERRIDE_KEY);
  if (raw == null) return null;
  try {
    return loadDefinition(JSON.parse(raw) as unknown);
  } catch (error) {
    /* A broken override must not take the page down with it — the shipped definition runs.
       It is logged, because "my edit did nothing" is otherwise indistinguishable from a save
       that never landed, and the validator's message names the JSON path. */
    console.warn("Machine definition override rejected:", error);
    return null;
  }
}

/** Persist a definition for the next `/machine` load. Dev-only by construction. */
export function writeDefinitionOverride(definition: MachineDefinition): void {
  if (typeof localStorage === "undefined") return;
  localStorage.setItem(DEFINITION_OVERRIDE_KEY, JSON.stringify(definition, null, 2));
}

export function clearDefinitionOverride(): void {
  if (typeof localStorage === "undefined") return;
  localStorage.removeItem(DEFINITION_OVERRIDE_KEY);
}

/** What `/machine` should load: the Studio's edit if there is one, else the shipped file. */
export function loadMachineDefinition(): MachineDefinition {
  return readDefinitionOverride() ?? loadShippedDefinition("machine-demo");
}
