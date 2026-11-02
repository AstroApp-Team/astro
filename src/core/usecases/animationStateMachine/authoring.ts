/**
 * Editing a machine definition, as data.
 *
 * The Studio pane's job is to turn "this Theatre object is my idle" into a definition the
 * machine can load, and the machine's job is to stay the only thing that understands what a
 * definition *means*. So the transformation is a pure function over the definition object:
 * the pane calls it with the clip id it read from the project state, shows the result as
 * JSON, and nothing about layers, fades or entry states has to be duplicated in UI code.
 *
 * These functions are deliberately additive. A layer id that already exists is replaced
 * rather than appended, so pressing "add" twice edits the same layer instead of stacking two
 * clips that both override the same bones — which looks like a clip that got louder, not
 * like a mistake.
 */

import type { LayerDef, MachineDefinition } from "@core/models/animationStateMachine.ts";

/** The layer id a clip gets when the caller does not name one. */
export function clipLayerId(clipId: string): string {
  const slug = clipId
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return `clip.${slug === "" ? "unnamed" : slug}`;
}

export interface ClipLayerOptions {
  /** The clip the layer plays — a Theatre clip id, or any id the resolver serves. */
  clipId: string;
  /** Defaults to `clipLayerId(clipId)`. */
  layerId?: string;
  /** The state's id inside the layer. Defaults to `clip`. */
  stateId?: string;
  /** Fade duration used when entering the clip from anywhere. Defaults to 0.2 s. */
  fade?: number;
  /**
   * How the layer blends against the ones below it. `override` is right for a clip that
   * owns its bones; `additive` is right for a flourish. Defaults to `override`.
   */
  blend?: "override" | "additive";
  /** Priority; defaults to one above every existing layer, so the new clip wins ties. */
  priority?: number;
}

/**
 * A definition with one layer that plays `clipId` from its entry state, forever.
 *
 * The layer is a single state with no transitions: a clip layer that loops is the "play this
 * timeline" case, and a state machine is what you build *on top* of it by adding transitions
 * to the same layer afterwards. Emitting a transition from nowhere would be a guess about
 * which state should leave — so this leaves the layer honest and lets the user wire it.
 */
export function withClipLayer(
  definition: MachineDefinition,
  options: ClipLayerOptions,
): MachineDefinition {
  const clipId = options.clipId.trim();
  if (clipId === "") throw new Error("withClipLayer: a clip id is required");

  const layerId = options.layerId ?? clipLayerId(clipId);
  const stateId = options.stateId ?? "clip";
  const fade = options.fade ?? 0.2;
  const blend = options.blend ?? "override";
  const priority =
    options.priority ??
    definition.layers.reduce((max, layer) => Math.max(max, layer.priority ?? 0), 0) + 1;

  const layer: LayerDef = {
    id: layerId,
    priority,
    blend,
    weight: 1,
    entry: [{ to: stateId, fade }],
    states: [{ id: stateId, type: "clip", clip: clipId }],
    transitions: [],
    anyState: [],
  };

  const existing = definition.layers.findIndex((candidate) => candidate.id === layerId);
  const layers =
    existing >= 0
      ? definition.layers.map((candidate, index) => (index === existing ? layer : candidate))
      : [...definition.layers, layer];

  return { ...definition, layers };
}

/** The definition without `layerId`; an unknown id is a no-op, not an error. */
/**
 * The definition without `layerId`.
 *
 * Removing the **last** layer throws instead of returning `layers: []`: the loader requires at
 * least one layer, so the alternative is an override that `/machine` refuses to load and a
 * pane whose "remove" appears to do nothing. A caller that wants an empty machine should
 * start from a definition that has one.
 */
export function withoutLayer(definition: MachineDefinition, layerId: string): MachineDefinition {
  const layers = definition.layers.filter((layer) => layer.id !== layerId);
  if (layers.length === 0) {
    throw new Error("withoutLayer: a definition needs at least one layer");
  }
  return { ...definition, layers };
}

/** Whether `layerId` exists — the pane uses this to say "add" vs "replace". */
export function hasLayer(definition: MachineDefinition, layerId: string): boolean {
  return definition.layers.some((layer) => layer.id === layerId);
}
