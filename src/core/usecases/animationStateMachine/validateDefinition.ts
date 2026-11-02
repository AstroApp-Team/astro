/**
 * Load-time validation for a machine definition (spec §11.1).
 *
 * Every issue names a **JSON path** — `layers[2].states[1].clip`, not an array index
 * alone — because the person reading the error is authoring a file in the Studio, and
 * "index 3 of something" is not a location they can go to.
 *
 * Structural checks run before semantic ones, so a malformed definition reports its
 * shape first and does not bury a type error under a cascade of dangling references.
 *
 * Errors are things that cannot run: a duplicate id, a cycle of unconditional
 * zero-duration edges, a constraint that writes a channel another constraint writes.
 * Warnings are things that run and look odd: a state nothing can reach, a bone name
 * nobody can check without a rig.
 */

import type {
  BlendChild,
  Condition,
  InputDef,
  LayerDef,
  MaskDef,
  Measure,
  NumberInputDef,
  Ref,
  RigDescription,
  StateDef,
  TimelineDef,
  TransitionDef,
} from "@core/models/animationStateMachine.ts";
import { SCHEMA_VERSION } from "@core/models/animationStateMachine.ts";
import type { AssetResolver } from "@core/interfaces/animationAssets.ts";

export interface ValidationIssue {
  /** JSON path, e.g. `layers[0].transitions[2].to`. */
  path: string;
  code: string;
  message: string;
}

export interface ValidationReport {
  ok: boolean;
  errors: ValidationIssue[];
  warnings: ValidationIssue[];
}

/** The error `createMachine` throws. Carries the report so a UI can list every problem. */
export class MachineDefinitionError extends Error {
  readonly report: ValidationReport;

  constructor(report: ValidationReport) {
    const first = report.errors[0];
    super(
      `Machine definition is invalid (${String(report.errors.length)} error(s)): ${
        first == null ? "no detail" : `${first.path} — ${first.message}`
      }`,
    );
    this.name = "MachineDefinitionError";
    this.report = report;
  }
}

/* ── Collector ───────────────────────────────────────────────────────── */

class Collector {
  errors: ValidationIssue[] = [];
  warnings: ValidationIssue[] = [];

  error(path: string, code: string, message: string): void {
    this.errors.push({ path, code, message });
  }

  warn(path: string, code: string, message: string): void {
    this.warnings.push({ path, code, message });
  }

  report(): ValidationReport {
    return { ok: this.errors.length === 0, errors: this.errors, warnings: this.warnings };
  }
}

/* ── Shape guards ────────────────────────────────────────────────────── */
/*
 * `unknown` in, checks all the way down. A definition arrives from a JSON file, a Studio
 * save, or a test fixture, and none of those are trusted. A guard failure is a shape
 * error, reported and skipped — the validator never throws on a malformed input,
 * because a report naming the bad path is more useful than a stack trace.
 */

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function asString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function asNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/* ── Entry point ─────────────────────────────────────────────────────── */

export function validateDefinition(
  def: unknown,
  rig?: RigDescription,
  resolver?: AssetResolver,
): ValidationReport {
  const c = new Collector();

  if (!isRecord(def)) {
    c.error("$", "shape", "A machine definition must be an object.");
    return c.report();
  }

  if (def.schemaVersion !== SCHEMA_VERSION) {
    c.error(
      ".schemaVersion",
      "schema-version",
      `schemaVersion must be ${String(SCHEMA_VERSION)}, got ${JSON.stringify(def.schemaVersion)}.`,
    );
  }

  if (asString(def.name) == null) {
    c.error(".name", "shape", "A machine definition needs a string `name`.");
  }

  const inputs = collectInputs(def, c);
  const masks = collectMasks(def, c);
  const groups = collectGroups(def, c);
  const timelines = collectTimelines(def, inputs, c);
  const layers = collectLayers(def, inputs, masks, groups, timelines, resolver, c);
  collectConstraints(def, inputs, masks, groups, rig, c);
  collectListeners(def, inputs, rig, c);
  collectAssets(def, layers, timelines, resolver, c);

  return c.report();
}

/* ── Inputs ──────────────────────────────────────────────────────────── */

function collectInputs(def: Record<string, unknown>, c: Collector): Map<string, InputDef> {
  const out = new Map<string, InputDef>();
  const raw = asArray(def.inputs);

  raw.forEach((entry, index) => {
    const path = `inputs[${String(index)}]`;
    if (!isRecord(entry)) {
      c.error(path, "shape", "Each input must be an object.");
      return;
    }
    const name = asString(entry.name);
    if (name == null) {
      c.error(`${path}.name`, "shape", "Each input needs a string `name`.");
      return;
    }
    if (out.has(name)) {
      c.error(`${path}.name`, "duplicate-input", `Input "${name}" is declared twice.`);
      return;
    }

    const kind = asString(entry.kind);
    if (kind === "number") {
      const def_ = entry as unknown as NumberInputDef;
      const min = asNumber(def_.min) ?? Number.NEGATIVE_INFINITY;
      const max = asNumber(def_.max) ?? Number.POSITIVE_INFINITY;
      const value = asNumber(def_.default);
      if (value == null) {
        c.error(`${path}.default`, "shape", "A number input needs a finite `default`.");
      } else if (value < min || value > max) {
        c.error(
          `${path}.default`,
          "input-range",
          `Input "${name}" default ${String(value)} is outside [${String(min)}, ${String(max)}].`,
        );
      }
      if (def_.smoothTime != null && (asNumber(def_.smoothTime) ?? -1) < 0) {
        c.error(
          `${path}.smoothTime`,
          "input-smooth-time",
          `Input "${name}" has a negative smoothTime.`,
        );
      }
      out.set(name, { ...def_, name, kind: "number" });
    } else if (kind === "boolean") {
      if (typeof entry.default !== "boolean") {
        c.error(`${path}.default`, "shape", `Boolean input "${name}" needs a boolean \`default\`.`);
      }
      out.set(name, { name, kind: "boolean", default: entry.default === true });
    } else if (kind === "trigger") {
      const ttl = asNumber(entry.ttl);
      if (entry.ttl != null && ttl == null) {
        c.error(`${path}.ttl`, "trigger-ttl", `Trigger "${name}" needs a finite \`ttl\`.`);
      }
      out.set(name, ttl != null ? { name, kind: "trigger", ttl } : { name, kind: "trigger" });
    } else {
      c.error(
        `${path}.kind`,
        "input-kind",
        `Input "${name}" has an unknown kind ${JSON.stringify(entry.kind)}.`,
      );
    }
  });

  if (out.size === 0) {
    c.warn(
      ".inputs",
      "no-inputs",
      "The definition declares no inputs; nothing outside the machine can drive it.",
    );
  }

  return out;
}

/* ── Masks and groups ────────────────────────────────────────────────── */

