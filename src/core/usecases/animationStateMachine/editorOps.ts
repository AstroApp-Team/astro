/**
 * Every edit the editor can make, as a pure function.
 *
 * The rule is §10's first invariant: `definition` is only ever replaced wholesale, by one
 * command, and each command here returns a new definition or throws. That makes undo a stack
 * of snapshots and makes the graph's drag code unable to touch the definition at all.
 *
 * Pure on purpose: no store, no React, no `Date.now`. The tests are the contract, and the
 * presentation layer only decides *when* to call one of these.
 */

import type {
  Blend1dState,
  Blend2dState,
  ClipState,
  Condition,
  ConstraintDef,
  DirectState,
  InputDef,
  LayerDef,
  ListenerDef,
  MarkerDef,
  MachineDefinition,
  StateDef,
  TimelineDef,
  TransitionDef,
} from "@core/models/animationStateMachine.ts";

/** `"<layer>/<state>"` — the graph's node key and the editor file's key (§4.4). */
export function stateKey(layer: string, state: string): string {
  return `${layer}/${state}`;
}

/** `"<layer>/__entry" | "…/__any" | "…/__exit"` — the three system pills (§6.C). */
export type SystemRole = "entry" | "any" | "exit";

export function systemKey(layer: string, role: SystemRole): string {
  return `${layer}/__${role}`;
}

export function findLayer(definition: MachineDefinition, layerId: string): LayerDef | null {
  return definition.layers.find((layer) => layer.id === layerId) ?? null;
}

export function findState(
  definition: MachineDefinition,
  layerId: string,
  stateId: string,
): StateDef | null {
  return findLayer(definition, layerId)?.states.find((state) => state.id === stateId) ?? null;
}

/** Apply `transform` to one layer, leaving every other part of the definition identical. */
function withLayer(
  definition: MachineDefinition,
  layerId: string,
  transform: (layer: LayerDef) => LayerDef,
): MachineDefinition {
  const index = definition.layers.findIndex((layer) => layer.id === layerId);
  if (index < 0) throw new Error(`editor: no layer "${layerId}"`);
  const layers = definition.layers.map((layer, at) => (at === index ? transform(layer) : layer));
  return { ...definition, layers };
}

function withStates(
  definition: MachineDefinition,
  layerId: string,
  states: StateDef[],
): MachineDefinition {
  return withLayer(definition, layerId, (layer) => ({ ...layer, states }));
}

function assertUniqueState(layer: LayerDef, stateId: string): void {
  if (layer.states.some((state) => state.id === stateId)) {
    throw new Error(`editor: layer "${layer.id}" already has a state "${stateId}"`);
  }
}

/** The defaults each kind needs to be a *valid* definition the moment it is created. */
function newState(kind: StateDef["type"], id: string): StateDef {
  switch (kind) {
    case "clip":
      return { id, type: "clip" };
    case "blend1d":
      return { id, type: "blend1d", input: "", children: [] } satisfies Blend1dState;
    case "blend2d":
      return { id, type: "blend2d", inputX: "", inputY: "", children: [] } satisfies Blend2dState;
    case "direct":
      return { id, type: "direct", entries: [] } satisfies DirectState;
    case "exit":
      return { id, type: "exit" };
  }
}

/**
 * A new clip state inherits an existing state's clip reference.
 *
 * A `clip` state with no `clip`, `timeline` or `morphCurve` is rejected by the loader, so the
 * naive default (`{ type: "clip" }`) makes Add State produce a definition that will not load —
 * and the editor's preview, which builds a machine from the draft, dies with it. Inheriting is
 * the smallest honest default: the new card plays something the layer already ships, and the
 * inspector is where it gets pointed somewhere else.
 */
function inheritReference(state: StateDef, layer: LayerDef): StateDef {
  if (state.type !== "clip") return state;
  for (const row of layer.states) {
    if (row.type !== "clip") continue;
    if (row.clip != null) return { ...state, clip: row.clip };
    if (row.timeline != null) return { ...state, timeline: row.timeline };
    if (row.morphCurve != null) return { ...state, morphCurve: row.morphCurve };
  }
  return state;
}

