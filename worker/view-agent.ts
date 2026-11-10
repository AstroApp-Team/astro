import {
  createGateway,
  isStepCount,
  parsePartialJson,
  tool,
  ToolLoopAgent,
  type LanguageModel,
  type StopCondition,
  type ToolSet,
} from "ai";
import { z } from "zod";

import {
  checkViewHtml,
  MAX_VIEW_HTML_BYTES,
  viewTitle,
  type View,
  type ViewProgress,
} from "../shared/view.ts";

/**
 * Claude Haiku 5.5, chosen because its provider *streams tool arguments*: the
 * page reaches the screen while `write_view` is still being written. DeepSeek
 * V4.1 Flash (the previous model) is served from Baseten, which buffers a tool
 * call's whole input into one delta, so nothing could render until it was done.
 *
 * Measured through the Gateway with `reasoning: "none"` and the prompt below:
 *
 *   | request          | Haiku 5.5: first paint / done / cost | DeepSeek -fast: done / cost |
 *   | calculator       | 1.2 s / 4.6 s / $0.0007              | 1.2 s / $0.0026             |
 *   | snake            | 1.0 s / 4.9 s / $0.0008              | 2.3 s / $0.0039             |
 *   | falling blocks   | 1.0 s / 9.3 s / $0.0015              | 6.1 s / $0.0081             |
 *   | edit (4 changes) | 2.7 s / $0.0006                      | 5.7 s / $0.0038             |
 *
 * At $0.10→$0.50 per M tokens it is also the cheapest of the three (DeepSeek
 * is $0.30→$1.20, `-fast` twice that). Re-measure before switching: whether
 * tool input streams is a property of the serving provider, not the model.
 */
export const VIEW_MODEL_ID = "anthropic/claude-haiku-5.5";

/**
 * The coding agent's model, reached through the same AI Gateway key that mints
 * the voice token — no second credential to manage.
 *
 * Kept separate from `buildView` so the loop takes a model rather than a
 * secret: that is the seam `MockLanguageModelV4` plugs into, and it is the only
 * way to test the loop without paying a provider to be non-deterministic.
 */
export function viewModel(apiKey: string): LanguageModel {
  return createGateway({ apiKey })(VIEW_MODEL_ID);
}

/**
 * The strong model behind `rebuild_view`: the voice model calls it when a page
 * has grown tangled, and it rewrites the whole page from its spec. Rare and
 * allowed to be slow, so it is chosen for getting the whole app right in one
 * pass, not for first paint.
 *
 * Measured on a five-request finance app Haiku had built (3.5 KB, nine spec
 * items, two of them duplicates), rebuilt at `REBUILD_REASONING`:
 *
 *   | model          | done   | cost    | runtime check | spec          |
 *   | Sonnet 5.5     | 7.7 s  | $0.024  | passes        | merged dupes  |
 *   | Opus 5.5       | 14.2 s | $0.053  | passes        | merged dupes  |
 *
 * Same page, half the time and cost. Re-measure on a bigger app before
 * switching up.
 */
export const REBUILD_MODEL_ID = "anthropic/claude-sonnet-5.5";

export function rebuildModel(apiKey: string): LanguageModel {
  return createGateway({ apiKey })(REBUILD_MODEL_ID);
}

/**
 * Some thinking pays for itself on a rewrite: the model has to hold every
 * spec item and the state shape at once. The everyday loop stays at "none".
 */
const REBUILD_REASONING = "low";

/** `edit` is the everyday loop on the fast model; `rebuild` is the rewrite. */
export type BuildMode = "edit" | "rebuild";

/**
 * A healthy run is one step: write (or edit), pass, done. The cap exists so a
 * model that keeps failing its checks stops burning tokens.
 */
const MAX_STEPS = 8;

/**
 * How often a half-written page is re-sent while `write_view` streams. Each
 * one reloads the iframe and re-sends the whole document so far, so this
 * trades smoothness against bytes on the wire and reload flicker.
 */
const DRAFT_INTERVAL_MS = 300;

