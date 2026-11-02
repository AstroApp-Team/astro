/**
 * Where a machine definition comes from, and what a bad one does.
 *
 * The canonical form is JSON on disk — a definition is data, not code, and the demo ships
 * one. It is read through `JSON.parse` and handed to `validateDefinition`, so a hand edit
 * that breaks a reference fails with a JSON path instead of producing a machine that
 * silently plays nothing.
 *
 * **A definition file is formatter-excluded.** It is written with `JSON.stringify(…, 2)`
 * (by the Studio save path, or by hand), and the formatter collapses short arrays — the
 * same reason `states/*.json` are in `fmt.ignorePatterns`. Add the file there when a new
 * definition lands, or `vp check --fix` and the writer will fight forever.
 */

import type { AssetResolver } from "@core/interfaces/animationAssets.ts";
import type { MachineDefinition, RigDescription } from "@core/models/animationStateMachine.ts";
import { validateDefinition } from "@core/usecases/animationStateMachine/validateDefinition.ts";

import demoDefinition from "@infra/theatre/animationStateMachine/definitions/machine-demo.definition.json";

/**
 * The definitions this build ships, by id.
 *
 * A static import, not a fetch: the file is part of the bundle, so a definition change is
 * a build, and a route that renders a machine cannot start before its definition exists.
 */
const REGISTRY: Record<string, unknown> = {
  "machine-demo": demoDefinition,
};

export type DefinitionId = keyof typeof REGISTRY;

/**
 * Parse + validate a definition.
 *
 * `rig` is optional by design: without it, bone and morph names are checked by the adapter
 * at write time (which is the only place that can know them); with it, a typo is a load
 * error instead of a red frame.
 */
export function loadDefinition(
  raw: unknown,
  rig?: RigDescription,
  resolver?: AssetResolver,
): MachineDefinition {
  const report = validateDefinition(raw, rig, resolver);
  if (!report.ok) {
    const first = report.errors[0];
    const detail = report.errors.map((issue) => `  ${issue.path}: ${issue.message}`).join("\n");
    throw new Error(
      `machineDefinitionStore: invalid definition${first == null ? "" : ` at ${first.path}`}\n${detail}`,
    );
  }
  /*
   * The validator checks and reports; it does not re-shape the input, so the parsed JSON is
   * the definition. The cast is the one place that assumption lives, right next to the
   * check that makes it true.
   */
  return raw as MachineDefinition;
}

/** A shipped definition by id. Unknown ids are loud — a typo must not render an empty rig. */
export function loadShippedDefinition(id: string): MachineDefinition {
  const raw = REGISTRY[id];
  if (raw == null) {
    throw new Error(
      `machineDefinitionStore: no definition "${id}"; this build ships ${Object.keys(REGISTRY).join(", ")}`,
    );
  }
  return loadDefinition(raw);
}

/**
 * Hand a definition back to the author as a file.
 *
 * Dev-only, and deliberately a download rather than a server write: the Studio's save
 * plugin owns `states/*.json`, and a second writer on the same directory is how two tools
 * end up truncating each other's file. A human moves the file into `definitions/`.
 */
export function downloadDefinition(definition: MachineDefinition, filename: string): void {
  if (!import.meta.env.DEV) {
    throw new Error("machineDefinitionStore: saving a definition is a dev-only action");
  }
  const blob = new Blob([JSON.stringify(definition, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}