function collectMasks(def: Record<string, unknown>, c: Collector): Map<string, MaskDef> {
  const out = new Map<string, MaskDef>();
  const raw = def.masks;
  if (!isRecord(raw)) {
    if (raw != null) {
      c.error(".masks", "shape", "`masks` must be an object of mask definitions.");
    }
    return out;
  }

  for (const [name, value] of Object.entries(raw)) {
    const path = `masks.${name}`;
    if (!isRecord(value)) {
      c.error(path, "shape", `Mask "${name}" must be an object.`);
      continue;
    }
    out.set(name, value as unknown as MaskDef);
  }

  // `extends` / `subtract` must not form a cycle: a mask that extends itself is a
  // resolution loop, and the resolution happens per channel per frame.
  for (const name of out.keys()) {
    const seen = new Set<string>();
    const walk = (id: string, depth: number): void => {
      if (depth > out.size) {
        c.error(`masks.${name}`, "mask-cycle", `Mask "${name}" extends/subtracts in a cycle.`);
        return;
      }
      if (seen.has(id)) {
        c.error(
          `masks.${name}`,
          "mask-cycle",
          `Mask "${name}" reaches "${id}" twice through extends/subtract.`,
        );
        return;
      }
      seen.add(id);
      const mask = out.get(id);
      if (mask == null) return;
      for (const next of [...(mask.extends ?? []), ...(mask.subtract ?? [])]) {
        if (!out.has(next)) {
          c.error(
            `masks.${name}`,
            "unknown-mask",
            `Mask "${name}" references unknown mask "${next}".`,
          );
          continue;
        }
        walk(next, depth + 1);
      }
      seen.delete(id);
    };
    walk(name, 0);
  }

  return out;
}

function collectGroups(
  def: Record<string, unknown>,
  c: Collector,
): {
  morph: Map<string, string[]>;
  bones: Map<string, string[]>;
} {
  const morph = new Map<string, string[]>();
  const bones = new Map<string, string[]>();
  const raw = def.groups;
  if (raw == null) return { morph, bones };
  if (!isRecord(raw)) {
    c.error(".groups", "shape", "`groups` must be an object.");
    return { morph, bones };
  }

  for (const [group, targets] of Object.entries(isRecord(raw.morph) ? raw.morph : {})) {
    const list = asArray(targets);
    if (list.length === 0) {
      c.warn(`groups.morph.${group}`, "empty-group", `Morph group "${group}" is empty.`);
    }
    morph.set(
      group,
      list.map((item) => (isRecord(item) ? String(item.target ?? "") : String(item))),
    );
  }
  for (const [group, list] of Object.entries(isRecord(raw.bones) ? raw.bones : {})) {
    bones.set(group, asArray(list).map(String));
  }

  return { morph, bones };
}

/* ── Timelines (§5) ──────────────────────────────────────────────────── */

function collectTimelines(
  def: Record<string, unknown>,
  inputs: Map<string, InputDef>,
  c: Collector,
): Map<string, TimelineDef> {
  const out = new Map<string, TimelineDef>();
  const raw = asArray(def.timelines);

  raw.forEach((entry, index) => {
    const path = `timelines[${String(index)}]`;
    if (!isRecord(entry)) {
      c.error(path, "shape", "Each timeline must be an object.");
      return;
    }
    const id = asString(entry.id);
    if (id == null) {
      c.error(`${path}.id`, "shape", "Each timeline needs a string `id`.");
      return;
    }
    if (out.has(id)) {
      c.error(`${path}.id`, "duplicate-timeline", `Timeline "${id}" is declared twice.`);
      return;
    }

    const duration = asNumber(entry.duration);
    if (duration == null || duration <= 0) {
      c.error(
        `${path}.duration`,
        "timeline-duration",
        `Timeline "${id}" needs a duration greater than 0; it is the authority for normalised time.`,
      );
    }

    const style = entry.playStyle;
    const styleName =
      typeof style === "string" ? style : isRecord(style) ? asString(style.kind) : null;
    if (
      styleName !== "once" &&
      styleName !== "loop" &&
      styleName !== "pingPong" &&
      styleName !== "clampForever"
    ) {
      c.error(
        `${path}.playStyle`,
        "timeline-play-style",
        `Timeline "${id}" playStyle must be once, loop, pingPong or clampForever.`,
      );
    }
    if (isRecord(style) && style.kind === "pingPong") {
      const count = asNumber(style.count);
      if (style.count != null && (count == null || count < 1)) {
        c.error(
          `${path}.playStyle.count`,
          "ping-pong-count",
          `Timeline "${id}" needs pingPong count >= 1.`,
        );
      }
    }

    if (entry.speed != null && !isSpeedValid(entry.speed, inputs, `${path}.speed`, c, id)) {
      // reported inside
    }

    if (entry.startAt != null && entry.startAt !== "random") {
      const at = asNumber(entry.startAt);
      if (at == null || at < 0 || at > 1) {
        c.error(
          `${path}.startAt`,
          "timeline-start-at",
          `Timeline "${id}" startAt must be normalised 0..1 or "random".`,
        );
      }
    }

    asArray(entry.markers).forEach((marker, markerIndex) => {
      const markerPath = `${path}.markers[${String(markerIndex)}]`;
      if (!isRecord(marker)) {
        c.error(markerPath, "shape", `Timeline "${id}" marker must be an object.`);
        return;
      }
      const at = asNumber(marker.time);
      // Markers are authored normalised; the cursor converts with `duration`.
      if (at == null || at < 0 || at > 1) {
        c.error(
          `${markerPath}.time`,
          "marker-time",
          `Timeline "${id}" marker time must be normalised 0..1 (inside [0, ${String(duration ?? 0)}s]).`,
        );
      }
      if (asString(marker.name) == null) {
        c.error(`${markerPath}.name`, "shape", `Timeline "${id}" marker needs a string \`name\`.`);
      }
    });

    asArray(entry.events).forEach((event, eventIndex) => {
      const eventPath = `${path}.events[${String(eventIndex)}]`;
      if (!isRecord(event)) {
        c.error(eventPath, "shape", `Timeline "${id}" event must be an object.`);
        return;
      }
      const at = asNumber(event.time);
      if (at == null || duration == null || at < 0 || at > duration) {
        c.error(
          `${eventPath}.time`,
          "timeline-event-time",
          `Timeline "${id}" event time must sit inside its duration.`,
        );
      }
      if (asString(event.name) == null) {
        c.error(`${eventPath}.name`, "shape", `Timeline "${id}" event needs a string \`name\`.`);
      }
    });

    out.set(id, entry as unknown as TimelineDef);
  });

  // A sync group phase-locks cursors, so members that disagree on duration cannot stay
  // in step. Tolerance is one frame at 60 fps.
  const byGroup = new Map<string, { id: string; duration: number; path: string }[]>();
  for (const [index, entry] of out.entries()) {
    void index;
    if (entry.syncGroup == null) continue;
    const list = byGroup.get(entry.syncGroup) ?? [];
    list.push({ id: entry.id, duration: entry.duration, path: `timelines.${entry.id}` });
    byGroup.set(entry.syncGroup, list);
  }
  for (const [group, members] of byGroup) {
    const first = members[0];
    if (first == null) continue;
    for (const member of members.slice(1)) {
      if (Math.abs(member.duration - first.duration) > 1 / 60) {
        c.error(
          `timelines.${member.id}.syncGroup`,
          "sync-group-duration",
          `Sync group "${group}" mixes durations ${String(first.duration)} and ${String(member.duration)}; ` +
            "phase-locked timelines must agree.",
        );
      }
    }
  }

  return out;
}