/** `state-1`, `state-2`, … — never a duplicate, so adding twice cannot collide. */
export function nextStateId(layer: LayerDef, prefix = "state"): string {
  for (let n = layer.states.length + 1; ; n += 1) {
    const candidate = `${prefix}-${n}`;
    if (!layer.states.some((state) => state.id === candidate)) return candidate;
  }
}

export function addState(
  definition: MachineDefinition,
  layerId: string,
  kind: StateDef["type"],
  id?: string,
): { definition: MachineDefinition; stateId: string } {
  const layer = findLayer(definition, layerId);
  if (layer == null) throw new Error(`editor: no layer "${layerId}"`);
  const stateId = id ?? nextStateId(layer);
  assertUniqueState(layer, stateId);
  return {
    definition: withStates(definition, layerId, [
      ...layer.states,
      inheritReference(newState(kind, stateId), layer),
    ]),
    stateId,
  };
}

/**
 * Remove a state **and everything that pointed at it**.
 *
 * Dangling transitions are the one thing the loader rejects that a single click could create,
 * so the command removes them instead of leaving a definition that will not load. The
 * inspector shows the counts before the click.
 */
export function removeState(
  definition: MachineDefinition,
  layerId: string,
  stateId: string,
): MachineDefinition {
  const layer = findLayer(definition, layerId);
  if (layer == null) throw new Error(`editor: no layer "${layerId}"`);
  const nextLayer: LayerDef = {
    ...layer,
    states: layer.states.filter((state) => state.id !== stateId),
    transitions: layer.transitions.filter(
      (transition) => transition.from !== stateId && transition.to !== stateId,
    ),
    anyState: layer.anyState.filter((transition) => transition.to !== stateId),
    entry: layer.entry.filter((row) => row.to !== stateId),
  };
  return withLayer(definition, layerId, () => nextLayer);
}

/** Inbound/outbound counts, for the delete confirmation §6.B requires. */
export function stateLinkCounts(
  layer: LayerDef,
  stateId: string,
): { inbound: number; outbound: number } {
  const inbound = [...layer.transitions, ...layer.anyState].filter(
    (transition) => transition.to === stateId,
  ).length;
  const outbound = layer.transitions.filter((transition) => transition.from === stateId).length;
  return { inbound, outbound };
}

/**
 * Rename a state and refactor every reference to it.
 *
 * Same rule as renaming an input (§5.B): a rename that leaves a dangling `from`/`to` is the
 * silent failure the validator exists to catch, so the editor never produces one.
 */
export function renameState(
  definition: MachineDefinition,
  layerId: string,
  from: string,
  to: string,
): MachineDefinition {
  const trimmed = to.trim();
  if (trimmed === "") throw new Error("editor: a state name cannot be empty");
  if (trimmed === from) return definition;
  const layer = findLayer(definition, layerId);
  if (layer == null) throw new Error(`editor: no layer "${layerId}"`);
  assertUniqueState(layer, trimmed);
  const retarget = <T extends { from?: string; to: string }>(row: T): T => ({
    ...row,
    ...(row.from === from ? { from: trimmed } : {}),
    ...(row.to === from ? { to: trimmed } : {}),
  });
  return withLayer(definition, layerId, (current) => ({
    ...current,
    states: current.states.map((state) => (state.id === from ? { ...state, id: trimmed } : state)),
    transitions: current.transitions.map(retarget),
    anyState: current.anyState.map(retarget),
    entry: current.entry.map((row) => (row.to === from ? { ...row, to: trimmed } : row)),
  }));
}

/** A shallow patch of one state — the inspector's write path for scalar fields. */
export function patchState(
  definition: MachineDefinition,
  layerId: string,
  stateId: string,
  patch: Partial<StateDef>,
): MachineDefinition {
  return withLayer(definition, layerId, (layer) => ({
    ...layer,
    states: layer.states.map((state) =>
      state.id === stateId ? ({ ...state, ...patch } as StateDef) : state,
    ),
  }));
}

