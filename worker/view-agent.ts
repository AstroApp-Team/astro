import {
  createGateway,
  isStepCount,
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
  type View,
  type ViewProgress,
} from "../shared/view.ts";

/**
 * DeepSeek V4.1 Flash, pinned to its 1017 snapshot so the loop's behaviour
 * does not move under us when the floating `deepseek-v4.1-flash` alias does.
 * It needs paid Gateway credits — the free tier answers 403
 * `RestrictedModelsError` — and replaced `moonshotai/kimi-k2.7-code`, the best
 * coder the free tier allowed (see `docs/free-tier-coding-models.md`).
 *
 * The Gateway serves it from Baseten with tool calling, a 1M context and a
 * 262k output cap, at $0.30→$1.20 per M tokens and $0.007 per M on a cache
 * hit. The `-fast` variant is twice the price.
 */
export const VIEW_MODEL_ID = "deepseek/deepseek-v4.1-flash-1017";

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
 * Enough room to write (or make several small edits), fail the publish checks,
 * fix, and publish. The cap exists so a model that keeps failing stops burning
 * tokens, not because a healthy run needs anywhere near this many.
 */
const MAX_STEPS = 12;

const instructions = `You maintain a small, self-contained web page that appears on a user's screen
while they are having a *spoken* conversation with a voice assistant. The voice assistant
relays what the user asked for; you turn it into something worth looking at — and once a page
is up, you keep changing it live, while the user is using it.

You hold a working draft of the document. Three tools, and you must always be calling one:

- edit_view — replace one exact snippet of the draft with another. This is how you change a
  page that already exists: find the smallest string that pins down the spot (it must appear
  exactly once, or pass replaceAll) and swap it. Prefer several small edits over rewriting.
- write_view — replace the whole draft. For a brand-new page, or when the request genuinely
  obsoletes what is there.
- publish_view — put the current draft on the user's screen. It checks the draft and refuses
  to publish one that breaks the rules, handing you the problems so you can fix them and call
  it again. Nothing is visible to the user until you publish.

When the current document is shown to you, the request is usually a change to it: edit it.
The user is often mid-game — a small edit keeps their session alive, a rewrite throws it away.

Write ordinary JavaScript. In particular do not escape template placeholders: write \`\${value}\`,
never \`\\\${value}\` — the escaped form renders the literal text and the page shows its own source.

The page:

- is ONE HTML document. No build step, no imports, no libraries, no network of any kind.
  Inline every style and script. Use system fonts. Draw with SVG, canvas, or CSS.
- renders in a sandboxed iframe on an opaque origin, sized by its container. Make it fill the
  frame and hold up at phone width. Set an explicit background — do not assume the page
  behind it.
- reads well in dark and light. Pick one committed look and paint it yourself.
- should be genuinely nice to look at. This is the whole visible surface of the product for
  the moment it is up: real typographic hierarchy, real spacing, motion where motion helps.

The page may be interactive, and it can talk to the app in two ways — these are the only
channels; nothing else leaves the sandbox:

1. Tell the voice assistant something happened:

       parent.postMessage({ type: "${VIEW_EVENT_TYPE}", name: "select", value: "Q3" }, "*")

   'name' is a short event name, 'value' an optional string, number, or boolean. Use it when
   an interaction means something the assistant should be able to talk about. Do not post on
   every mousemove.

2. Survive your own updates. Publishing reloads the frame, and a game that resets every time
   you touch it feels broken. If the page has state a person would hate to lose (score, board,
   positions, progress), keep it in ONE plain JSON-serializable object and:

   - whenever it changes meaningfully, save it:
         parent.postMessage({ type: "${VIEW_STATE_TYPE}", state }, "*")
   - at startup, listen for the app handing it back, and resume from it:
         addEventListener("message", (e) => {
           if (e.data?.type === "${VIEW_STATE_TYPE}") restore(e.data.state)
         })

   The app stores only the latest state and replays it into the next version of the page.
   Restore defensively: the saved state may be from an older version of the page (or a
   different page entirely), so validate the fields you read and fall back to a fresh start
   if it does not fit. Keep the state shape stable across edits when you can.

Work quickly and take the direct path. If the request is vague, make a confident, specific
choice and publish it — the user can hear the result and ask for changes.`;

/**
 * Ends the run only on a page that actually passed. `hasToolCall` would stop on
 * any `publish_view`, including a rejected one — which is exactly the case the
 * loop needs to keep going for.
 */
const publishedSuccessfully: StopCondition<ToolSet> = ({ steps }) =>
  steps
    .at(-1)
    ?.toolResults.some(
      (result) =>
        result.toolName === "publish_view" &&
        (result.output as { published?: boolean } | undefined)?.published === true,
    ) === true;