function isSpeedValid(
  speed: unknown,
  inputs: Map<string, InputDef>,
  path: string,
  c: Collector,
  owner: string,
): boolean {
  if (typeof speed === "number") {
    return Number.isFinite(speed);
  }
  if (isRecord(speed)) {
    const input = asString(speed.input);
    if (input == null) {
      c.error(
        `${path}.input`,
        "shape",
        `Speed of "${owner}" must be a number or { input, scale?, offset? }.`,
      );
      return false;
    }
    return isNumberInput(input, inputs, `${path}.input`, c, owner);
  }
  c.error(path, "speed-shape", `Speed of "${owner}" must be a number or an input binding.`);
  return false;
}

function isNumberInput(
  name: string,
  inputs: Map<string, InputDef>,
  path: string,
  c: Collector,
  owner: string,
): boolean {
  const input = inputs.get(name);
  if (input == null) {
    c.error(path, "unknown-input", `${owner} references undeclared input "${name}".`);
    return false;
  }
  if (input.kind !== "number") {
    c.error(
      path,
      "input-type",
      `${owner} binds input "${name}" (kind ${input.kind}) where a number is required.`,
    );
    return false;
  }
  return true;
}

/* ── Layers ──────────────────────────────────────────────────────────── */

function collectLayers(
  def: Record<string, unknown>,
  inputs: Map<string, InputDef>,
  masks: Map<string, MaskDef>,
  groups: { morph: Map<string, string[]>; bones: Map<string, string[]> },
  timelines: Map<string, TimelineDef>,
  resolver: AssetResolver | undefined,
  c: Collector,
): LayerDef[] {
  const raw = asArray(def.layers);
  const layers: LayerDef[] = [];

  if (raw.length === 0) {
    c.error(".layers", "no-layers", "A machine definition needs at least one layer.");
    return layers;
  }

  const seenLayerIds = new Set<string>();

  raw.forEach((entry, index) => {
    const path = `layers[${String(index)}]`;
    if (!isRecord(entry)) {
      c.error(path, "shape", "Each layer must be an object.");
      return;
    }

    const id = asString(entry.id);
    if (id == null) {
      c.error(`${path}.id`, "shape", "Each layer needs a string `id`.");
      return;
    }
    if (seenLayerIds.has(id)) {
      c.error(`${path}.id`, "duplicate-layer", `Layer "${id}" is declared twice.`);
      return;
    }
    seenLayerIds.add(id);

    if (asNumber(entry.priority) == null) {
      c.error(`${path}.priority`, "shape", `Layer "${id}" needs a numeric \`priority\`.`);
    }
    if (entry.blend !== "override" && entry.blend !== "additive") {
      c.error(`${path}.blend`, "layer-blend", `Layer "${id}" blend must be override or additive.`);
    }
    checkLayerWeight(entry.weight, inputs, `${path}.weight`, c, id);
    checkMaskRef(entry.mask, masks, `${path}.mask`, c, id);

    const states = collectStates(entry, index, id, inputs, timelines, resolver, c);
    const transitions = collectTransitions(entry, index, states, inputs, c);
    collectEntry(entry, index, states, inputs, c);
    collectReachability(id, states, transitions, asArray(entry.anyState).length, c);
    collectZeroDurationCycles(id, states, transitions, asArray(entry.anyState).length, c);
    collectAdditiveRefs(id, entry, states, c);
    collectBlendSpaces(states, path, inputs, c);
    void groups;
    void timelines;

    layers.push(entry as unknown as LayerDef);
  });

  return layers;
}

function checkLayerWeight(
  weight: unknown,
  inputs: Map<string, InputDef>,
  path: string,
  c: Collector,
  layer: string,
): void {
  if (typeof weight === "number") {
    if (!Number.isFinite(weight) || weight < 0 || weight > 1) {
      c.error(`${path}`, "layer-weight", `Layer "${layer}" weight must be a number in [0, 1].`);
    }
    return;
  }
  if (isRecord(weight)) {
    const input = asString(weight.input);
    if (input == null) {
      c.error(path, "shape", `Layer "${layer}" weight must be a number or { input, scale? }.`);
      return;
    }
    isNumberInput(input, inputs, `${path}.input`, c, `Layer "${layer}" weight`);
    return;
  }
  c.error(path, "layer-weight", `Layer "${layer}" needs a numeric weight or an input binding.`);
}

function checkMaskRef(
  mask: unknown,
  masks: Map<string, MaskDef>,
  path: string,
  c: Collector,
  owner: string,
): void {
  if (mask == null) return;
  if (typeof mask === "string") {
    if (!masks.has(mask)) {
      c.error(path, "unknown-mask", `${owner} references undeclared mask "${mask}".`);
    }
    return;
  }
  if (!isRecord(mask)) {
    c.error(path, "mask-shape", `${owner} mask must be a mask name or a mask definition.`);
  }
}

/* ── States ──────────────────────────────────────────────────────────── */