export function addTransition(
  definition: MachineDefinition,
  layerId: string,
  from: string,
  to: string,
  options: { anyState?: boolean; duration?: number } = {},
): MachineDefinition {
  const layer = findLayer(definition, layerId);
  if (layer == null) throw new Error(`editor: no layer "${layerId}"`);
  if (!layer.states.some((state) => state.id === to)) {
    throw new Error(`editor: no state "${to}" in layer "${layerId}"`);
  }
  const transition: TransitionDef = { from, to };
  if (options.duration != null) transition.duration = options.duration;
  if (options.anyState === true) {
    return withLayer(definition, layerId, (current) => ({
      ...current,
      anyState: [...current.anyState, transition],
    }));
  }
  if (!layer.states.some((state) => state.id === from)) {
    throw new Error(`editor: no state "${from}" in layer "${layerId}"`);
  }
  return withLayer(definition, layerId, (current) => ({
    ...current,
    transitions: [...current.transitions, transition],
  }));
}

/** `index` is an index into the layer's `transitions` or `anyState` array, not a pair id. */
export function removeTransition(
  definition: MachineDefinition,
  layerId: string,
  index: number,
  anyState = false,
): MachineDefinition {
  return withLayer(definition, layerId, (layer) => {
    const rows = anyState ? layer.anyState : layer.transitions;
    if (index < 0 || index >= rows.length) {
      throw new Error(`editor: no transition #${index} in layer "${layerId}"`);
    }
    const next = rows.filter((_, at) => at !== index);
    return anyState ? { ...layer, anyState: next } : { ...layer, transitions: next };
  });
}

export function patchTransition(
  definition: MachineDefinition,
  layerId: string,
  index: number,
  patch: Partial<TransitionDef>,
  anyState = false,
): MachineDefinition {
  return withLayer(definition, layerId, (layer) => {
    const rows = anyState ? layer.anyState : layer.transitions;
    const next = rows.map((row, at) => (at === index ? { ...row, ...patch } : row));
    return anyState ? { ...layer, anyState: next } : { ...layer, transitions: next };
  });
}

export function patchLayer(
  definition: MachineDefinition,
  layerId: string,
  patch: Partial<LayerDef>,
): MachineDefinition {
  return withLayer(definition, layerId, (layer) => ({ ...layer, ...patch }));
}

export function addLayer(definition: MachineDefinition, id: string): MachineDefinition {
  if (definition.layers.some((layer) => layer.id === id)) {
    throw new Error(`editor: a layer "${id}" already exists`);
  }
  const priority = Math.max(0, ...definition.layers.map((layer) => layer.priority)) + 1;
  const layer: LayerDef = {
    id,
    priority,
    blend: "override",
    weight: 1,
    states: [{ id: "idle", type: "clip" }],
    transitions: [],
    anyState: [],
    entry: [{ to: "idle" }],
  };
  return { ...definition, layers: [...definition.layers, layer] };
}

/** The loader requires at least one layer, so removing the last one throws (§5.A ⚙). */
export function removeLayer(definition: MachineDefinition, layerId: string): MachineDefinition {
  if (definition.layers.length <= 1) {
    throw new Error("editor: a definition needs at least one layer");
  }
  return { ...definition, layers: definition.layers.filter((layer) => layer.id !== layerId) };
}

/** Reorder by rewriting priority: the tab order is priority descending (§6.A). */
export function moveLayer(
  definition: MachineDefinition,
  layerId: string,
  direction: -1 | 1,
): MachineDefinition {
  const ordered = [...definition.layers].sort((a, b) => b.priority - a.priority);
  const at = ordered.findIndex((layer) => layer.id === layerId);
  const to = at + direction;
  if (at < 0 || to < 0 || to >= ordered.length) return definition;
  const moved = ordered[at];
  const displaced = ordered[to];
  if (moved == null || displaced == null) return definition;
  return patchLayer(
    patchLayer(definition, moved.id, { priority: displaced.priority }),
    displaced.id,
    { priority: moved.priority },
  );
}

