/**
 * The contract for a *view*: one self-contained HTML document written by the
 * coding agent and rendered in a sandboxed iframe on the user's screen.
 *
 * Shared between the Worker (which enforces it) and the SPA (which renders
 * against it), so keep this file runtime-agnostic — no Node, DOM, or Workers
 * globals.
 *
 * Three layers hold the freedom in:
 *
 *   1. `publish_view` is the only way out of the agent loop, so the Worker
 *      never has to dig an artifact out of prose.
 *   2. `checkViewHtml` is a static gate the agent can call itself and fix
 *      against — its problem list is the agent's feedback signal.
 *   3. The iframe renders with `sandbox="allow-scripts"` and *no*
 *      `allow-same-origin`, which puts the document on an opaque origin: no
 *      parent DOM, no cookies, no storage. `sealViewHtml` adds the CSP that
 *      closes the last hole, network access.
 */

import type { UIMessage } from "ai";

/**
 * One document, so the whole thing has to fit in a prompt on the next edit.
 *
 * The prompt is what bounds it, not the model's output cap: `VIEW_MODEL_ID`
 * can emit far more than 96 KB in one `write_view`, but every edit re-sends
 * the whole page as `currentHtml`.
 */
export const MAX_VIEW_HTML_BYTES = 96 * 1024;

/**
 * Injected by the Worker rather than written by the agent — one less rule for
 * the model to get right, and it cannot be talked out of it. `'unsafe-inline'`
 * looks alarming and is not: inline script *is* the artifact, and `default-src
 * 'none'` means that script can reach nothing outside its own document.
 */
export const VIEW_CSP =
  "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; img-src data:; font-src data:";

/** The one message shape the parent will listen to. Anything else is dropped. */
export const VIEW_EVENT_TYPE = "astro:event";

/**
 * The state-carry channel. A `srcDoc` swap reloads the frame and would reset a
 * running game, so a page posts `{ type, state }` whenever its state changes;
 * the parent keeps only the latest and posts the same shape back into the new
 * frame once it loads. The page restores defensively — saved state from a
 * *different* page arrives through the same channel, and validating it is the
 * page's job because only the page knows its own shape.
 */
export const VIEW_STATE_TYPE = "astro:state";

/**
 * Caps what a sandboxed page can make the parent hold. Well above any sane
 * game state, well below a memory lever.
 */
export const MAX_VIEW_STATE_BYTES = 32 * 1024;

export type View = { title: string; html: string; summary: string };

/** What a view is allowed to tell the voice agent about. */
export type ViewEvent = { name: string; value?: string | number | boolean };

/**
 * What the coding agent is doing right now. Built from the agent's lifecycle
 * callbacks, so it reports what actually happened rather than a guess at
 * elapsed time. `fixing` carries the same problem list the agent is reading —
 * one signal, two consumers.
 */
export type ViewProgress =
  | { phase: "writing" }
  | { phase: "editing" }
  | { phase: "checking" }
  | { phase: "fixing"; problems: string[] };

/** One line of status for the user, from the same data. */
export function describeProgress(progress: ViewProgress): string {
  switch (progress.phase) {
    case "writing":
      return "Writing the page…";
    case "editing":
      return "Editing the page…";
    case "checking":
      return "Checking it…";
    case "fixing":
      return `Fixing ${progress.problems.length} problem${
        progress.problems.length === 1 ? "" : "s"
      }…`;
  }
}

/**
 * The stream from `/api/view`, typed end to end: `data-progress` is transient
 * (status, not history), `data-view` is the finished document.
 *
 * `UIMessage`'s first parameter is metadata, which this stream has none of.
 */
export type ViewUIMessage = UIMessage<never, { progress: ViewProgress; view: View }>;