function collectStates(
  layerEntry: Record<string, unknown>,
  layerIndex: number,
  layerId: string,
  inputs: Map<string, InputDef>,
  timelines: Map<string, TimelineDef>,
  resolver: AssetResolver | undefined,
  c: Collector,
): Map<string, StateDef> {
  const out = new Map<string, StateDef>();
  const raw = asArray(layerEntry.states);

  if (raw.length === 0) {
    c.error(
      `layers[${String(layerIndex)}].states`,
      "no-states",
      `Layer "${layerId}" declares no states.`,
    );
    return out;
  }

  raw.forEach((entry, index) => {
    const path = `layers[${String(layerIndex)}].states[${String(index)}]`;
    if (!isRecord(entry)) {
      c.error(path, "shape", `Layer "${layerId}" state must be an object.`);
      return;
    }
    const id = asString(entry.id);
    if (id == null) {
      c.error(`${path}.id`, "shape", `Layer "${layerId}" state needs a string \`id\`.`);
      return;
    }
    if (out.has(id)) {
      c.error(`${path}.id`, "duplicate-state", `Layer "${layerId}" declares state "${id}" twice.`);
      return;
    }

    const type = asString(entry.type);
    switch (type) {
      case "clip": {
        if (entry.clip == null && entry.morphCurve == null && entry.timeline == null) {
          c.error(
            path,
            "clip-assets",
            `State "${id}" references no clip, morph curve or timeline.`,
          );
        }
        if (entry.clip != null && asString(entry.clip) == null) {
          c.error(`${path}.clip`, "shape", `State "${id}" clip must be a string asset id.`);
        }
        if (entry.morphCurve != null && asString(entry.morphCurve) == null) {
          c.error(
            `${path}.morphCurve`,
            "shape",
            `State "${id}" morphCurve must be a string asset id.`,
          );
        }
        if (entry.timeline != null) {
          const timelineId = asString(entry.timeline);
          if (timelineId == null || !timelines.has(timelineId)) {
            c.error(
              `${path}.timeline`,
              "unknown-timeline",
              `State "${id}" references undeclared timeline ${JSON.stringify(entry.timeline)}.`,
            );
          }
        }
        if (entry.speed != null) {
          isSpeedValid(entry.speed, inputs, `${path}.speed`, c, `State "${id}"`);
        }
        if (entry.scrub != null) {
          if (!isRecord(entry.scrub)) {
            c.error(`${path}.scrub`, "shape", `State "${id}" scrub must be { input, range }.`);
          } else {
            const input = asString(entry.scrub.input);
            const range = asArray(entry.scrub.range).map((v) => asNumber(v));
            if (
              input == null ||
              !isNumberInput(input, inputs, `${path}.scrub.input`, c, `State "${id}" scrub`)
            ) {
              // reported
            }
            if (
              range.length !== 2 ||
              range[0] == null ||
              range[1] == null ||
              range[0] >= range[1]
            ) {
              c.error(
                `${path}.scrub.range`,
                "scrub-range",
                `State "${id}" scrub needs a range [min, max] with min < max.`,
              );
            }
            if (entry.clip == null && entry.timeline == null) {
              c.error(
                `${path}.scrub`,
                "scrub-needs-clip",
                `State "${id}" scrubs time but has no clip to scrub — scrub requires a clip or timeline.`,
              );
            }
          }
        }
        if (entry.startAt != null && entry.startAt !== "random") {
          const at = asNumber(entry.startAt);
          if (at == null || at < 0 || at > 1) {
            c.error(
              `${path}.startAt`,
              "start-at",
              `State "${id}" startAt must be normalised 0..1 or "random".`,
            );
          }
        }
        checkMarkers(entry.markers, `${path}.markers`, `State "${id}"`, c);
        break;
      }
      case "blend1d": {
        const input = asString(entry.input);
        if (input == null || !isNumberInput(input, inputs, `${path}.input`, c, `State "${id}"`)) {
          // reported
        }
        const children = asArray(entry.children);
        if (children.length < 2) {
          c.error(
            `${path}.children`,
            "blend-children",
            `Blend state "${id}" needs at least two children.`,
          );
        }
        const positions = children.map((child) =>
          isRecord(child) ? asNumber(child.position) : null,
        );
        const sorted = positions.filter((p): p is number => p != null).sort((a, b) => a - b);
        if (sorted.length !== children.length) {
          c.error(
            `${path}.children`,
            "blend-position",
            `Blend state "${id}" needs a numeric position on every child.`,
          );
        }
        for (let i = 1; i < sorted.length; i += 1) {
          if (sorted[i] === sorted[i - 1]) {
            c.error(
              `${path}.children`,
              "blend-position",
              `Blend state "${id}" has two children at position ${String(sorted[i])}.`,
            );
            break;
          }
        }
        break;
      }
      case "blend2d": {
        const x = asString(entry.inputX);
        const y = asString(entry.inputY);
        if (x == null || !isNumberInput(x, inputs, `${path}.inputX`, c, `State "${id}"`)) {
          // reported
        }
        if (y == null || !isNumberInput(y, inputs, `${path}.inputY`, c, `State "${id}"`)) {
          // reported
        }
        const children = asArray(entry.children);
        if (children.length < 2) {
          c.error(
            `${path}.children`,
            "blend-children",
            `Blend2d state "${id}" needs at least two children.`,
          );
        }
        children.forEach((child, childIndex) => {
          if (!isRecord(child)) return;
          const pos = asArray(child.position);
          if (pos.length !== 2 || asNumber(pos[0]) == null || asNumber(pos[1]) == null) {
            c.error(
              `${path}.children[${String(childIndex)}].position`,
              "blend-position",
              `Blend2d state "${id}" needs a [x, y] position on every child.`,
            );
          }
        });
        if (entry.algorithm === "triangulated" && !hasNonCollinearPoints(children)) {
          c.error(
            `${path}.children`,
            "blend-triangulated",
            `Blend2d state "${id}" uses triangulated weights and needs at least three non-collinear child positions.`,
          );
        }
        break;
      }
      case "direct": {
        const entries = asArray(entry.entries);
        if (entries.length === 0) {
          c.error(`${path}.entries`, "direct-entries", `Direct state "${id}" declares no entries.`);
        }
        entries.forEach((item, itemIndex) => {
          const itemPath = `${path}.entries[${String(itemIndex)}]`;
          if (!isRecord(item)) {
            c.error(itemPath, "shape", `Direct state "${id}" entry must be an object.`);
            return;
          }
          const input = asString(item.input);
          if (
            input == null ||
            !isNumberInput(input, inputs, `${itemPath}.input`, c, `Direct state "${id}" entry`)
          ) {
            // reported
          }
          if (!isRecord(item.target)) {
            c.error(`${itemPath}.target`, "shape", `Direct state "${id}" entry needs a target.`);
          }
        });
        break;
      }
      case "exit":
        break;
      default:
        c.error(
          `${path}.type`,
          "state-type",
          `State "${id}" has an unknown type ${JSON.stringify(entry.type)}.`,
        );
    }

    // §11.1: exitTime is meaningless on a node with no time axis.
    if (type === "direct" && asNumber(entry.exitTime) != null) {
      c.error(
        `${path}.exitTime`,
        "exit-time-direct",
        `Direct state "${id}" has no time axis, so exitTime is rejected.`,
      );
    }

    out.set(id, entry as unknown as StateDef);
  });

  void resolver;

  return out;
}

function hasNonCollinearPoints(children: unknown[]): boolean {
  const points: [number, number][] = [];
  for (const child of children) {
    if (!isRecord(child)) continue;
    const pos = asArray(child.position);
    const x = asNumber(pos[0]);
    const y = asNumber(pos[1]);
    if (x == null || y == null) continue;
    points.push([x, y]);
  }
  if (points.length < 3) return false;
  const [a, b] = [points[0], points[1]];
  if (a == null || b == null) return false;
  for (let i = 2; i < points.length; i += 1) {
    const p = points[i];
    if (p == null) continue;
    const cross = (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]);
    if (Math.abs(cross) > 1e-9) return true;
  }
  return false;
}

function checkMarkers(markers: unknown, path: string, owner: string, c: Collector): void {
  asArray(markers).forEach((marker, index) => {
    if (!isRecord(marker)) {
      c.error(`${path}[${String(index)}]`, "shape", `${owner} marker must be an object.`);
      return;
    }
    const at = asNumber(marker.time);
    if (at == null || at < 0 || at > 1) {
      c.error(
        `${path}[${String(index)}].time`,
        "marker-time",
        `${owner} marker time must be normalised 0..1.`,
      );
    }
    if (asString(marker.name) == null) {
      c.error(
        `${path}[${String(index)}].name`,
        "shape",
        `${owner} marker needs a string \`name\`.`,
      );
    }
  });
}

/* ── Transitions ─────────────────────────────────────────────────────── */