/**
 * Every place an input is named.
 *
 * The rename refactor (§5.B) is *this list*, rewritten — one command, and the confirmation
 * shows the count before it happens. Missing one of these is a dangling reference, which the
 * loader rejects, which is exactly what the UI must not produce.
 */
export function inputUsages(definition: MachineDefinition, name: string): string[] {
  const paths: string[] = [];
  const mentions = (value: unknown): boolean => value === name;
  const walkCondition = (condition: Condition | undefined, path: string): void => {
    if (condition == null) return;
    if ("all" in condition) {
      condition.all.forEach((child, index) => walkCondition(child, `${path}.all[${index}]`));
      return;
    }
    if ("any" in condition) {
      condition.any.forEach((child, index) => walkCondition(child, `${path}.any[${index}]`));
      return;
    }
    if ("not" in condition) {
      walkCondition(condition.not, `${path}.not`);
      return;
    }
    if (mentions(condition.input)) paths.push(`${path}.input`);
  };
  const binding = (value: unknown, path: string): void => {
    if (typeof value === "object" && value != null && "input" in value) {
      if (mentions((value as { input: unknown }).input)) paths.push(`${path}.input`);
    }
  };

  definition.layers.forEach((layer, layerIndex) => {
    const base = `layers[${layerIndex}]`;
    binding(layer.weight, `${base}.weight`);
    layer.entry.forEach((row, rowIndex) => walkCondition(row.when, `${base}.entry[${rowIndex}]`));
    layer.transitions.forEach((transition, index) => {
      walkCondition(transition.when, `${base}.transitions[${index}]`);
    });
    layer.anyState.forEach((transition, index) => {
      walkCondition(transition.when, `${base}.anyState[${index}]`);
    });
    layer.states.forEach((state, stateIndex) => {
      const statePath = `${base}.states[${stateIndex}]`;
      binding(state.speed, `${statePath}.speed`);
      if (state.type === "clip") {
        if (state.scrub != null && mentions(state.scrub.input)) {
          paths.push(`${statePath}.scrub.input`);
        }
      }
      if (state.type === "blend1d" && mentions(state.input)) paths.push(`${statePath}.input`);
      if (state.type === "blend2d") {
        if (mentions(state.inputX)) paths.push(`${statePath}.inputX`);
        if (mentions(state.inputY)) paths.push(`${statePath}.inputY`);
      }
      if (state.type === "direct") {
        state.entries.forEach((entry, entryIndex) => {
          if (mentions(entry.input)) paths.push(`${statePath}.entries[${entryIndex}].input`);
        });
      }
    });
  });
  /*
   * A constraint carries input names inside `kind` — a `Ref` is `{ input }` — and one more in
   * `exposeAs`. Walking the variant generically is deliberate: a new constraint kind would
   * otherwise be an input this list forgets, and a rename would leave a dangling reference.
   */
  const walkRefs = (value: unknown, path: string): void => {
    if (Array.isArray(value)) {
      value.forEach((child, index) => walkRefs(child, `${path}[${index}]`));
      return;
    }
    if (typeof value !== "object" || value == null) return;
    const record = value as Record<string, unknown>;
    if (typeof record["input"] === "string" && record["input"] === name) {
      paths.push(`${path}.input`);
    }
    for (const [key, child] of Object.entries(record)) {
      if (key === "input") continue;
      walkRefs(child, `${path}.${key}`);
    }
  };
  definition.constraints?.forEach((constraint, index) => {
    walkRefs(constraint.kind, `constraints[${index}].kind`);
    if (constraint.exposeAs === name) paths.push(`constraints[${index}].exposeAs`);
  });
  definition.listeners?.forEach((listener, index) => {
    listener.actions.forEach((action, actionIndex) => {
      if ("set" in action && mentions(action.set)) {
        paths.push(`listeners[${index}].actions[${actionIndex}].set`);
      }
      if ("fire" in action && mentions(action.fire)) {
        paths.push(`listeners[${index}].actions[${actionIndex}].fire`);
      }
      if ("toggle" in action && mentions(action.toggle)) {
        paths.push(`listeners[${index}].actions[${actionIndex}].toggle`);
      }
      if ("add" in action && mentions(action.add)) {
        paths.push(`listeners[${index}].actions[${actionIndex}].add`);
      }
      if ("setFromDrag" in action && mentions(action.setFromDrag)) {
        paths.push(`listeners[${index}].actions[${actionIndex}].setFromDrag`);
      }
    });
  });
  return paths;
}

