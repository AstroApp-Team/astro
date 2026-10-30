#!/usr/bin/env node
/**
 * Theatre.js state import tool.
 *
 * The Studio exports a project's animation state as JSON keyed by **sheet id**.
 * Production reads a sheet by the string in `SHEET_IDS` (`src/infrastructure/
 * theatre/project.ts`), so a rig authored in the `StudioSandbox` sheet is inert
 * under `StingScene` — core looks up `sheetsById["StingScene"]`, finds nothing,
 * and plays the scene at its initial values with no error at all.
 *
 * This script does the rename, merges the result into the single canonical state
 * file the app imports, and tells you what it did.
 *
 *   node scripts/theatre-state.mjs import <exported.json> --to StingScene
 *   node scripts/theatre-state.mjs import <exported.json> --from StudioSandbox --to StingScene
 *   node scripts/theatre-state.mjs list
 *   node scripts/theatre-state.mjs drop StingScene
 *
 * Via npm: `pnpm run theatre:state -- import ~/Downloads/PortfolioProject.state.json --to StingScene`
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const STATE_FILE = resolve(ROOT, "src/infrastructure/theatre/states/portfolio-project.state.json");

/** Must match `currentProjectStateDefinitionVersion` in the installed @theatre/core. */
const DEFINITION_VERSION = "0.4.0";

const SHEET_IDS_FILE = resolve(ROOT, "src/infrastructure/theatre/project.ts");

function readJson(path, label) {
  if (!existsSync(path)) fail(`no such file: ${path}`);
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (cause) {
    fail(`${label} is not valid JSON (${path}): ${cause.message}`);
  }
}

function fail(message) {
  console.error(`\n${message}\n`);
  process.exitCode = 1;
  process.exit(1);
}

function assertVersion(state, label) {
  if (state?.definitionVersion !== DEFINITION_VERSION) {
    fail(
      `${label} has definitionVersion ${JSON.stringify(state?.definitionVersion)}, ` +
        `this @theatre/core reads ${JSON.stringify(DEFINITION_VERSION)}. ` +
        `Re-export from a Studio that matches the installed @theatre/core.`,
    );
  }
}

function loadCanonical() {
  if (!existsSync(STATE_FILE)) {
    return { sheetsById: {}, revisionHistory: [], definitionVersion: DEFINITION_VERSION };
  }
  const state = readJson(STATE_FILE, "canonical state");
  assertVersion(state, "canonical state file");
  return state;
}

function saveCanonical(state) {
  mkdirSync(dirname(STATE_FILE), { recursive: true });
  writeFileSync(STATE_FILE, `${JSON.stringify(state, null, 2)}\n`);
}

function sheetIdsInApp() {
  const source = readFileSync(SHEET_IDS_FILE, "utf8");
  const block = source.match(/export const SHEET_IDS = \{([\s\S]*?)\} as const/);
  if (block == null) return [];
  return [...block[1].matchAll(/:\s*"([^"]+)"/g)].map((m) => m[1]);
}

function summarize(sheetId, sheet) {
  const tracks = sheet?.sequence?.tracksByObject ?? {};
  const objects = Object.keys(tracks);
  const trackCount = objects.reduce((n, key) => n + Object.keys(tracks[key].trackData).length, 0);
  return {
    sheetId,
    length: sheet?.sequence?.length ?? 0,
    objects: objects.length,
    tracks: trackCount,
  };
}

function printSummary({ sheetId, length, objects, tracks }) {
  console.log(
    `  sheet ${JSON.stringify(sheetId)}  length ${length}s  ${objects} objects  ${tracks} tracks`,
  );
}

const [command, ...rest] = process.argv.slice(2);

if (command == null) {
  console.log(`Theatre.js state import — canonical file: ${STATE_FILE}\n
  import <exported.json> [--from <sheetId>] --to <sheetId>   rename + merge one sheet
  list                                                       every sheet in the canonical file
  drop <sheetId>                                             remove one sheet
`);
  process.exitCode = 1;
  process.exit(1);
}

if (command === "list") {
  const state = loadCanonical();
  const ids = Object.keys(state.sheetsById);
  if (ids.length === 0) {
    console.log("canonical state has no sheets yet");
    breakLoop();
  }
  console.log(`canonical state: ${ids.length} sheet(s)\n`);
  for (const id of ids) printSummary(summarize(id, state.sheetsById[id]));

  const known = sheetIdsInApp();
  const orphans = ids.filter((id) => known.length > 0 && !known.includes(id));
  if (orphans.length > 0) {
    console.log(
      `\nthese sheet ids are not in SHEET_IDS, so nothing mounts them: ${orphans.join(", ")}`,
    );
  }
  breakLoop();
}

if (command === "drop") {
  const sheetId = rest[0];
  if (sheetId == null) fail("drop needs a sheet id");
  const state = loadCanonical();
  if (state.sheetsById[sheetId] == null)
    fail(`no sheet ${JSON.stringify(sheetId)} in the canonical file`);
  delete state.sheetsById[sheetId];
  saveCanonical(state);
  console.log(`dropped ${JSON.stringify(sheetId)}`);
  breakLoop();
}

if (command !== "import") fail(`unknown command ${JSON.stringify(command)}`);

const exportedPath = rest[0];
const flags = new Map();
for (let i = 1; i < rest.length; i += 2) {
  const flag = rest[i];
  if (flag == null || !flag.startsWith("--"))
    fail(`expected a --flag, got ${JSON.stringify(flag)}`);
  const value = rest[i + 1];
  if (value == null) fail(`${flag} needs a value`);
  flags.set(flag.slice(2), value);
}

const to = flags.get("to");
if (to == null) fail("import needs --to <sheetId> (the id in SHEET_IDS that will mount this rig)");

const exported = readJson(exportedPath, "exported state");
assertVersion(exported, "exported state");

const exportedIds = Object.keys(exported.sheetsById ?? {});
if (exportedIds.length === 0)
  fail("the exported state has no sheets — rig something before exporting");

const from = flags.get("from") ?? (exportedIds.length === 1 ? exportedIds[0] : undefined);
if (from == null) {
  fail(
    `the export has ${exportedIds.length} sheets, so --from is required: ${exportedIds.join(", ")}`,
  );
}
if (exported.sheetsById[from] == null) {
  fail(`the export has no sheet ${JSON.stringify(from)}: ${exportedIds.join(", ")}`);
}

const canonical = loadCanonical();
const replacing = canonical.sheetsById[to] != null;
canonical.sheetsById[to] = exported.sheetsById[from];
saveCanonical(canonical);

console.log(
  `${replacing ? "replaced" : "added"} ${JSON.stringify(from)} -> ${JSON.stringify(to)} in\n  ${STATE_FILE}\n`,
);
printSummary(summarize(to, canonical.sheetsById[to]));

const known = sheetIdsInApp();
if (known.length > 0 && !known.includes(to)) {
  console.log(
    `\nwarning: ${JSON.stringify(to)} is not in SHEET_IDS (src/infrastructure/theatre/project.ts).\n` +
      `  Nothing mounts this rig until a SHEET_IDS entry has exactly this string.`,
  );
}

console.log(
  `\nstate is registered already — src/infrastructure/theatre/states/index.ts imports this whole file.\n` +
    `playback: getSheet(SHEET_IDS.<key>).sequence.play() (see useSheetPlayback).\n` +
    `the theatreKey of every track above must match a theatreKey in your JSX, exactly.\n`,
);

function breakLoop() {
  process.exit(0);
}
