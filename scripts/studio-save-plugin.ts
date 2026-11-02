import type { Plugin, ViteDevServer } from "vite";
import type { IncomingMessage, ServerResponse } from "node:http";
import { mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  MAX_STUDIO_SAVE_BYTES,
  STUDIO_CLEAR_ENDPOINT,
  STUDIO_LOAD_ENDPOINT,
  STUDIO_SAVE_ENDPOINT,
  STUDIO_SAVE_HEADER,
  STUDIO_SAVE_HEADER_VALUE,
  SHAPES_FILE_HINT,
  StudioSavePayloadSchema,
  THEATRE_STATE_DEFINITION_VERSION,
  countSavedShapes,
  emptySavedShapes,
  emptyTheatreState,
} from "../shared/studio-save.ts";

/**
 * The dev-only file writer behind the Studio's Save button.
 *
 * ── Why it is a Vite middleware ─────────────────────────────────────────────
 *
 * The Studio's state lives in the browser; the file that has to survive a reload
 * lives on disk. The dev server is the one thing both sides already trust, so
 * saving is a `POST` to a middleware and loading is a plain `import` of the file
 * that middleware wrote. `apply: "serve"` is the whole security story: in a build
 * these endpoints do not exist, and a shipped bundle cannot write to a filesystem.
 *
 * ── What the middleware is for ──────────────────────────────────────────────
 *
 * It is the trust boundary, not a convenience. The browser is untrusted input, so
 * the payload is size-capped, parsed against `shared/studio-save.ts`, and the
 * Theatre `definitionVersion` is checked — a state file written by a different
 * @theatre/core loads at its initial values with no error at all, so the rig is
 * simply not there and nothing says so. The two paths are constants in this file
 * and the request never names a file, so there is no path to traverse.
 *
 * ── Why the write is a rename ───────────────────────────────────────────────
 *
 * Vite watches these two files. A half-written 3 MB state file is a JSON parse
 * error in a module the app imports at module scope, and it lands in whichever
 * page happens to reload at that moment. Write to `.tmp`, rename into place: the
 * watcher only ever sees a complete file.
 */

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const STATE_FILE = resolve(ROOT, "src/infrastructure/theatre/states/astro.local.state.json");
const SHAPES_FILE = resolve(ROOT, "src/infrastructure/theatre/states/astro.local.shapes.json");

/** The prefix all three endpoints live under. */
const MOUNT = "/__astro-studio";

/** The machine editor's write endpoint (§4.3). Dev-only, like the Studio's. */
const EDITOR_SAVE_ENDPOINT = "/__astro-editor/save";
const EDITOR_FILE_ENDPOINT = "/__astro-editor/file";
const EDITOR_HEADER = "x-astro-editor-save";
const DEFINITION_FILE = resolve(
  ROOT,
  "src/infrastructure/theatre/animationStateMachine/definitions/machine-demo.definition.json",
);
const EDITOR_FILE = resolve(
  ROOT,
  "src/infrastructure/theatre/animationStateMachine/definitions/machine-demo.machine.editor.json",
);

/**
 * Answer only a request that carries the studio-save header.
 *
 * There is deliberately no `Host` check here. This dev server is reached over the
 * network — Tailscale hostnames included — and "did the request come from the
 * machine running the server?" is not a question the answer to which tells you
 * anything about the request. The header is the guard: a cross-origin page cannot
 * attach a custom header to a `fetch` without a CORS preflight, the dev server
 * does not answer preflights, so a drive-by write from any webpage fails in the
 * browser. The app is same-origin and sends it on every call.
 *
 * That is a drive-by-write guard, not an access-control list: anyone who can load
 * this app can write these two files, which is what a dev server is for.
 */
function hasSaveHeader(req: IncomingMessage): boolean {
  return req.headers[STUDIO_SAVE_HEADER] === STUDIO_SAVE_HEADER_VALUE;
}

function json(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Content-Length", Buffer.byteLength(payload));
  res.end(payload);
}

function readBody(req: IncomingMessage, limit: number): Promise<string> {
  return new Promise((resolveBody, rejectBody) => {
    const chunks: Buffer[] = [];
    let size = 0;

    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > limit) {
        rejectBody(new Error(`payload exceeds the ${limit} byte ceiling`));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolveBody(Buffer.concat(chunks).toString("utf8")));
    req.on("error", rejectBody);
  });
}

