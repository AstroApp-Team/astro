/**
 * The contract for a *view*: one self-contained HTML document written by the
 * coding agent and rendered in a sandboxed iframe on the user's screen.
 *
 * Shared between the Worker (which enforces it) and the SPA (which renders
 * against it), so keep this file runtime-agnostic — no Node, DOM, or Workers
 * globals.
 *
 * Two layers give the page its shape — not its powers:
 *
 *   1. The page only leaves the agent loop through its tools (`write_view`,
 *      `edit_view`), so the Worker never has to dig an artifact out of prose.
 *   2. `checkViewHtml` runs on every tool result, so its problem list is the
 *      agent's feedback signal — and a run only ends on a page that passes.
 *
 * What a page *may do* is deliberately broad — network, CDN libraries,
 * storage, devices — and lives in `VIEW_SANDBOX` (src/lib/seal-view.ts). A
 * request the page cannot fulfil is a broken promise from the voice assistant,
 * so nothing here exists to fence the page in.
 *
 * Everything that crosses the wire is the page's own source — sealing happens
 * in the browser, right before a document becomes a `srcdoc`.
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
 * An uncaught error inside a live page, posted by the runtime. The app keeps
 * the last few and hands them to the next build, so the coding agent hears
 * about bugs that only show up once someone uses the page.
 */
export const VIEW_ERROR_TYPE = "astro:error";

/**
 * The runtime's report from the hidden check frame: the problems it found
 * rendering the page and running every no-argument action once.
 */
export const VIEW_CHECK_TYPE = "astro:check";

/**
 * Caps what a sandboxed page can make the parent hold. Well above any sane
 * game state, well below a memory lever.
 */
export const MAX_VIEW_STATE_BYTES = 32 * 1024;

export type View = { title: string; html: string };

/** The page's own `<title>`, so the agent names a page by writing it once. */
export function viewTitle(html: string): string {
  const title = /<title[^>]*>([^<]*)<\/title>/i.exec(html)?.[1]?.trim();
  return title != null && title !== "" ? title.slice(0, 80) : "Page";
}

/**
 * The page's spec: the `<!-- spec ... -->` comment every page carries, one
 * `- item` per feature the user asked for. It is how intent survives across
 * requests — the coding agent never hears the conversation, so without it the
 * page's current code is its only record of what was wanted, bugs included.
 * Returns null when the page has no spec block.
 */
export function viewSpec(html: string): string[] | null {
  const block = /<!--\s*spec\b([\s\S]*?)-->/i.exec(html)?.[1];
  if (block == null) return null;
  return block
    .split("\n")
    .map((line) => /^\s*-\s+(.+?)\s*$/.exec(line)?.[1])
    .filter((item): item is string => item != null);
}

/** Spec items in `before` that `after` no longer lists — what an edit dropped. */
export function removedSpecItems(before: string, after: string): string[] {
  const kept = new Set(viewSpec(after) ?? []);
  return (viewSpec(before) ?? []).filter((item) => !kept.has(item));
}

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
  | { phase: "fixing"; problems: string[] };

/** One line of status for the user, from the same data. */
export function describeProgress(progress: ViewProgress): string {
  switch (progress.phase) {
    case "writing":
      return "Writing the page…";
    case "editing":
      return "Editing the page…";
    case "fixing":
      return `Fixing ${progress.problems.length} problem${
        progress.problems.length === 1 ? "" : "s"
      }…`;
  }
}

/**
 * The stream from `/api/view`, typed end to end: `data-progress` is transient
 * (status, not history); `data-draft` is the sealed page as it stands mid-run —
 * half-written while `write_view` streams, patched after each `edit_view`;
 * `data-view` is the finished document; and `data-cost` is one step's bill,
 * sent as each step ends so a build that fails is still paid for on screen.
 *
 * A draft is shown but never sent back as `currentHtml`: only a `data-view`
 * passed the checks, so a run that fails leaves the last good page to edit.
 *
 * `UIMessage`'s first parameter is metadata, which this stream has none of.
 */
export type ViewUIMessage = UIMessage<
  never,
  { progress: ViewProgress; draft: { html: string }; view: View; cost: { usd: number } }
>;

/**
 * The static gate. Returns human-readable problems — phrased as instructions
 * the model can act on, because this list is handed straight back to it.
 *
 * Deliberately short: it only catches what makes a page silently wrong or
 * structurally tangled, never what a page is allowed to do.
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

  const spec = viewSpec(html);
  if (spec == null || spec.length === 0) {
    problems.push(
      "The page has no spec. Right after <title>, add a `<!-- spec` comment with one " +
        "`- item` line per feature the user has asked for, and keep it current.",
    );
  }

  /**
   * The runtime owns the screen and both message channels. A page that writes
   * HTML into the DOM or posts its own messages is back to the shape that made
   * pages fall apart as they grew — two sources of truth for the screen — so
   * it is caught here, where it costs one fix, not after the edits pile up.
   */
  if (/\b(?:innerHTML|outerHTML|insertAdjacentHTML)\b|\bdocument\s*\.\s*write\b/.test(html)) {
    problems.push(
      "The page writes HTML into the DOM directly. Everything on screen comes from " +
        "Astro.view(...); change state in an action and let the view re-render.",
    );
  }
  /** The page's own channel to the app — a Web Worker's `postMessage` is fine. */
  if (
    /\b(?:parent|top|opener)\s*\.\s*postMessage\b/.test(html) ||
    /(?:^|[^.\w]|\b(?:window|self)\s*\.\s*)addEventListener\(\s*["']message["']/.test(html)
  ) {
    problems.push(
      "The page handles messages itself. The runtime already saves and restores " +
        "Astro.state; to tell the voice assistant something, call Astro.emit(name, value).",
    );
  }
  if (/<script\b/i.test(html) && !/\bAstro\s*\.\s*view\s*\(/.test(html)) {
    problems.push(
      "The page has a script but no Astro.view(...). Put state in Astro.state, the " +
        "screen in Astro.view, and changes in Astro.actions.",
    );
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
