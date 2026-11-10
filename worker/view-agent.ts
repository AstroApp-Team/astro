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
  sealViewHtml,
  VIEW_EVENT_TYPE,
  VIEW_STATE_TYPE,
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

const instructions = `You build a small web page that appears on a user's screen while they talk to a
voice assistant. The assistant relays what the user wants; you make it work, fast. The user
watches the page appear as you type it and is waiting on you — every character costs them time.

Build the SIMPLEST page that does what was asked, and nothing more. No decoration, animation,
theming, icons, comments, or features nobody asked for. If the request is vague, pick the
plainest reasonable reading. The user will ask for changes if they want them — do not
anticipate them.

Tools — call one or more every turn:

- write_view — replace the whole page. For a new page, or a request that obsoletes the old one.
- edit_view — replace one exact snippet of the page (it must appear exactly once, or pass
  replaceAll). For any change to an existing page: a small edit keeps a running game alive,
  a rewrite throws it away. Make every edit a change needs in the same turn, as parallel calls.

Your work goes on screen the moment each call lands. The run ends as soon as a turn leaves the
page passing its checks; if a check fails, the result tells you what to fix.

Write each page in this order, so it is usable as early as possible while it streams in:
<title>, then a short <style> only if the layout needs it, then the markup, then ONE <script> at
the end of <body> with the logic.

Styling is already done for you: the page gets a dark background, readable system font, padding,
and sized, rounded buttons and inputs. Only add CSS for layout (grid, flex, sizes). It renders
in a sandboxed iframe that fills the screen, often phone-width.

Rules:
- One self-contained HTML document. No imports, libraries, external URLs, or network of any
  kind. Draw with SVG, canvas, or CSS.
- No storage: localStorage, sessionStorage, indexedDB and cookies all throw here. Keep values
  in variables.
- Plain JavaScript. Do not escape template placeholders: write \`\${value}\`, never \`\\\${value}\`.

Only if it matters for the request:
- To tell the voice assistant the user did something meaningful (not every click or move):
    parent.postMessage({ type: "${VIEW_EVENT_TYPE}", name: "select", value: "Q3" }, "*")
- A page with progress worth keeping across your edits (a game's score, board, positions)
  keeps it in one JSON-serializable object, posts it whenever it changes, and restores it on
  startup — validating it, since it may come from an older version of the page:
    parent.postMessage({ type: "${VIEW_STATE_TYPE}", state }, "*")
    addEventListener("message", (e) => { if (e.data?.type === "${VIEW_STATE_TYPE}") restore(e.data.state) })`;

type BuildOptions = {
  model: LanguageModel;
  request: string;
  currentHtml?: string | undefined;
  /** Status for the user, derived from the loop's lifecycle. */
  onProgress: (progress: ViewProgress) => void;
  /**
   * The sealed page as it stands mid-run: a half-written document while
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
  request,
  currentHtml,
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
            onDraft(sealViewHtml(html));
          }
        },
        execute: ({ html }, { toolCallId }) => {
          streaming.delete(toolCallId);
          draft = html;
          onDraft(sealViewHtml(draft));
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
          onDraft(sealViewHtml(draft));
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
     * The portable reasoning knob (translated per provider). None: thinking
     * happens before the first character reaches the screen, and measured on
     * a calculator, "low" still spent 4–40 s thinking (wildly variable) for a
     * page that takes seconds to write.
     */
    reasoning: "none",

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
    prompt:
      currentHtml == null || currentHtml === ""
        ? `The screen is empty. ${request}`
        : `This page is on the user's screen right now:\n\n` +
          `\`\`\`html\n${currentHtml}\n\`\`\`\n\n` +
          `The request is most likely a change to it — use edit_view unless a rewrite is ` +
          `clearly better. ${request}`,
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

  return { title: viewTitle(draft), html: sealViewHtml(draft) };
}