const instructions = `You build a small web app that appears on a user's screen while they talk to a
voice assistant. The assistant relays what the user wants; you make it work, fast. The user
watches the page appear as you type it and is waiting on you — every character costs them time.

Build the SIMPLEST page that does what was asked, and nothing more. No decoration, animation,
theming, icons, comments, or features nobody asked for. If the request is vague, pick the
plainest reasonable reading. The user will ask for changes if they want them — do not
anticipate them.

Tools — call one or more every turn:

- write_view — replace the whole page. For a new page, or a request that obsoletes the old one.
- edit_view — replace one exact snippet of the page (it must appear exactly once, or pass
  replaceAll). For any change to an existing page. Make every edit a change needs in the same
  turn, as parallel calls.

Your work goes on screen the moment each call lands. The run ends as soon as a turn leaves the
page passing its checks; if a check fails, the result tells you what to fix.

Every page runs on the Astro runtime, which is already loaded. Write it in exactly this shape
and order — separate <script>s, so the page shows as soon as its view arrives:

<title>Tip calculator</title>
<!-- spec
- Enter a bill amount and pick a 10, 15 or 20% tip
- Shows the tip and the total
-->
<style>.row{display:flex;gap:8px}</style>
<script>Astro.state({ bill: 0, pct: 15 })</script>
<script>Astro.view((s, a) => html\`
  <input type="number" value=\${s.bill} onInput=\${(e) => a.setBill(e.target.value)} />
  <div class="row">\${[10, 15, 20].map((p) => html\`<button key=\${p} onClick=\${() => a.setPct(p)}>\${p}%</button>\`)}</div>
  <p>Tip \${(s.bill * s.pct / 100).toFixed(2)} · Total \${(s.bill * (1 + s.pct / 100)).toFixed(2)}</p>
\`)</script>
<script>Astro.actions({
  setBill(s, value) { s.bill = Number(value) || 0 },
  setPct(s, pct) { s.pct = pct },
})</script>

- Astro.state: ONE JSON object with everything the app knows. It survives your edits on its
  own. Keep its keys stable: add keys rather than renaming them.
- Astro.view: the whole screen as a function of state, in html\`\` (htm — JSX-like, with
  \${...} for values and handlers: onClick, onInput, class=, key= on list items). Never read or
  write the DOM yourself; a value that changes belongs in state.
- Astro.actions: every change to state, as name(s, ...args) that mutates s. The screen
  re-renders after each one. Handlers call them: onClick=\${a.reset} or onClick=\${() => a.add(x)}.
  Actions with no arguments are run once from the starting state to test the page.
- Astro.start((a) => setInterval(a.tick, 100)) — timers and game loops; runs once on load.
- Astro.after((s, root) => ...) — only for drawing on a canvas, after every render.
- Astro.emit("select", "Q3") — tell the voice assistant the user did something meaningful
  (not every click or move).

The spec is the record of every feature the user has asked for, in plain words — it is how
the next request knows what must keep working. Add an item when a request adds a feature,
reword it when one changes, and remove one ONLY when the request explicitly asks for that.

Styling is already done for you: the page gets a dark background, readable system font, padding,
and sized, rounded buttons and inputs. Only add CSS for layout (grid, flex, sizes). It renders
in a sandboxed iframe that fills the screen, often phone-width.

Rules:
- Libraries are welcome when they were asked for or save real work (3D, charts, maps, physics).
  Load them from a CDN with a pinned version; nothing is preloaded but the Astro runtime. A
  global build goes in its own tag before the scripts that use it:
  <script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.1"></script>. An ES-module-only library
  (Three.js, for one) is imported inside a module script that also does the work:
  <script type="module">import * as THREE from "https://esm.sh/three@0.170.0"; Astro.start(...)</script>.
- The page may use fetch (public APIs that allow CORS), localStorage, the camera, mic and
  location, fullscreen, and alert/confirm. Astro.state already survives your edits; use
  localStorage only for something that must outlive the app being closed.
- Plain JavaScript. Do not escape template placeholders: write \`\${value}\`, never \`\\\${value}\`.`;

/**
 * Prepended to the request in `rebuild` mode. The current page goes along as
 * reference — it is the reason for the rebuild, not a template.
 */
const rebuildBrief = (reason: string) =>
  `This app has grown tangled through many small edits, and the voice assistant asked for a ` +
  `clean rewrite. Why: ${reason}\n\n` +
  `Rewrite it from scratch with ONE write_view, built from its spec. The code below is ` +
  `reference only — reuse what works, restructure freely. When you are done, every spec ` +
  `item must work; keep the spec's items, rewording only to resolve a contradiction. Keep ` +
  `Astro.state's keys and value shapes so the user's data carries over; if a shape must ` +
  `change, add Astro.restore((saved, initial) => state) to migrate it.`;