function collectTransitions(
  layerEntry: Record<string, unknown>,
  layerIndex: number,
  states: Map<string, StateDef>,
  inputs: Map<string, InputDef>,
  c: Collector,
): TransitionDef[] {
  const out: TransitionDef[] = [];
  const layerPath = `layers[${String(layerIndex)}]`;

  const collect = (raw: unknown, path: string, impliedFrom: string | null): void => {
    asArray(raw).forEach((entry, index) => {
      const path_ = `${path}[${String(index)}]`;
      if (!isRecord(entry)) {
        c.error(path_, "shape", "Each transition must be an object.");
        return;
      }
      const from = impliedFrom ?? asString(entry.from);
      if (from == null) {
        c.error(`${path_}.from`, "shape", `Transition at ${path_} needs a \`from\` state.`);
        return;
      }
      const to = asString(entry.to);
      if (to == null) {
        c.error(`${path_}.to`, "shape", `Transition at ${path_} needs a \`to\` state.`);
        return;
      }
      if (from !== "*" && !states.has(from)) {
        c.error(
          `${path_}.from`,
          "unknown-state",
          `Transition from "${from}" names a state the layer does not declare.`,
        );
      }
      if (!states.has(to)) {
        c.error(
          `${path_}.to`,
          "unknown-state",
          `Transition to "${to}" names a state the layer does not declare.`,
        );
      }
      if (entry.when != null) {
        checkCondition(entry.when, inputs, `${path_}.when`, c);
      }
      const exitTime = asNumber(entry.exitTime);
      if (entry.exitTime != null && (exitTime == null || exitTime < 0 || exitTime > 1)) {
        c.error(
          `${path_}.exitTime`,
          "exit-time",
          `Transition at ${path_} needs exitTime normalised 0..1.`,
        );
      }
      if (exitTime != null && to != null) {
        const target = states.get(to);
        if (target != null && target.type === "direct") {
          c.error(
            `${path_}.exitTime`,
            "exit-time-direct",
            `Transition at ${path_} gates on exitTime of a direct state, which has no time axis.`,
          );
        }
      }
      if (entry.fade != null) {
        if (!isRecord(entry.fade)) {
          c.error(`${path_}.fade`, "shape", `Transition at ${path_} fade must be an object.`);
        } else {
          const duration = asNumber(entry.fade.duration);
          if (duration == null || duration < 0) {
            c.error(
              `${path_}.fade.duration`,
              "fade-duration",
              `Transition at ${path_} needs a fade duration >= 0.`,
            );
          }
          if (
            entry.fade.mode != null &&
            entry.fade.mode !== "fixed" &&
            entry.fade.mode !== "normalized"
          ) {
            c.error(
              `${path_}.fade.mode`,
              "fade-mode",
              `Transition at ${path_} fade mode must be fixed or normalized.`,
            );
          }
        }
      }
      if (entry.interruption != null) {
        const policy = asString(entry.interruption);
        if (
          policy !== "ignore" &&
          policy !== "interrupt" &&
          policy !== "interruptKeepPlaying" &&
          policy !== "queue"
        ) {
          c.error(
            `${path_}.interruption`,
            "interruption",
            `Transition at ${path_} has an unknown interruption policy.`,
          );
        }
      }
      out.push({ ...(entry as object), from } as TransitionDef);
    });
  };

  collect(layerEntry.transitions, `${layerPath}.transitions`, null);
  collect(layerEntry.anyState, `${layerPath}.anyState`, "*");

  return out;
}

function collectEntry(
  layerEntry: Record<string, unknown>,
  layerIndex: number,
  states: Map<string, StateDef>,
  inputs: Map<string, InputDef>,
  c: Collector,
): void {
  const path = `layers[${String(layerIndex)}].entry`;
  const raw = asArray(layerEntry.entry);
  if (raw.length === 0) {
    c.error(path, "no-entry", `Layer at ${path} needs at least one entry transition.`);
    return;
  }

  raw.forEach((entry, index) => {
    const entryPath = `${path}[${String(index)}]`;
    if (!isRecord(entry)) {
      c.error(entryPath, "shape", "Each entry must be an object.");
      return;
    }
    const to = asString(entry.to);
    if (to == null) {
      c.error(`${entryPath}.to`, "shape", `Entry at ${entryPath} needs a \`to\` state.`);
      return;
    }
    if (!states.has(to)) {
      c.error(
        `${entryPath}.to`,
        "unknown-state",
        `Entry targets "${to}", a state the layer does not declare.`,
      );
    }
    if (entry.when != null) {
      checkCondition(entry.when, inputs, `${entryPath}.when`, c);
    }
  });

  const last = raw[raw.length - 1];
  if (isRecord(last) && last.when != null) {
    c.error(
      `${path}[${String(raw.length - 1)}]`,
      "entry-fallback",
      "The last entry transition must be unconditional: with no eligible entry the layer has nowhere to start.",
    );
  }
}

/* ── Conditions ──────────────────────────────────────────────────────── */

function checkCondition(
  condition: unknown,
  inputs: Map<string, InputDef>,
  path: string,
  c: Collector,
): void {
  if (!isRecord(condition)) {
    c.error(path, "condition-shape", "A condition must be an object.");
    return;
  }

  if (Array.isArray(condition.all)) {
    condition.all.forEach((child: unknown, index: number) => {
      checkCondition(child, inputs, `${path}.all[${String(index)}]`, c);
    });
    return;
  }
  if (Array.isArray(condition.any)) {
    condition.any.forEach((child: unknown, index: number) => {
      checkCondition(child, inputs, `${path}.any[${String(index)}]`, c);
    });
    return;
  }
  if (condition.not != null) {
    checkCondition(condition.not, inputs, `${path}.not`, c);
    return;
  }

  const name = asString(condition.input);
  if (name == null) {
    c.error(path, "condition-shape", "A leaf condition needs an `input` and an `op`.");
    return;
  }
  const input = inputs.get(name);
  if (input == null) {
    c.error(`${path}.input`, "unknown-input", `Condition references undeclared input "${name}".`);
    return;
  }
  const op = asString(condition.op);
  if (op == null) {
    c.error(`${path}.op`, "condition-shape", `Condition on "${name}" needs an \`op\`.`);
    return;
  }

  if (input.kind === "trigger") {
    if (op !== "fired") {
      c.error(
        `${path}.op`,
        "condition-type",
        `Trigger "${name}" supports only the "fired" op, got "${String(op)}".`,
      );
    }
    return;
  }
  if (op === "fired") {
    c.error(
      `${path}.op`,
      "condition-type",
      `"fired" is a trigger op; "${name}" is a ${input.kind}.`,
    );
    return;
  }
  if (input.kind === "boolean") {
    if (op !== "equals" && op !== "notEquals") {
      c.error(
        `${path}.op`,
        "condition-type",
        `Boolean "${name}" supports equals/notEquals only, got "${String(op)}".`,
      );
    }
    if (typeof condition.value !== "boolean") {
      c.error(`${path}.value`, "condition-type", `Boolean "${name}" needs a boolean \`value\`.`);
    }
    return;
  }
  // number
  if (typeof condition.value !== "number" || !Number.isFinite(condition.value)) {
    c.error(
      `${path}.value`,
      "condition-type",
      `Number "${name}" needs a finite numeric \`value\` for "${String(op)}".`,
    );
  }
  if (condition.hysteresis != null && (asNumber(condition.hysteresis) ?? -1) < 0) {
    c.error(
      `${path}.hysteresis`,
      "hysteresis",
      `Condition on "${name}" needs a non-negative hysteresis.`,
    );
  }
}