function writeJson(file: string, value: unknown): void {
  mkdirSync(dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`);
  renameSync(tmp, file);
}

/** Parsed file contents, or null when the file is missing or unparseable. */
function readJson(file: string): unknown {
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

/** Newest mtime of the two files, so the pane can print "saved at …". */
function savedAt(): string | null {
  let newest = 0;
  for (const file of [STATE_FILE, SHAPES_FILE]) {
    try {
      newest = Math.max(newest, statSync(file).mtimeMs);
    } catch {
      // A missing file is simply not the newest one.
    }
  }
  return newest === 0 ? null : new Date(newest).toISOString();
}

/** Drop the two JSON modules so the next request re-reads what was written. */
function invalidate(server: ViteDevServer): void {
  for (const file of [STATE_FILE, SHAPES_FILE]) {
    for (const mod of server.moduleGraph.getModulesByFile(file) ?? []) {
      server.moduleGraph.invalidateModule(mod);
    }
  }
}

async function handle(
  req: IncomingMessage,
  res: ServerResponse,
  next: () => void,
  server: ViteDevServer,
) {
  const path = (req.url ?? "").split("?")[0] ?? "";

  if (path === EDITOR_FILE_ENDPOINT) {
    /* The workspace file only. The definition is a bundled module, so the app already has it;
       node positions and splits are the part a fresh browser has never seen. */
    json(res, 200, { file: readJson(EDITOR_FILE), savedAt: savedAt() });
    return;
  }

  if (path === EDITOR_SAVE_ENDPOINT) {
    /* Two files, two writers: the definition is the machine, the editor file is the
       workspace. Both go through the same atomic rename, because Vite watches the
       definition and a half-written JSON is a module the app imports at load. */
    if (req.method !== "POST") {
      json(res, 405, { error: `${req.method} is not allowed on ${path}` });
      return;
    }
    if (req.headers[EDITOR_HEADER] !== "1") {
      json(res, 403, { error: `editor save requires ${EDITOR_HEADER}: 1` });
      return;
    }
    let body: string;
    try {
      body = await readBody(req, MAX_STUDIO_SAVE_BYTES);
    } catch (cause) {
      json(res, 413, { error: (cause as Error).message });
      return;
    }
    let parsed: { definition?: unknown; editor?: unknown };
    try {
      parsed = JSON.parse(body) as { definition?: unknown; editor?: unknown };
    } catch {
      json(res, 400, { error: "the body is not JSON" });
      return;
    }
    if (parsed.definition == null) {
      json(res, 400, { error: "the body has no definition" });
      return;
    }
    writeJson(DEFINITION_FILE, parsed.definition);
    if (parsed.editor != null) writeJson(EDITOR_FILE, parsed.editor);
    invalidate(server);
    json(res, 200, { ok: true, files: [DEFINITION_FILE, EDITOR_FILE] });
    return;
  }

  const wantsSave = path === STUDIO_SAVE_ENDPOINT;
  const wantsLoad = path === STUDIO_LOAD_ENDPOINT;
  const wantsClear = path === STUDIO_CLEAR_ENDPOINT;

  if (!path.startsWith(MOUNT) || (!wantsSave && !wantsLoad && !wantsClear)) {
    // Not ours — let Vite serve the file it was really asking for. This runs
    // before the header check: a middleware mounted at the root answers every
    // request in the app, and one that demands its own header first turns a
    // missing header into a 403 on `/`, on `/src/main.tsx`, on everything.
    next();
    return;
  }

  if (!hasSaveHeader(req)) {
    json(res, 403, {
      error: `studio save requires the ${STUDIO_SAVE_HEADER}: ${STUDIO_SAVE_HEADER_VALUE} header`,
    });
    return;
  }

  if (req.method === "GET" && wantsLoad) {
    json(res, 200, {
      state: readJson(STATE_FILE),
      shapes: readJson(SHAPES_FILE),
      savedAt: savedAt(),
      files: [STATE_FILE, SHAPES_FILE],
    });
    return;
  }

  if (req.method !== "POST") {
    json(res, 405, { error: `${req.method} is not allowed on ${path}` });
    return;
  }

  if (wantsClear) {
    writeJson(STATE_FILE, emptyTheatreState());
    writeJson(SHAPES_FILE, { _how: SHAPES_FILE_HINT, ...emptySavedShapes() });
    invalidate(server);
    json(res, 200, { ok: true, savedAt: savedAt() });
    return;
  }

  let body: string;
  try {
    body = await readBody(req, MAX_STUDIO_SAVE_BYTES);
  } catch (cause) {
    json(res, 413, { error: (cause as Error).message });
    return;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch (cause) {
    json(res, 400, { error: `body is not valid JSON: ${(cause as Error).message}` });
    return;
  }

  const payload = StudioSavePayloadSchema.safeParse(parsed);
  if (!payload.success) {
    json(res, 400, {
      error: "payload does not match the studio save schema",
      issues: payload.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`),
    });
    return;
  }

  const { state, shapes } = payload.data;
  if (state.definitionVersion !== THEATRE_STATE_DEFINITION_VERSION) {
    json(res, 400, {
      error:
        `state has definitionVersion ${JSON.stringify(state.definitionVersion)}; this ` +
        `@theatre/core writes ${JSON.stringify(THEATRE_STATE_DEFINITION_VERSION)}. A mismatched ` +
        `file loads at its initial values with no error, so the rig would be silently absent.`,
    });
    return;
  }

  writeJson(STATE_FILE, state);
  // The hint rides back in on every write. The file is the thing the human opens
  // when a save misbehaves, and zod strips unknown keys on the way in — without
  // this, the first save deletes the only in-file explanation of the format.
  writeJson(SHAPES_FILE, { _how: SHAPES_FILE_HINT, ...shapes });
  invalidate(server);
  json(res, 200, {
    ok: true,
    savedAt: savedAt(),
    sheets: Object.keys(state.sheetsById).length,
    // Shapes now live in per-sheet buckets; the readout wants one number.
    shapes: countSavedShapes(shapes),
    files: [STATE_FILE, SHAPES_FILE],
  });
}

export function studioSavePlugin(): Plugin {
  return {
    name: "astro-studio-save",
    apply: "serve",

    configureServer(server) {
      // Mounted at the root, not under a prefix: connect's `use(path, fn)` strips
      // that prefix off `req.url`, so a handler that compares the mounted path
      // against the full endpoint never matches and the request falls through to
      // the SPA fallback — which answers index.html to a POST, and reads as the
      // endpoint being broken. Root-mounted, `req.url` is the whole path.
      server.middlewares.use((req, res, next) => {
        void handle(req, res, next, server);
      });
    },
  };
}

/** Exported for the tests and for `vp dev` debugging. */
export const STUDIO_SAVE_FILES = { state: STATE_FILE, shapes: SHAPES_FILE };