type BuildOptions = {
  model: LanguageModel;
  /** Defaults to `edit`. */
  mode?: BuildMode;
  request: string;
  currentHtml?: string | undefined;
  /** Errors the page on screen threw while the user used it, newest last. */
  pageErrors?: string[] | undefined;
  /** Status for the user, derived from the loop's lifecycle. */
  onProgress: (progress: ViewProgress) => void;
  /**
   * The page as it stands mid-run: a half-written document while
   * `write_view` streams, the patched one after each `edit_view`. It has not
   * necessarily passed the checks — show it, do not keep it.
   */
  onDraft: (html: string) => void;
  /**
   * What each step cost, in USD, as the Gateway billed it. Called per step
   * rather than once at the end because a run that fails still spent money.
   */
  onCost: (usd: number) => void;
};

/**
 * The Gateway reports every call's actual charge in its provider metadata —
 * the invoice figure, so nothing here has to know the model's rates. It is a
 * decimal string; anything else (a mock, another provider) counts as unknown.
 */
export function gatewayCostUsd(providerMetadata: unknown): number | null {
  const cost = (providerMetadata as { gateway?: { cost?: unknown } } | undefined)?.gateway?.cost;
  if (typeof cost !== "string" && typeof cost !== "number") return null;

  const usd = Number(cost);
  return Number.isFinite(usd) && usd >= 0 ? usd : null;
}

/** Both tools answer in this shape, so the loop and the progress line read one thing. */
type ToolOutcome = { ok: true } | { ok: false; problems: string[] };

function outcome(problems: string[]): ToolOutcome {
  return problems.length === 0 ? { ok: true } : { ok: false, problems };
}

/**
 * Runs the loop and returns the finished document.
 *
 * The loop owns a mutable draft: `write_view` replaces it and `edit_view`
 * patches it, so the model never re-emits the parts of the page it is not
 * changing. There is no separate publish step — that was a whole extra model
 * round-trip on every run. Instead every tool result carries the checks, and
 * the run stops on the first step that leaves a passing draft.
 *
 * Every `execute` here is deliberately synchronous: if the model emits several
 * `edit_view` calls in one step, sync executes run to completion in call
 * order, so edits cannot interleave.
 */
