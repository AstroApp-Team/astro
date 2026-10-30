import { describe, expect, it } from "vite-plus/test";

import { voiceTurnUsd } from "./realtime.ts";

/**
 * Both fixtures are real `response-done` payloads from Gemini 3.8 Live through
 * the Gateway, and each expected figure is what the Gateway balance actually
 * moved by for that one turn. If the pricing rules change, re-measure against
 * `/v1/credits` — do not adjust these to match the code.
 */
describe("voiceTurnUsd", () => {
  it("prices a spoken turn at what the Gateway billed for it", () => {
    const raw = {
      serverContent: { turnComplete: true },
      usageMetadata: {
        promptTokenCount: 570,
        responseTokenCount: 341,
        totalTokenCount: 911,
        promptTokensDetails: [
          { modality: "TEXT", tokenCount: 353 },
          { modality: "AUDIO", tokenCount: 168 },
        ],
        responseTokensDetails: [{ modality: "AUDIO", tokenCount: 341 }],
        thoughtsTokenCount: 129,
      },
    };

    expect(voiceTurnUsd(raw)).toBeCloseTo(0.005478, 9);
  });

  it("does not bill a tool call's unitemized output, only its thinking", () => {
    const raw = {
      serverContent: { turnComplete: true },
      usageMetadata: {
        promptTokenCount: 576,
        responseTokenCount: 29,
        totalTokenCount: 605,
        promptTokensDetails: [
          { modality: "TEXT", tokenCount: 359 },
          { modality: "AUDIO", tokenCount: 168 },
        ],
        thoughtsTokenCount: 98,
      },
    };

    expect(voiceTurnUsd(raw)).toBeCloseTo(0.001251, 9);
  });

  it("returns null for events that carry no usage", () => {
    expect(voiceTurnUsd(undefined)).toBeNull();
    expect(voiceTurnUsd({ serverContent: { generationComplete: true } })).toBeNull();
    expect(voiceTurnUsd({ type: "response.done", response: {} })).toBeNull();
  });

  it("ignores malformed counts instead of producing NaN", () => {
    expect(
      voiceTurnUsd({ usageMetadata: { promptTokenCount: "lots", promptTokensDetails: {} } }),
    ).toBe(0);
  });
});