export function renameInput(
  definition: MachineDefinition,
  from: string,
  to: string,
): MachineDefinition {
  const trimmed = to.trim();
  if (trimmed === "") throw new Error("editor: an input name cannot be empty");
  if (trimmed === from) return definition;
  if (definition.inputs.some((input) => input.name === trimmed)) {
    throw new Error(`editor: an input "${trimmed}" already exists`);
  }
  const walkCondition = (condition: Condition | undefined): Condition | undefined => {
    if (condition == null) return condition;
    if ("all" in condition)
      return { ...condition, all: condition.all.map(walkCondition) } as Condition;
    if ("any" in condition)
      return { ...condition, any: condition.any.map(walkCondition) } as Condition;
    if ("not" in condition) return { ...condition, not: walkCondition(condition.not) } as Condition;
    return condition.input === from ? { ...condition, input: trimmed } : condition;
  };
  const walkBinding = <T>(value: T): T => {
    if (typeof value !== "object" || value == null || !("input" in value)) return value;
    const record = value as { input: unknown };
    return record.input === from ? ({ ...record, input: trimmed } as T) : value;
  };

  const layers = definition.layers.map((layer) => ({
    ...layer,
    weight: walkBinding(layer.weight),
    entry: layer.entry.map((row) => {
      const when = walkCondition(row.when);
      return when == null ? { ...row } : { ...row, when };
    }),
    transitions: layer.transitions.map((row) => {
      const when = walkCondition(row.when);
      return when == null ? { ...row } : { ...row, when };
    }),
    anyState: layer.anyState.map((row) => {
      const when = walkCondition(row.when);
      return when == null ? { ...row } : { ...row, when };
    }),
    states: layer.states.map((state) => {
      const next = { ...state, speed: walkBinding(state.speed) } as StateDef;
      if (next.type === "clip" && next.scrub != null) {
        next.scrub = { ...next.scrub, ...(next.scrub.input === from ? { input: trimmed } : {}) };
      }
      if (next.type === "blend1d" && next.input === from) next.input = trimmed;
      if (next.type === "blend2d") {
        if (next.inputX === from) next.inputX = trimmed;
        if (next.inputY === from) next.inputY = trimmed;
      }
      if (next.type === "direct") {
        next.entries = next.entries.map((entry) =>
          entry.input === from ? { ...entry, input: trimmed } : entry,
        );
      }
      return next;
    }),
  }));
  const inputs = definition.inputs.map((input) =>
    input.name === from ? ({ ...input, name: trimmed } as InputDef) : input,
  );
  const renameRefs = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(renameRefs);
    if (typeof value !== "object" || value == null) return value;
    const next: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      next[key] = key === "input" && child === from ? trimmed : renameRefs(child);
    }
    return next;
  };
  const constraints = definition.constraints?.map((constraint) => ({
    ...constraint,
    kind: renameRefs(constraint.kind) as ConstraintDef["kind"],
    ...(constraint.exposeAs === from ? { exposeAs: trimmed } : {}),
  }));
  const listeners = definition.listeners?.map((listener) => ({
    ...listener,
    actions: listener.actions.map((action) => {
      if ("set" in action && action.set === from) return { ...action, set: trimmed };
      if ("fire" in action && action.fire === from) return { ...action, fire: trimmed };
      if ("toggle" in action && action.toggle === from) return { ...action, toggle: trimmed };
      if ("add" in action && action.add === from) return { ...action, add: trimmed };
      if ("setFromDrag" in action && action.setFromDrag === from) {
        return { ...action, setFromDrag: trimmed };
      }
      return action;
    }),
  }));
  return {
    ...definition,
    inputs,
    layers,
    ...(constraints == null ? {} : { constraints }),
    ...(listeners == null ? {} : { listeners }),
  };
}