export async function buildView({
  model,
  mode = "edit",
  request,
  currentHtml,
  pageErrors,
  onProgress,
  onDraft,
  onCost,
}: BuildOptions): Promise<View> {
  let draft = currentHtml ?? "";

  /**
   * Ends the run when the last step changed the page, every call in it
   * succeeded, and the draft as a whole passes. A failed call — a missed
   * edit, a failing write, input the schema rejected — keeps the loop going
   * with the problem in front of the model.
   */
  const passed: StopCondition<ToolSet> = ({ steps }) => {
    const last = steps.at(-1);
    if (last == null || last.toolResults.length === 0) return false;
    if (last.content.some((part) => part.type === "tool-error")) return false;
    if (last.toolResults.some((result) => (result.output as ToolOutcome).ok !== true)) {
      return false;
    }
    return checkViewHtml(draft).length === 0;
  };

  /**
   * `write_view` input, as it streams, per call. Removed when the call
   * executes, so a parse that resolves late cannot paint over the real page.
   */
  const streaming = new Map<string, { json: string; sentAt: number }>();

  const agent = new ToolLoopAgent({
    model,
    instructions,
    tools: {
      write_view: tool({
        description:
          "Replace the entire page. For a new page, or a rewrite the request genuinely calls " +
          "for — prefer edit_view for changes. Shown to the user as it streams.",
        inputSchema: z.object({
          html: z.string().max(MAX_VIEW_HTML_BYTES).describe("The complete HTML document."),
        }),
        onInputStart: ({ toolCallId }) => {
          streaming.set(toolCallId, { json: "", sentAt: 0 });
          onProgress({ phase: "writing" });
        },
        /**
         * Re-parses the whole input so far rather than decoding deltas: the
         * html is a JSON string, so a delta can end mid-escape, and the
         * repair in `parsePartialJson` handles that. Throttled, so the cost is
         * a few parses a second.
         */
        onInputDelta: async ({ toolCallId, inputTextDelta }) => {
          const input = streaming.get(toolCallId);
          if (input == null) return;

          input.json += inputTextDelta;
          const now = Date.now();
          if (now - input.sentAt < DRAFT_INTERVAL_MS) return;
          input.sentAt = now;

          const { value } = await parsePartialJson(input.json);
          const html = (value as { html?: unknown } | undefined)?.html;
          if (typeof html === "string" && html !== "" && streaming.has(toolCallId)) {
            onDraft(html);
          }
        },
        execute: ({ html }, { toolCallId }) => {
          streaming.delete(toolCallId);
          draft = html;
          onDraft(draft);
          return outcome(checkViewHtml(draft));
        },
      }),

      edit_view: tool({
        description:
          "Replace one exact text snippet of the page with another. oldText must match the " +
          "page exactly and, unless replaceAll is set, appear exactly once.",
        inputSchema: z.object({
          oldText: z.string().min(1).describe("Exact text to find in the page."),
          newText: z.string().describe("Text to replace it with."),
          replaceAll: z.boolean().optional().describe("Replace every occurrence."),
        }),
        onInputStart: () => onProgress({ phase: "editing" }),
        execute: ({ oldText, newText, replaceAll }): ToolOutcome => {
          if (draft === "") {
            return outcome(["The page is empty — there is nothing to edit. Use write_view."]);
          }

          const occurrences = draft.split(oldText).length - 1;
          if (occurrences === 0) {
            return outcome([
              "oldText was not found in the page. It must match exactly, including " +
                "whitespace. Re-read the document and try a snippet that is really there.",
            ]);
          }
          if (occurrences > 1 && replaceAll !== true) {
            return outcome([
              `oldText appears ${occurrences} times. Include more surrounding text to pin ` +
                "down one occurrence, or pass replaceAll: true to change every one.",
            ]);
          }

          draft =
            replaceAll === true
              ? draft.replaceAll(oldText, newText)
              : draft.replace(oldText, newText);
          onDraft(draft);
          return outcome(checkViewHtml(draft));
        },
      }),
    },
    /**
     * With `required`, the model cannot answer in prose — every step is a tool
     * call, so the run either passes or hits the step cap.
     */
    toolChoice: "required",
    stopWhen: [isStepCount(MAX_STEPS), passed],
    /**
     * The portable reasoning knob (translated per provider). None for edits:
     * thinking happens before the first character reaches the screen, and
     * measured on a calculator, "low" still spent 4–40 s thinking (wildly
     * variable) for a page that takes seconds to write.
     */
    reasoning: mode === "rebuild" ? REBUILD_REASONING : "none",

    /** `fixing` reuses the checks' problem lists verbatim. */
    onToolExecutionEnd: ({ toolOutput }) => {
      if (toolOutput.type !== "tool-result") return;
      const result = toolOutput.output as ToolOutcome | undefined;
      if (result?.ok === false) onProgress({ phase: "fixing", problems: result.problems });
    },
    onStepEnd: ({ providerMetadata }) => {
      const usd = gatewayCostUsd(providerMetadata);
      if (usd != null) onCost(usd);
    },
  });

  /**
   * Streamed, not generated: `onInputDelta` only fires on a stream, and it is
   * what puts a page on screen while it is still being written.
   */
  const result = await agent.stream({
    prompt: buildPrompt({ mode, request, currentHtml, pageErrors }),
  });

  for await (const part of result.fullStream) {
    if (part.type === "error") throw part.error;
  }

  const steps = await result.steps;
  const touched = steps.some((step) => step.toolResults.length > 0);
  const problems = checkViewHtml(draft);

  if (!touched || problems.length > 0 || !passed({ steps })) {
    throw new Error(
      `The coding agent stopped after ${steps.length} steps without a working page` +
        (problems.length > 0 ? `: ${problems.join(" ")}` : "."),
    );
  }

  return { title: viewTitle(draft), html: draft };
}

/** The one user message a run starts from. Exported for the tests. */
export function buildPrompt({
  mode,
  request,
  currentHtml,
  pageErrors,
}: Pick<BuildOptions, "request" | "currentHtml" | "pageErrors"> & { mode: BuildMode }): string {
  if (currentHtml == null || currentHtml === "") return `The screen is empty. ${request}`;

  const page = `This page is on the user's screen right now:\n\n\`\`\`html\n${currentHtml}\n\`\`\`\n\n`;
  const errors =
    pageErrors != null && pageErrors.length > 0
      ? `While the user was using it, the page threw:\n${pageErrors
          .map((error) => `- ${error}`)
          .join("\n")}\n\n`
      : "";

  if (mode === "rebuild") return page + errors + rebuildBrief(request);

  return (
    page +
    errors +
    `The request is most likely a change to it — use edit_view unless a rewrite is clearly ` +
    `better, or the page does not use Astro.view yet. ${request}`
  );
}
