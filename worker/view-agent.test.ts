import { MockLanguageModelV4, mockValues } from "ai/test";
import { describe, expect, it } from "vite-plus/test";

import { sealViewHtml, type ViewProgress } from "../shared/view.ts";
import { buildView, gatewayCostUsd } from "./view-agent.ts";

/**
 * The loop is driven through `MockLanguageModelV4` — the SDK's own seam — so
 * these tests exercise the real `ToolLoopAgent`, the real tools, and the real
 * draft state, with only the provider replaced. Stubbing `fetch` instead would
 * test the Gateway's wire format, which is not ours.
 */

const usage = {
  inputTokens: { total: 10, noCache: 10, cacheRead: undefined, cacheWrite: undefined },
  outputTokens: { total: 20, text: 20, reasoning: undefined },
} as const;

/** One turn of the loop: the model asks for exactly one tool call. */
function calls(toolName: string, input: object) {
  return {
    content: [
      {
        type: "tool-call" as const,
        toolCallId: `call-${toolName}`,
        toolName,
        input: JSON.stringify(input),
      },
    ],
    finishReason: { unified: "tool-calls" as const, raw: undefined },
    usage,
    warnings: [],
  };
}

const GOOD_PAGE = "<!doctype html><html><head></head><body><h1>blue</h1></body></html>";

const PUBLISH = { title: "Page", summary: "A page." };

/**
 * Drives the agent through a fixed script of turns, in order. `mockValues`
 * repeats its last value once the script runs out, which is what lets a short
 * script stand in for a model that never stops.
 */
function scriptedModel(turns: ReturnType<typeof calls>[]) {
  const next = mockValues(...turns);
  return new MockLanguageModelV4({ doGenerate: async () => next() });
}

describe("buildView", () => {
  it("publishes the draft write_view left behind, with the CSP added", async () => {
    const view = await buildView({
      model: scriptedModel([
        calls("write_view", { html: GOOD_PAGE }),
        calls("publish_view", { title: "The answer", summary: "It is blue." }),
      ]),
      request: "show me the answer",
      onProgress: () => {},
      onCost: () => {},
    });

    expect(view.title).toBe("The answer");
    expect(view.summary).toBe("It is blue.");
    // The agent never writes the policy; the Worker adds it so the model
    // cannot be talked out of it.
    expect(view.html).toContain('<meta http-equiv="Content-Security-Policy"');
    expect(view.html).toContain("<h1>blue</h1>");
  });

  it("edits the current page in place instead of rewriting it", async () => {
    /**
     * The point of the whole design: the model changes one snippet and the
     * rest of the document — which it never re-emitted — survives verbatim.
     */
    const progress: ViewProgress[] = [];

    const view = await buildView({
      model: scriptedModel([
        calls("edit_view", { oldText: "<h1>blue</h1>", newText: "<h1>red</h1>" }),
        calls("publish_view", { title: "Edited", summary: "Now red." }),
      ]),
      request: "make it red",
      currentHtml: GOOD_PAGE,
      onProgress: (update) => progress.push(update),
      onCost: () => {},
    });

    expect(view.html).toContain("<h1>red</h1>");
    expect(view.html).toContain("<!doctype html><html><head>");
    expect(progress.map((update) => update.phase)).toContain("editing");
  });

  it("feeds a failed edit back so the agent can retry", async () => {
    const progress: ViewProgress[] = [];

    const view = await buildView({
      model: scriptedModel([
        calls("edit_view", { oldText: "<h1>green</h1>", newText: "<h1>red</h1>" }),
        calls("edit_view", { oldText: "<h1>blue</h1>", newText: "<h1>red</h1>" }),
        calls("publish_view", PUBLISH),
      ]),
      request: "make it red",
      currentHtml: GOOD_PAGE,
      onProgress: (update) => progress.push(update),
      onCost: () => {},
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
        calls("edit_view", { oldText: "<p>x</p>", newText: "<p>y</p>" }),
        calls("edit_view", { oldText: "<p>x</p>", newText: "<p>y</p>", replaceAll: true }),
        calls("publish_view", PUBLISH),
      ]),
      request: "change x to y",
      currentHtml: twice,
      onProgress: () => {},
      onCost: () => {},
    });

    expect(view.html).not.toContain("<p>x</p>");
    expect(view.html).toContain("<p>y</p><p>y</p>");
  });

  it("keeps exactly one CSP meta when editing an already-sealed page", async () => {
    /**
     * The client sends back the *sealed* document, so every edit cycle would
     * stack another meta tag if sealing were not idempotent.
     */
    const sealed = sealViewHtml(GOOD_PAGE);

    const view = await buildView({
      model: scriptedModel([
        calls("edit_view", { oldText: "blue", newText: "red" }),
        calls("publish_view", PUBLISH),
      ]),
      request: "make it red",
      currentHtml: sealed,
      onProgress: () => {},
      onCost: () => {},
    });

    const metas = view.html.match(/Content-Security-Policy/g) ?? [];
    expect(metas).toHaveLength(1);
  });

  it("refuses to publish a draft that fails the checks, and lets the agent fix it", async () => {
    /**
     * The real failure this guards: on the first live run the model published
     * without ever checking. The gate runs inside publish_view itself, and a
     * rejection keeps the loop alive instead of ending it.
     */
    const progress: ViewProgress[] = [];

    const view = await buildView({
      model: scriptedModel([
        calls("write_view", {
          html: `${GOOD_PAGE}<script src="https://cdn.example.com/x.js"></script>`,
        }),
        calls("publish_view", PUBLISH),
        calls("edit_view", {
          oldText: '<script src="https://cdn.example.com/x.js"></script>',
          newText: "",
        }),
        calls("publish_view", PUBLISH),
      ]),
      request: "show me the answer",
      onProgress: (update) => progress.push(update),
      onCost: () => {},
    });

    expect(view.html).not.toContain("cdn.example.com");
    expect(progress.filter((update) => update.phase === "checking").length).toBeGreaterThan(1);
    const fixing = progress.find((update) => update.phase === "fixing");
    expect(fixing?.problems.join(" ")).toContain("network");
  });

  it("fails loudly when the agent stops without publishing", async () => {
    /**
     * `mockValues` repeats its last value once exhausted, so this is a model
     * that edits forever — the step cap is what ends it. Silently returning
     * nothing here would leave the voice agent waiting on a page that is never
     * coming.
     */
    await expect(
      buildView({
        model: scriptedModel([calls("edit_view", { oldText: "blue", newText: "red" })]),
        request: "make it red",
        currentHtml: GOOD_PAGE,
        onProgress: () => {},
        onCost: () => {},
      }),
    ).rejects.toThrow(/without publishing/);
  });

  it("reports what every step cost, including a run that never publishes", async () => {
    /**
     * The bill arrives per step because a failed build spends money too — a
     * total reported only on success would hide exactly the expensive runs.
     */
    const billed = (turn: ReturnType<typeof calls>) => ({
      ...turn,
      providerMetadata: { gateway: { cost: "0.0000243" } },
    });
    const costs: number[] = [];

    await expect(
      buildView({
        model: new MockLanguageModelV4({
          doGenerate: async () => billed(calls("edit_view", { oldText: "blue", newText: "red" })),
        }),
        request: "make it red",
        currentHtml: GOOD_PAGE,
        onProgress: () => {},
        onCost: (usd) => costs.push(usd),
      }),
    ).rejects.toThrow(/without publishing/);

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
