import { convertArrayToReadableStream, MockLanguageModelV4 } from "ai/test";
import { describe, expect, it } from "vite-plus/test";

import { sealViewHtml, type ViewProgress } from "../shared/view.ts";
import { buildView, gatewayCostUsd } from "./view-agent.ts";

/**
 * The loop is driven through `MockLanguageModelV4` — the SDK's own seam — so
 * these tests exercise the real `ToolLoopAgent`, the real tools, and the real
 * draft state, with only the provider replaced. Stubbing `fetch` instead would
 * test the Gateway's wire format, which is not ours.
 *
 * The mock *streams*, input deltas and all, because the loop does: drafts
 * reach the screen from `onInputDelta`, which a generate-only mock never hits.
 */

const usage = {
  inputTokens: { total: 10, noCache: 10, cacheRead: undefined, cacheWrite: undefined },
  outputTokens: { total: 20, text: 20, reasoning: undefined },
} as const;

/** Read off the mock rather than imported: `@ai-sdk/provider` is not a direct dependency. */
type LanguageModelV4StreamPart =
  Awaited<ReturnType<MockLanguageModelV4["doStream"]>>["stream"] extends ReadableStream<infer Part>
    ? Part
    : never;

type Call = { toolName: string; input: object };
type Turn = { calls: Call[]; cost?: string };

/** One tool call, in one turn of the loop. */
const call = (toolName: string, input: object): Turn => ({ calls: [{ toolName, input }] });

/**
 * A turn as a provider streams it: each call's input arrives as JSON in
 * small deltas before the call itself, so a delta can end mid-string — the
 * same shape `onInputDelta` sees from a real model.
 */
function streamTurn({ calls, cost }: Turn, turnIndex: number): LanguageModelV4StreamPart[] {
  const parts: LanguageModelV4StreamPart[] = [{ type: "stream-start", warnings: [] }];

  calls.forEach(({ toolName, input }, callIndex) => {
    const id = `call-${turnIndex}-${callIndex}`;
    const json = JSON.stringify(input);

    parts.push({ type: "tool-input-start", id, toolName });
    for (let at = 0; at < json.length; at += 24) {
      parts.push({ type: "tool-input-delta", id, delta: json.slice(at, at + 24) });
    }
    parts.push({ type: "tool-input-end", id });
    parts.push({ type: "tool-call", toolCallId: id, toolName, input: json });
  });

  parts.push({
    type: "finish",
    finishReason: { unified: "tool-calls", raw: undefined },
    usage,
    ...(cost != null && { providerMetadata: { gateway: { cost } } }),
  });
  return parts;
}

/**
 * Drives the agent through a fixed script of turns, in order, repeating the
 * last one once the script runs out — which is what lets a short script stand
 * in for a model that never stops. Each turn gets a fresh stream; a
 * `ReadableStream` can only be read once.
 */
function scriptedModel(turns: Turn[]) {
  let next = 0;
  const model = new MockLanguageModelV4({
    doStream: async () => {
      const index = Math.min(next, turns.length - 1);
      next += 1;
      return { stream: convertArrayToReadableStream(streamTurn(turns[index]!, index)) };
    },
  });
  return model;
}

const GOOD_PAGE =
  "<!doctype html><html><head><title>Answer</title></head><body><h1>blue</h1></body></html>";

const noop = () => {};