const EXTERNAL_URL_PATTERNS: [RegExp, string][] = [
  [
    /(?:src|href)\s*=\s*["']?(?:https?:)?\/\//i,
    "loads something over the network with src= or href=",
  ],
  [/url\(\s*["']?(?:https?:)?\/\//i, "loads something over the network with url()"],
  [/@import\b/i, "uses @import"],
  [/\bfetch\s*\(/, "calls fetch()"],
  [/\bXMLHttpRequest\b/, "uses XMLHttpRequest"],
  [/\bWebSocket\b/, "opens a WebSocket"],
  [/\bEventSource\b/, "opens an EventSource"],
  [/\bnavigator\s*\.\s*sendBeacon\b/, "calls navigator.sendBeacon"],
  [/<(?:iframe|object|embed)\b/i, "embeds a nested frame"],
];

/**
 * The static gate. Returns human-readable problems — phrased as instructions
 * the model can act on, because this list is handed straight back to it.
 *
 * Deliberately short: the sandbox is the real boundary, so this only has to
 * catch the things that would make a view *silently* fail (a blocked font, a
 * stripped image) rather than everything a document could theoretically do.
 */
export function checkViewHtml(html: string): string[] {
  const problems: string[] = [];

  if (html.trim() === "") {
    problems.push("The document is empty.");
    return problems;
  }

  const bytes = new TextEncoder().encode(html).length;
  if (bytes > MAX_VIEW_HTML_BYTES) {
    problems.push(
      `The document is ${Math.round(bytes / 1024)}KB, over the ${Math.round(
        MAX_VIEW_HTML_BYTES / 1024,
      )}KB limit. Make it smaller.`,
    );
  }

  for (const [pattern, description] of EXTERNAL_URL_PATTERNS) {
    if (pattern.test(html)) {
      problems.push(
        `The document ${description}. Nothing can leave this page — inline every ` +
          `asset, use system fonts, and draw images with SVG, canvas, or CSS.`,
      );
    }
  }

  /**
   * `\${x}` inside a template literal is the literal text "${x}", not the value
   * of x — so the page renders its own source. Models reach for this escape
   * when they are thinking about the JSON they are writing the code into, and
   * the result runs without erroring, which is what makes it worth catching
   * here rather than leaving for someone to notice on screen.
   */
  if (html.includes("\\${")) {
    problems.push(
      "The document escapes template placeholders as `\\${...}`, which renders " +
        'the literal text "${...}" instead of the value. Write `${...}`.',
    );
  }

  return problems;
}

/**
 * Adds the CSP the sandbox cannot set on its own. A `<meta http-equiv>` policy
 * only applies to content that parses after it, so it goes as early as the
 * document allows: inside `<head>` if there is one, otherwise ahead of
 * everything, where the parser will hoist it into the implied head.
 */
export function sealViewHtml(html: string): string {
  const meta = `<meta http-equiv="Content-Security-Policy" content="${VIEW_CSP}">`;

  /**
   * Idempotent on purpose: an edited page starts from the *sealed* document
   * the client sent back, so re-sealing on every publish would stack a meta
   * tag per edit.
   */
  if (html.includes('http-equiv="Content-Security-Policy"')) return html;

  const head = /<head\b[^>]*>/i.exec(html);
  if (head != null) {
    const at = head.index + head[0].length;
    return html.slice(0, at) + meta + html.slice(at);
  }

  const doctype = /<!doctype html>/i.exec(html);
  if (doctype != null) {
    const at = doctype.index + doctype[0].length;
    return html.slice(0, at) + meta + html.slice(at);
  }

  return meta + html;
}

/**
 * The parent-side allowlist for `postMessage`. A view runs on an opaque origin,
 * so `event.origin` is the useless string "null" and identity has to come from
 * the frame's own window — the caller checks that. This checks the shape.
 */
export function parseViewEvent(data: unknown): ViewEvent | null {
  if (typeof data !== "object" || data === null) return null;

  const { type, name, value } = data as { type?: unknown; name?: unknown; value?: unknown };
  if (type !== VIEW_EVENT_TYPE) return null;
  if (typeof name !== "string" || name.trim() === "" || name.length > 100) return null;

  if (typeof value === "string") return { name, value: value.slice(0, 500) };
  if (typeof value === "number" && Number.isFinite(value)) return { name, value };
  if (typeof value === "boolean") return { name, value };

  return { name };
}

/**
 * The parent-side check for `astro:state` messages. The state itself is
 * opaque — the parent stores it and posts it back, never reads it — so the only
 * questions are "is this the reserved shape" and "is it small and plain enough
 * to hold". `JSON.stringify` answers both: it bounds the size and rejects
 * anything that would not survive the round trip (functions, cycles, DOM
 * nodes a page might try to smuggle).
 */
export function parseViewState(data: unknown): { state: unknown } | null {
  if (typeof data !== "object" || data === null) return null;

  const { type, state } = data as { type?: unknown; state?: unknown };
  if (type !== VIEW_STATE_TYPE) return null;
  if (state === undefined) return null;

  try {
    const serialized = JSON.stringify(state);
    if (serialized === undefined || serialized.length > MAX_VIEW_STATE_BYTES) return null;
  } catch {
    return null;
  }

  return { state };
}