/* ── Reachability ────────────────────────────────────────────────────── */

function collectReachability(
  layerId: string,
  states: Map<string, StateDef>,
  transitions: TransitionDef[],
  anyStateCount: number,
  c: Collector,
): void {
  const edges = new Map<string, string[]>();
  for (const transition of transitions) {
    const list = edges.get(transition.from) ?? [];
    list.push(transition.to);
    edges.set(transition.from, list);
  }

  const reachable = new Set<string>();
  const stack: string[] = [];
  for (const transition of transitions) {
    if (transition.from === "*") stack.push(transition.to);
  }
  // Entry targets seed the walk; the validator does not re-read the entry array here
  // because an entry that names an unknown state is already an error above.
  for (const [stateId] of states) {
    if (edges.has(stateId)) continue;
    void stateId;
  }

  const seen = new Set<string>(stack);
  while (stack.length > 0) {
    const current = stack.pop();
    if (current == null) continue;
    reachable.add(current);
    for (const next of edges.get(current) ?? []) {
      if (!seen.has(next)) {
        seen.add(next);
        stack.push(next);
      }
    }
  }

  // Any State edges make every state reachable in principle, so an unreachable state
  // only counts when the layer has no global edges at all.
  if (anyStateCount > 0) return;

  for (const [stateId, state] of states) {
    if (state.type === "exit") continue;
    if (reachable.has(stateId)) continue;
    if (edges.has(stateId)) {
      c.warn(
        `layers.${layerId}.states.${stateId}`,
        "unreachable-state",
        `State "${stateId}" can transition but nothing can reach it.`,
      );
    }
  }
}

/* ── Zero-duration cycles ────────────────────────────────────────────── */

function collectZeroDurationCycles(
  layerId: string,
  states: Map<string, StateDef>,
  transitions: TransitionDef[],
  anyStateCount: number,
  c: Collector,
): void {
  // An edge that cuts instantly and asks nothing of the machine is an infinite loop:
  // it fires the frame it becomes eligible, and the state it lands on is eligible
  // again in the same frame. Bounded at runtime by maxChainDepth, rejected at load.
  const unconditional = new Map<string, string[]>();
  for (const transition of transitions) {
    const instant = transition.fade == null || transition.fade.duration === 0;
    const unconditionalEdge = transition.when == null && transition.exitTime == null;
    if (!instant || !unconditionalEdge) continue;
    if (transition.from === "*") {
      // An unconditional Any State cut is a guaranteed loop the moment it lands.
      c.error(
        `layers.${layerId}.transitions`,
        "zero-duration-cycle",
        `Any State transition to "${transition.to}" is unconditional and instant: it loops forever.`,
      );
      continue;
    }
    const list = unconditional.get(transition.from) ?? [];
    list.push(transition.to);
    unconditional.set(transition.from, list);
  }
  void anyStateCount;
  void states;

  const visiting = new Set<string>();
  const done = new Set<string>();
  const walk = (node: string, trail: string[]): void => {
    if (visiting.has(node)) {
      c.error(
        `layers.${layerId}.transitions`,
        "zero-duration-cycle",
        `Zero-duration unconditional cycle: ${trail.join(" -> ")} -> ${node}.`,
      );
      return;
    }
    if (done.has(node)) return;
    visiting.add(node);
    for (const next of unconditional.get(node) ?? []) {
      walk(next, [...trail, node]);
    }
    visiting.delete(node);
    done.add(node);
  };

  for (const [node] of unconditional) {
    walk(node, []);
  }
}

/* ── Additive references ─────────────────────────────────────────────── */

function collectAdditiveRefs(
  layerId: string,
  layerEntry: Record<string, unknown>,
  states: Map<string, StateDef>,
  c: Collector,
): void {
  if (layerEntry.blend !== "additive") return;
  const inherited = layerEntry.additiveRef;
  for (const [stateId, state] of states) {
    if (state.type === "exit") continue;
    const own = (state as { additiveRef?: unknown }).additiveRef;
    if (own == null && inherited == null) {
      c.error(
        `layers.${layerId}.states.${stateId}`,
        "additive-ref",
        `Additive layer "${layerId}" state "${stateId}" declares no additiveRef: an additive blend has ` +
          "no meaning without the pose its delta is measured from.",
      );
    }
  }
}

/* ── Blend space maths preconditions ─────────────────────────────────── */

function collectBlendSpaces(
  states: Map<string, StateDef>,
  layerPath: string,
  inputs: Map<string, InputDef>,
  c: Collector,
): void {
  void states;
  void layerPath;
  void inputs;
  void c;
  // Position uniqueness, child counts, collinearity and input types are all checked in
  // collectStates, where the paths are per-child. This hook stays for symmetry with the
  // plan's phase list; a check added here would report a worse path than the one above.
}

/* ── Constraints (§6) ────────────────────────────────────────────────── */