describe("buildView", () => {
  it("finishes in one step once write_view leaves a passing page", async () => {
    /**
     * There is no publish step: a page that passes its checks ends the run
     * on the spot. A second model round-trip here is the latency this design
     * exists to remove.
     */
    const model = scriptedModel([call("write_view", { html: GOOD_PAGE })]);

    const view = await buildView({
      model,
      request: "show me the answer",
      onProgress: noop,
      onDraft: noop,
      onCost: noop,
    });

    expect(model.doStreamCalls).toHaveLength(1);
    expect(view.title).toBe("Answer");
    // The agent never writes the policy or the base styles; the Worker adds
    // them, so the model cannot be talked out of the first or forget the
    // second.
    expect(view.html).toContain('<meta http-equiv="Content-Security-Policy"');
    expect(view.html).toContain("<style>:root{color-scheme:dark");
    expect(view.html).toContain("<h1>blue</h1>");
  });

  it("paints the page while write_view is still streaming", async () => {
    const drafts: string[] = [];

    const view = await buildView({
      model: scriptedModel([call("write_view", { html: GOOD_PAGE })]),
      request: "show me the answer",
      onProgress: noop,
      onDraft: (html) => drafts.push(html),
      onCost: noop,
    });

    /**
     * The first draft goes out off the first delta — half a document, sealed
     * like any other — and the last is the finished page.
     */
    expect(drafts.length).toBeGreaterThan(1);
    expect(drafts[0]).not.toContain("<h1>blue</h1>");
    expect(drafts[0]).toContain("Content-Security-Policy");
    expect(drafts.at(-1)).toBe(view.html);
  });

  it("edits the current page in place, in one step", async () => {
    /**
     * The point of edit_view: the model changes one snippet and the rest of
     * the document — which it never re-emitted — survives verbatim.
     */
    const progress: ViewProgress[] = [];
    const drafts: string[] = [];
    const model = scriptedModel([
      call("edit_view", { oldText: "<h1>blue</h1>", newText: "<h1>red</h1>" }),
    ]);

    const view = await buildView({
      model,
      request: "make it red",
      currentHtml: GOOD_PAGE,
      onProgress: (update) => progress.push(update),
      onDraft: (html) => drafts.push(html),
      onCost: noop,
    });

    expect(model.doStreamCalls).toHaveLength(1);
    expect(view.html).toContain("<h1>red</h1>");
    expect(view.html).toContain("<title>Answer</title>");
    expect(drafts).toEqual([view.html]);
    expect(progress.map((update) => update.phase)).toContain("editing");
  });

  it("applies several edits from one step together", async () => {
    const view = await buildView({
      model: scriptedModel([
        {
          calls: [
            { toolName: "edit_view", input: { oldText: "blue", newText: "red" } },
            { toolName: "edit_view", input: { oldText: "Answer", newText: "Colour" } },
          ],
        },
      ]),
      request: "make it red and rename it",
      currentHtml: GOOD_PAGE,
      onProgress: noop,
      onDraft: noop,
      onCost: noop,
    });

    expect(view.html).toContain("<h1>red</h1>");
    expect(view.title).toBe("Colour");
  });

  it("feeds a failed edit back so the agent can retry", async () => {
    const progress: ViewProgress[] = [];

    const view = await buildView({
      model: scriptedModel([
        call("edit_view", { oldText: "<h1>green</h1>", newText: "<h1>red</h1>" }),
        call("edit_view", { oldText: "<h1>blue</h1>", newText: "<h1>red</h1>" }),
      ]),
      request: "make it red",
      currentHtml: GOOD_PAGE,
      onProgress: (update) => progress.push(update),
      onDraft: noop,
      onCost: noop,
    });

    expect(view.html).toContain("<h1>red</h1>");

    /**
     * The miss surfaces to the user as a fixing line — if this stops firing,
     * the loop still works and the wait goes silent.
     */
    const fixing = progress.find((update) => update.phase === "fixing");
    expect(fixing?.problems.join(" ")).toContain("not found");
  });

  it("refuses an ambiguous edit unless replaceAll is set", async () => {
    const twice = "<!doctype html><body><p>x</p><p>x</p></body>";

    const view = await buildView({
      model: scriptedModel([
        call("edit_view", { oldText: "<p>x</p>", newText: "<p>y</p>" }),
        call("edit_view", { oldText: "<p>x</p>", newText: "<p>y</p>", replaceAll: true }),
      ]),
      request: "change x to y",
      currentHtml: twice,
      onProgress: noop,
      onDraft: noop,
      onCost: noop,
    });

    expect(view.html).not.toContain("<p>x</p>");
    expect(view.html).toContain("<p>y</p><p>y</p>");
  });

  it("keeps exactly one CSP meta when editing an already-sealed page", async () => {
    /**
     * The client sends back the *sealed* document, so every edit cycle would
     * stack another meta tag if sealing were not idempotent.
     */
    const view = await buildView({
      model: scriptedModel([call("edit_view", { oldText: "blue", newText: "red" })]),
      request: "make it red",
      currentHtml: sealViewHtml(GOOD_PAGE),
      onProgress: noop,
      onDraft: noop,
      onCost: noop,
    });

    expect(view.html.match(/Content-Security-Policy/g) ?? []).toHaveLength(1);
  });

  it("keeps going after a page that fails the checks, until it is fixed", async () => {
    /**
     * A failing write is still drawn — the user sees it arrive — but it does
     * not end the run: the problems go back to the model as the tool result.
     */
    const progress: ViewProgress[] = [];
    const script = '<script src="https://cdn.example.com/x.js"></script>';

    const view = await buildView({
      model: scriptedModel([
        call("write_view", { html: GOOD_PAGE.replace("</body>", `${script}</body>`) }),
        call("edit_view", { oldText: script, newText: "" }),
      ]),
      request: "show me the answer",
      onProgress: (update) => progress.push(update),
      onDraft: noop,
      onCost: noop,
    });

    expect(view.html).not.toContain("cdn.example.com");
    const fixing = progress.find((update) => update.phase === "fixing");
    expect(fixing?.problems.join(" ")).toContain("network");
  });

  it("fails loudly when the agent never reaches a working page", async () => {
    /**
     * A model that misses the same edit forever — the step cap is what ends
     * it. Silently returning the old page here would leave the voice agent
     * waiting on a change that is never coming.
     */
    await expect(
      buildView({
        model: scriptedModel([call("edit_view", { oldText: "green", newText: "red" })]),
        request: "make it red",
        currentHtml: GOOD_PAGE,
        onProgress: noop,
        onDraft: noop,
        onCost: noop,
      }),
    ).rejects.toThrow(/without a working page/);
  });

  it("reports what every step cost, including a run that never succeeds", async () => {
    /**
     * The bill arrives per step because a failed build spends money too — a
     * total reported only on success would hide exactly the expensive runs.
     */
    const costs: number[] = [];

    await expect(
      buildView({
        model: scriptedModel([
          { ...call("edit_view", { oldText: "green", newText: "red" }), cost: "0.0000243" },
        ]),
        request: "make it red",
        currentHtml: GOOD_PAGE,
        onProgress: noop,
        onDraft: noop,
        onCost: (usd) => costs.push(usd),
      }),
    ).rejects.toThrow(/without a working page/);

    expect(costs.length).toBeGreaterThan(1);
    expect(costs.every((usd) => usd === 0.0000243)).toBe(true);
  });
});

describe("gatewayCostUsd", () => {
  it("reads the Gateway's decimal-string cost", () => {
    expect(gatewayCostUsd({ gateway: { cost: "0.0000243" } })).toBe(0.0000243);
  });

  it("treats a missing or malformed cost as unknown, not free", () => {
    expect(gatewayCostUsd(undefined)).toBeNull();
    expect(gatewayCostUsd({ gateway: {} })).toBeNull();
    expect(gatewayCostUsd({ gateway: { cost: "n/a" } })).toBeNull();
  });
});