type BuildOptions = {
  model: LanguageModel;
  request: string;
  currentHtml?: string | undefined;
  /**
   * Written straight into the response stream. It is the only window into a run
   * that otherwise looks like a stalled request for ten or twenty seconds.
   */
  onProgress: (progress: ViewProgress) => void;
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

/**
 * Runs the loop and returns the published document.
 *
 * The loop owns a mutable draft: `write_view` replaces it, `edit_view` patches
 * it, and `publish_view` — the only way out — takes no HTML at all, it
 * publishes the draft. The model never has to re-emit the parts of the page it
 * is not changing, which is what makes an edit take seconds instead of a
 * from-scratch rewrite.
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
  onCost,
}: BuildOptions): Promise<View> {
  let draft = currentHtml ?? "";

  const agent = new ToolLoopAgent({
    model,
    instructions,
    tools: {
      write_view: tool({
        description:
          "Replace the entire working draft. For a new page, or a rewrite that a request " +
          "genuinely calls for — prefer edit_view for changes.",
        inputSchema: z.object({
          html: z.string().max(MAX_VIEW_HTML_BYTES).describe("The complete HTML document."),
        }),
        execute: ({ html }) => {
          draft = html;
          /* Advisory early feedback — the binding check runs on publish. */
          const problems = checkViewHtml(draft);
          return problems.length === 0 ? { ok: true as const } : { ok: true as const, problems };
        },
      }),

      edit_view: tool({
        description:
          "Replace one exact text snippet of the working draft with another. oldText must " +
          "match the draft exactly and, unless replaceAll is set, appear exactly once.",
        inputSchema: z.object({
          oldText: z.string().min(1).describe("Exact text to find in the draft."),
          newText: z.string().describe("Text to replace it with."),
          replaceAll: z.boolean().optional().describe("Replace every occurrence."),
        }),
        execute: ({ oldText, newText, replaceAll }) => {
          if (draft === "") {
            return {
              ok: false as const,
              problem: "The draft is empty — there is nothing to edit. Use write_view first.",
            };
          }

          const occurrences = draft.split(oldText).length - 1;
          if (occurrences === 0) {
            return {
              ok: false as const,
              problem:
                "oldText was not found in the draft. It must match exactly, including " +
                "whitespace. Re-read the document you were shown and try a snippet that is " +
                "really there.",
            };
          }
          if (occurrences > 1 && replaceAll !== true) {
            return {
              ok: false as const,
              problem:
                `oldText appears ${occurrences} times. Include more surrounding text to pin ` +
                "down one occurrence, or pass replaceAll: true to change every one.",
            };
          }

          draft =
            replaceAll === true
              ? draft.replaceAll(oldText, newText)
              : draft.replace(oldText, newText);
          return { ok: true as const, replaced: replaceAll === true ? occurrences : 1 };
        },
      }),

      /**
       * The gate. It has an `execute` for a reason: a tool with no
       * implementation ends the loop the moment it is called, which would make
       * a rejected draft a dead end. Because this one runs, a rejection goes
       * back to the model as a tool result and it gets to fix the draft;
       * `stopWhen` below ends the run, and only on a draft that passed.
       */
      publish_view: tool({
        description:
          "Put the current working draft on the user's screen. Checks the draft and " +
          "refuses to publish one that fails.",
        inputSchema: z.object({
          title: z.string().max(80).describe("A short name for the page."),
          summary: z
            .string()
            .max(300)
            .describe(
              "One sentence describing what is now on screen, written to be read " +
                "aloud by the voice assistant to someone who is looking at it.",
            ),
        }),
        execute: () => {
          const problems = checkViewHtml(draft);
          return problems.length === 0
            ? { published: true as const }
            : {
                published: false as const,
                problems,
                note: "Not published. Fix the draft and call publish_view again.",
              };
        },
      }),
    },
    /**
     * With `required`, the model cannot answer in prose — every step is a tool
     * call, so the run either publishes or hits the step cap.
     */
    toolChoice: "required",
    stopWhen: [isStepCount(MAX_STEPS), publishedSuccessfully],
    /**
     * The portable reasoning knob (translated per provider). Low: this is a
     * reasoning model, and an agent step that thinks at length pays that time
     * on every step of a loop the user is sitting through.
     */
    reasoning: "low",

    /**
     * Progress is derived from the loop's own lifecycle rather than emitted
     * from inside the tools, so the tools stay pure — each one answers the
     * agent, and this one place translates the run into something a person can
     * read. `fixing` reuses the checks' problem lists verbatim.
     */
    onToolExecutionStart: ({ toolCall }) => {
      if (toolCall.toolName === "write_view") onProgress({ phase: "writing" });
      if (toolCall.toolName === "edit_view") onProgress({ phase: "editing" });
      if (toolCall.toolName === "publish_view") onProgress({ phase: "checking" });
    },
    onToolExecutionEnd: ({ toolOutput }) => {
      if (toolOutput.type !== "tool-result") return;

      /* All three tools report problems in the same shape. */
      const output = toolOutput.output as { problems?: string[]; problem?: string } | undefined;
      const problems = output?.problems ?? (output?.problem != null ? [output.problem] : null);
      if (problems != null && problems.length > 0) onProgress({ phase: "fixing", problems });
    },
    onStepEnd: ({ providerMetadata }) => {
      const usd = gatewayCostUsd(providerMetadata);
      if (usd != null) onCost(usd);
    },
  });

  const result = await agent.generate({
    prompt:
      currentHtml == null || currentHtml === ""
        ? `The screen is empty. ${request}`
        : `This document is on your working draft and on the user's screen right now:\n\n` +
          `\`\`\`html\n${currentHtml}\n\`\`\`\n\n` +
          `The request is most likely a change to it — edit it with edit_view unless a ` +
          `rewrite is clearly better. ${request}`,
  });

  /**
   * Aggregated across every step, so the last `publish_view` is the one that
   * ended the run — its input names the draft that passed.
   */
  const published = result.staticToolCalls.findLast((call) => call.toolName === "publish_view");

  if (published == null) {
    throw new Error(
      `The coding agent stopped after ${result.steps.length} steps without publishing a page.`,
    );
  }

  const { title, summary } = published.input;

  /**
   * Belt and braces: `publish_view` already refused a failing draft, but the
   * draft is mutable and this is the one path that reaches the screen — so the
   * same check runs on what is actually being returned.
   */
  const problems = checkViewHtml(draft);
  if (problems.length > 0) {
    throw new Error(`The page did not pass its checks: ${problems.join(" ")}`);
  }

  return { title, html: sealViewHtml(draft), summary };
}