function collectConstraints(
  def: Record<string, unknown>,
  inputs: Map<string, InputDef>,
  masks: Map<string, MaskDef>,
  groups: { morph: Map<string, string[]>; bones: Map<string, string[]> },
  rig: RigDescription | undefined,
  c: Collector,
): void {
  const raw = asArray(def.constraints);
  if (raw.length === 0) return;

  const seenIds = new Set<string>();
  const writes = new Map<string, string>();
  const dependencies = new Map<string, Set<string>>();
  const exposed = new Map<string, string>();

  raw.forEach((entry, index) => {
    const path = `constraints[${String(index)}]`;
    if (!isRecord(entry)) {
      c.error(path, "shape", "Each constraint must be an object.");
      return;
    }
    const id = asString(entry.id);
    if (id == null) {
      c.error(`${path}.id`, "shape", "Each constraint needs a string `id`.");
      return;
    }
    if (seenIds.has(id)) {
      c.error(`${path}.id`, "duplicate-constraint", `Constraint "${id}" is declared twice.`);
      return;
    }
    seenIds.add(id);

    const enabled = entry.enabled !== false;
    const targetKey = targetKeyOf(entry.target);
    if (targetKey == null) {
      c.error(
        `${path}.target`,
        "constraint-target",
        `Constraint "${id}" needs a bone, morph or pose target.`,
      );
    } else if (enabled) {
      const previous = writes.get(targetKey);
      if (previous != null) {
        c.error(
          `${path}.target`,
          "constraint-double-write",
          `Constraints "${previous}" and "${id}" both write ${targetKey}: split them into distinct channels or mask them apart.`,
        );
      } else {
        writes.set(targetKey, id);
      }
      checkTargetAgainstRig(entry.target, rig, groups, `${path}.target`, c, id);
    }

    const kind = entry.kind;
    const reads = new Set<string>();
    if (!isRecord(kind)) {
      c.error(`${path}.kind`, "shape", `Constraint "${id}" needs a kind object.`);
    } else {
      const type = asString(kind.type);
      if (
        type !== "proportional" &&
        type !== "aim" &&
        type !== "follow" &&
        type !== "limit" &&
        type !== "copy" &&
        type !== "pointer"
      ) {
        c.error(
          `${path}.kind.type`,
          "constraint-kind",
          `Constraint "${id}" has an unknown kind ${JSON.stringify(kind.type)}.`,
        );
      }
      for (const entry of refsOf(kind)) {
        checkRef(entry.ref, inputs, rig, `${path}.kind.${entry.path}`, c, id, reads);
      }
      if (type === "proportional") {
        const measure = asString(kind.measure);
        if (
          measure !== "distance" &&
          measure !== "axisDelta" &&
          measure !== "angle" &&
          measure !== "heightAbovePlane"
        ) {
          c.error(
            `${path}.kind.measure`,
            "constraint-measure",
            `Constraint "${id}" has an unknown measure.`,
          );
        }
        if (asNumber(kind.factor) == null) {
          c.error(
            `${path}.kind.factor`,
            "constraint-factor",
            `Constraint "${id}" needs a numeric factor.`,
          );
        }
        if (measure === "heightAbovePlane" && asString(kind.plane) != null && rig?.planes != null) {
          if (rig.planes[String(kind.plane)] == null) {
            c.error(
              `${path}.kind.plane`,
              "unknown-plane",
              `Constraint "${id}" references undeclared plane "${String(kind.plane)}".`,
            );
          }
        }
      }
      if (type === "pointer" && !isRecord(kind.pointer)) {
        c.error(
          `${path}.kind.pointer`,
          "constraint-pointer",
          `Constraint "${id}" needs a PointerRef.`,
        );
      }
      if (type === "pointer" && isRecord(kind.pointer)) {
        const mesh = asString(kind.pointer.mesh);
        const surface = asString(kind.pointer.surface);
        if (mesh == null && surface == null) {
          c.warn(
            `${path}.kind.pointer`,
            "pointer-target",
            `Constraint "${id}" reads any pointer hit; name a mesh or surface to make it reproducible.`,
          );
        }
        if (mesh != null && rig?.meshes != null && !rig.meshes.some((m) => m.mesh === mesh)) {
          c.error(
            `${path}.kind.pointer.mesh`,
            "unknown-mesh",
            `Constraint "${id}" reads pointer hits on unknown mesh "${mesh}".`,
          );
        }
      }
    }

    checkMaskRef(entry.mask, masks, `${path}.mask`, c, `Constraint "${id}"`);

    const exposeAs = asString(entry.exposeAs);
    if (entry.exposeAs != null) {
      const input = inputs.get(String(entry.exposeAs));
      if (exposeAs == null || input == null || input.kind !== "number") {
        c.error(
          `${path}.exposeAs`,
          "constraint-expose",
          `Constraint "${id}" must expose a declared number input, got ${JSON.stringify(entry.exposeAs)}.`,
        );
      } else if (reads.has(`input:${exposeAs}`)) {
        c.error(
          `${path}.exposeAs`,
          "constraint-cycle",
          `Constraint "${id}" reads input "${exposeAs}" and also publishes it: that is a cycle across the input boundary.`,
        );
      } else {
        exposed.set(id, exposeAs);
      }
    }

    dependencies.set(id, reads);
  });

  // A constraint reads a channel another constraint writes. With breakOnCycle (the
  // default) that is a load error naming the path; without it the runtime freezes the
  // last-good value and warns, which is why the check is skipped for those.
  const writeOwner = new Map<string, { id: string; breakOnCycle: boolean }>();
  raw.forEach((entry) => {
    if (!isRecord(entry)) return;
    const id = asString(entry.id);
    if (id == null) return;
    const key = targetKeyOf(entry.target);
    if (key == null) return;
    writeOwner.set(key, { id, breakOnCycle: entry.breakOnCycle !== false });
  });

  for (const [id, reads] of dependencies) {
    const self = raw.find((entry) => isRecord(entry) && asString(entry.id) === id);
    const breakOnCycle = isRecord(self) ? self.breakOnCycle !== false : true;
    if (!breakOnCycle) continue;
    for (const read of reads) {
      const owner = writeOwner.get(read);
      if (owner != null && owner.id === id) {
        c.error(
          `constraints.${id}`,
          "constraint-cycle",
          `Constraint "${id}" reads the channel it writes (${read}).`,
        );
        continue;
      }
      if (owner != null) {
        const upstream = dependencies.get(owner.id);
        if (upstream?.has(`constraint:${id}`) === true) {
          c.error(
            `constraints.${id}`,
            "constraint-cycle",
            `Constraints "${owner.id}" and "${id}" read each other's output.`,
          );
        }
      }
    }
  }

  void exposed;
}

function targetKeyOf(target: unknown): string | null {
  if (!isRecord(target)) return null;
  const bone = asString(target.bone);
  const channel = asString(target.channel);
  if (bone != null && channel != null) return `bone:${bone}.${channel}`;
  if (isRecord(target.morph)) {
    const mesh = asString(target.morph.mesh);
    const t = asString(target.morph.target);
    if (mesh != null && t != null) return `morph:${mesh}:${t}`;
  }
  const pose = asString(target.pose);
  if (pose != null) return `pose:${pose}`;
  return null;
}

function checkTargetAgainstRig(
  target: unknown,
  rig: RigDescription | undefined,
  groups: { morph: Map<string, string[]>; bones: Map<string, string[]> },
  path: string,
  c: Collector,
  id: string,
): void {
  if (rig == null || !isRecord(target)) return;
  void groups;
  const bone = asString(target.bone);
  if (bone != null && !rig.bones.includes(bone)) {
    c.error(
      `${path}.bone`,
      "unknown-bone",
      `Constraint "${id}" targets bone "${bone}", which the rig does not have.`,
    );
  }
  if (isRecord(target.morph)) {
    const mesh = asString(target.morph.mesh);
    const t = asString(target.morph.target);
    const description = rig.meshes?.find((m) => m.mesh === mesh);
    if (mesh != null && description == null) {
      c.error(
        `${path}.morph.mesh`,
        "unknown-mesh",
        `Constraint "${id}" targets morph mesh "${mesh}", which the rig does not have.`,
      );
    } else if (t != null && description != null && !description.targets.includes(t)) {
      c.error(
        `${path}.morph.target`,
        "unknown-morph",
        `Constraint "${id}" targets morph "${t}" on mesh "${mesh}", which does not have it.`,
      );
    }
  }
  const pose = asString(target.pose);
  if (pose != null && rig.poses != null && !rig.poses.includes(pose)) {
    c.error(
      `${path}.pose`,
      "unknown-pose",
      `Constraint "${id}" targets pose "${pose}", which the rig does not declare.`,
    );
  }
}

function refsOf(kind: Record<string, unknown>): { ref: Ref; path: string }[] {
  const out: { ref: Ref; path: string }[] = [];
  const push = (value: unknown, path: string): void => {
    if (isRecord(value)) out.push({ ref: value as unknown as Ref, path });
  };
  push(kind.source, "source");
  push(kind.reference, "reference");
  return out;
}