const INPUT_DEFAULTS: Record<InputDef["kind"], InputDef> = {
  number: { name: "number", kind: "number", default: 0, min: 0, max: 1 },
  boolean: { name: "boolean", kind: "boolean", default: false },
  trigger: { name: "trigger", kind: "trigger" },
};

export function addInput(
  definition: MachineDefinition,
  kind: InputDef["kind"],
): { definition: MachineDefinition; name: string } {
  const base = INPUT_DEFAULTS[kind].name;
  let name = base;
  for (let n = 2; definition.inputs.some((input) => input.name === name); n += 1) {
    name = `${base}${n}`;
  }
  const input = { ...INPUT_DEFAULTS[kind], name } as InputDef;
  return { definition: { ...definition, inputs: [...definition.inputs, input] }, name };
}

export function removeInput(definition: MachineDefinition, name: string): MachineDefinition {
  return { ...definition, inputs: definition.inputs.filter((input) => input.name !== name) };
}

export function patchInput(
  definition: MachineDefinition,
  name: string,
  patch: Partial<InputDef>,
): MachineDefinition {
  const inputs = definition.inputs.map((input) =>
    input.name === name ? ({ ...input, ...patch } as InputDef) : input,
  );
  return { ...definition, inputs };
}

export function addListener(
  definition: MachineDefinition,
  listener: ListenerDef,
): MachineDefinition {
  return { ...definition, listeners: [...(definition.listeners ?? []), listener] };
}

export function patchListener(
  definition: MachineDefinition,
  index: number,
  patch: Partial<ListenerDef>,
): MachineDefinition {
  const listeners = (definition.listeners ?? []).map((listener, at) =>
    at === index ? { ...listener, ...patch } : listener,
  );
  return { ...definition, listeners };
}

export function removeListener(definition: MachineDefinition, index: number): MachineDefinition {
  const listeners = (definition.listeners ?? []).filter((_, at) => at !== index);
  return { ...definition, listeners };
}

/**
 * Where a state's markers actually live.
 *
 * The runtime reads `TimelineDef.markers[]` when the state references a standalone timeline
 * and the state's own `markers[]` otherwise (§7.C). Writing to the wrong one produces a pin
 * nobody plays, so the timeline pane asks this function and the header names the owner.
 */
export function markerOwner(
  definition: MachineDefinition,
  layerId: string,
  stateId: string,
): { kind: "timeline"; timelineId: string; duration: number } | { kind: "state" } | null {
  const state = findState(definition, layerId, stateId);
  if (state == null) return null;
  if (state.type !== "clip" || state.timeline == null) return { kind: "state" };
  const timeline: TimelineDef | undefined = definition.timelines?.find(
    (row) => row.id === state.timeline,
  );
  if (timeline == null) return { kind: "state" };
  return { kind: "timeline", timelineId: timeline.id, duration: timeline.duration };
}

export function withMarkers(
  definition: MachineDefinition,
  layerId: string,
  stateId: string,
  markers: MarkerDef[],
): MachineDefinition {
  const owner = markerOwner(definition, layerId, stateId);
  if (owner == null) throw new Error(`editor: no state "${stateId}" in layer "${layerId}"`);
  if (owner.kind === "timeline") {
    const timelines = (definition.timelines ?? []).map((timeline) =>
      timeline.id === owner.timelineId ? { ...timeline, markers } : timeline,
    );
    return { ...definition, timelines };
  }
  return patchState(definition, layerId, stateId, { markers });
}

/** A definition with every `undefined` dropped, so a save is byte-stable. */
export function compactDefinition(definition: MachineDefinition): MachineDefinition {
  const drop = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(drop);
    if (value == null || typeof value !== "object") return value;
    const out: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      if (entry === undefined) continue;
      out[key] = drop(entry);
    }
    return out;
  };
  return drop(definition) as MachineDefinition;
}

/** Type guard for the graph: a state that has a clip id to draw in its card body. */
export function clipIdOf(state: StateDef): string | null {
  if (state.type !== "clip") return null;
  return (state as ClipState).clip ?? (state as ClipState).timeline ?? null;
}