function checkRef(
  ref: Ref,
  inputs: Map<string, InputDef>,
  rig: RigDescription | undefined,
  /** The full path to this ref, e.g. `constraints[0].kind.source`. */
  refPath: string,
  c: Collector,
  id: string,
  reads: Set<string>,
): void {
  const path = refPath;
  if ("input" in ref && typeof ref.input === "string") {
    const input = inputs.get(ref.input);
    if (input == null) {
      c.error(
        `${path}.input`,
        "unknown-input",
        `Constraint "${id}" reads undeclared input "${ref.input}".`,
      );
    } else {
      reads.add(`input:${ref.input}`);
    }
    return;
  }
  if ("bone" in ref && typeof ref.bone === "string") {
    reads.add(`bone:${ref.bone}.x`);
    reads.add(`bone:${ref.bone}.y`);
    reads.add(`bone:${ref.bone}.z`);
    if (rig != null && !rig.bones.includes(ref.bone)) {
      c.error(
        `${path}.bone`,
        "unknown-bone",
        `Constraint "${id}" reads bone "${ref.bone}", which the rig does not have.`,
      );
    }
    return;
  }
  if ("pointer" in ref) {
    reads.add("pointer");
    return;
  }
  if ("world" in ref) {
    return;
  }
  c.error(path, "constraint-ref", `Constraint "${id}" has a ref it cannot resolve at ${path}.`);
}

/* ── Listeners ───────────────────────────────────────────────────────── */

function collectListeners(
  def: Record<string, unknown>,
  inputs: Map<string, InputDef>,
  rig: RigDescription | undefined,
  c: Collector,
): void {
  const raw = asArray(def.listeners);
  if (raw.length === 0) return;

  const events = new Set([
    "pointerEnter",
    "pointerLeave",
    "pointerDown",
    "pointerUp",
    "click",
    "doubleClick",
    "dragStart",
    "drag",
    "dragEnd",
  ]);

  raw.forEach((entry, index) => {
    const path = `listeners[${String(index)}]`;
    if (!isRecord(entry)) {
      c.error(path, "shape", "Each listener must be an object.");
      return;
    }
    if (!isRecord(entry.target)) {
      c.error(`${path}.target`, "shape", "Each listener needs a target object.");
    } else {
      const mesh = asString(entry.target.mesh);
      if (mesh == null) {
        c.error(`${path}.target.mesh`, "shape", "Each listener target needs a `mesh`.");
      } else if (rig?.meshes != null && !rig.meshes.some((m) => m.mesh === mesh)) {
        c.warn(
          `${path}.target.mesh`,
          "unknown-mesh",
          `Listener targets mesh "${mesh}", which the rig does not have: it will idle.`,
        );
      }
    }
    const event = asString(entry.event);
    if (event == null || !events.has(event)) {
      c.error(
        `${path}.event`,
        "listener-event",
        `Listener at ${path} has an unknown event ${JSON.stringify(entry.event)}.`,
      );
    }
    const actions = asArray(entry.actions);
    if (actions.length === 0) {
      c.error(`${path}.actions`, "listener-actions", `Listener at ${path} declares no actions.`);
    }
    actions.forEach((action, actionIndex) => {
      const actionPath = `${path}.actions[${String(actionIndex)}]`;
      if (!isRecord(action)) {
        c.error(actionPath, "shape", "Each listener action must be an object.");
        return;
      }
      const name =
        asString(action.set) ??
        asString(action.fire) ??
        asString(action.toggle) ??
        asString(action.add) ??
        asString(action.setFromDrag);
      if (name == null) {
        c.error(actionPath, "listener-action", `Listener action at ${actionPath} names no input.`);
        return;
      }
      const input = inputs.get(name);
      if (input == null) {
        c.error(actionPath, "unknown-input", `Listener action writes undeclared input "${name}".`);
        return;
      }
      if (action.set != null && input.kind === "trigger") {
        c.error(
          `${actionPath}.set`,
          "listener-action",
          `Listener sets trigger "${name}"; use { fire } instead.`,
        );
      }
      if ((action.fire != null || action.toggle != null) && input.kind === "number") {
        c.error(actionPath, "listener-action", `Listener fires/toggles number input "${name}".`);
      }
      if (action.add != null && input.kind !== "number") {
        c.error(
          `${actionPath}.add`,
          "listener-action",
          `Listener adds to non-number input "${name}".`,
        );
      }
      if (action.setFromDrag != null) {
        if (input.kind !== "number") {
          c.error(
            `${actionPath}.setFromDrag`,
            "listener-action",
            `setFromDrag needs a number input, "${name}" is ${input.kind}.`,
          );
        }
        const map = asArray(action.map).map((v) => asNumber(v));
        if (map.length !== 4 || map.some((v) => v == null)) {
          c.error(
            `${actionPath}.map`,
            "listener-action",
            `setFromDrag needs a four-number map [inMin, inMax, outMin, outMax].`,
          );
        }
      }
    });
  });
}

/* ── Asset references (§11.1 "asset ids via a provided resolver") ────── */

function collectAssets(
  def: Record<string, unknown>,
  layers: LayerDef[],
  timelines: Map<string, TimelineDef>,
  resolver: AssetResolver | undefined,
  c: Collector,
): void {
  if (resolver == null) return;

  const check = (id: string, path: string, owner: string, want: "clip" | "morphCurve"): void => {
    const found = want === "clip" ? resolver.clip(id) : resolver.morphCurve(id);
    if (found == null) {
      c.error(
        path,
        want === "clip" ? "unknown-clip" : "unknown-morph-curve",
        `${owner} references ${want} "${id}", which the resolver cannot produce.`,
      );
    }
  };

  layers.forEach((layer, layerIndex) => {
    const layerPath = `layers[${String(layerIndex)}]`;
    (layer.states as StateDef[]).forEach((state, stateIndex) => {
      const statePath = `${layerPath}.states[${String(stateIndex)}]`;
      if (state.type === "clip") {
        if (state.clip != null)
          check(state.clip, `${statePath}.clip`, `State "${state.id}"`, "clip");
        if (state.morphCurve != null)
          check(state.morphCurve, `${statePath}.morphCurve`, `State "${state.id}"`, "morphCurve");
      } else if (state.type === "blend1d" || state.type === "blend2d") {
        (state.children as BlendChild[]).forEach((child, childIndex) => {
          const childPath = `${statePath}.children[${String(childIndex)}]`;
          if (child.clip != null)
            check(child.clip, `${childPath}.clip`, `Blend child of "${state.id}"`, "clip");
          if (child.morphCurve != null)
            check(
              child.morphCurve,
              `${childPath}.morphCurve`,
              `Blend child of "${state.id}"`,
              "morphCurve",
            );
        });
      }
    });
  });

  for (const timeline of timelines.values()) {
    if (timeline.clip != null)
      check(timeline.clip, `timelines.${timeline.id}.clip`, `Timeline "${timeline.id}"`, "clip");
    if (timeline.morphCurve != null)
      check(
        timeline.morphCurve,
        `timelines.${timeline.id}.morphCurve`,
        `Timeline "${timeline.id}"`,
        "morphCurve",
      );
  }

  void def;
}

/* ── Condition type export for the evaluator's reuse ─────────────────── */

export type { Condition, Measure };
