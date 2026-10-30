/**
 * Shared between the Worker and the SPA. Compiled by both tsconfig.app.json
 * and tsconfig.worker.json, so keep this file runtime-agnostic — no Node,
 * DOM, or Workers globals.
 */

import type { Experimental_RealtimeToolDefinition } from "ai";

/**
 * Google's Gemini 3.8 Live, reached through the Vercel AI Gateway, which
 * normalizes its Live API into the same realtime events every provider emits.
 *
 * Only the id used *server-side* actually selects a model: it is baked into the
 * WebSocket URL that comes back with the token (`?ai-model-id=...`). The
 * browser's copy just names the same session.
 */
export const VOICE_MODEL_ID = "google/gemini-3.8-live";

/** One of Gemini's prebuilt voices. xAI's names (`eve`) do not carry over. */
export const VOICE_NAME = "Kore";

/**
 * PCM16 mono at 24 kHz. Stated explicitly: with no audio config the session
 * falls back to the provider's own default while the browser captures and plays
 * at `sampleRate`. A mismatch there is garbled audio, not an error.
 */
export const AUDIO_FORMAT_TYPE = "audio/pcm";
export const AUDIO_SAMPLE_RATE = 24_000;
export const AUDIO_BYTES_PER_SAMPLE = 2;

/** The browser only needs the token long enough to open the socket. */
export const REALTIME_TOKEN_TTL_SECONDS = 60;

/**
 * The Gateway's published rates for this model, in USD per token, from
 * `curl https://ai-gateway.vercel.sh/v1/models` → `pricing`. Gemini Live bills
 * by the token, split by modality — audio costs four times what text does on
 * the way in and nearly three times on the way out.
 */
export const VOICE_USD_PER_TOKEN = {
  textInput: 0.75e-6,
  audioInput: 3e-6,
  textOutput: 4.5e-6,
  audioOutput: 12e-6,
} as const;

/**
 * What one turn cost, from the `usageMetadata` Gemini attaches to the raw
 * `response-done` event. Returns null for any event without one, so the caller
 * can hand it every event.
 *
 * Checked against the Gateway balance, which moved by exactly this amount for
 * a spoken turn ($0.005478) and a tool-call turn ($0.001251):
 *
 * - every prompt token is billed, including the ones `promptTokensDetails`
 *   does not itemize, at the text rate;
 * - output is billed by `responseTokensDetails` only — a tool call reports a
 *   `responseTokenCount` with no breakdown, and those tokens were free;
 * - thinking tokens are billed as text output, though `totalTokenCount`
 *   leaves them out.
 *
 * The prompt is the *whole* conversation so far, re-billed on every turn, so a
 * long session costs more per turn as it goes.
 */
export function voiceTurnUsd(raw: unknown): number | null {
  const usage = (raw as { usageMetadata?: unknown } | null)?.usageMetadata;
  if (typeof usage !== "object" || usage === null) return null;

  const u = usage as {
    promptTokenCount?: unknown;
    thoughtsTokenCount?: unknown;
    promptTokensDetails?: unknown;
    responseTokensDetails?: unknown;
  };

  const prompt = count(u.promptTokenCount);
  const audioIn = modalityCount(u.promptTokensDetails, "AUDIO");
  const audioOut = modalityCount(u.responseTokensDetails, "AUDIO");
  const textOut = modalityCount(u.responseTokensDetails, "TEXT");

  const rate = VOICE_USD_PER_TOKEN;
  return (
    audioIn * rate.audioInput +
    Math.max(prompt - audioIn, 0) * rate.textInput +
    audioOut * rate.audioOutput +
    (textOut + count(u.thoughtsTokenCount)) * rate.textOutput
  );
}

function count(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : 0;
}

function modalityCount(details: unknown, modality: string): number {
  if (!Array.isArray(details)) return 0;
  let total = 0;
  for (const detail of details as { modality?: unknown; tokenCount?: unknown }[]) {
    if (detail?.modality === modality) total += count(detail.tokenCount);
  }
  return total;
}

/**
 * `experimental_useRealtime` fetches the setup endpoint itself and does not let
 * us add headers, so the shared password rides in the query string. It is a
 * bot deterrent on a public URL, not real authentication.
 */
export const PASSWORD_QUERY_PARAM = "key";

/**
 * Tools are declared on the **Worker**, not in the browser. `connect()`
 * destructures `tools` out of the setup response and folds it into the
 * `session-update` it sends on open — the browser's `sessionConfig` has no say.
 * The browser only supplies the handler, via `onToolCall`.
 */
export const RENDER_VIEW_TOOL_NAME = "render_view";

export const REALTIME_TOOLS: Experimental_RealtimeToolDefinition[] = [
  {
    type: "function",
    name: RENDER_VIEW_TOOL_NAME,
    description:
      "Put something on the user's screen. Hands the request to a coding agent, " +
      "which writes a small self-contained web page and renders it. Use this for " +
      "anything worth seeing rather than hearing: a chart, a diagram, a table, a " +
      "countdown, a drawing, a simulation, a form. It returns as soon as the work " +
      "starts, not when the page is ready — say something to the user while they " +
      "wait, and the app will tell you when it lands.",
    parameters: {
      type: "object",
      properties: {
        request: {
          type: "string",
          description:
            "What the user should end up seeing, in plain language, written for " +
            "someone who cannot hear the conversation. Include any concrete data " +
            "or numbers that came up — the coding agent has no other source for " +
            "them. If the user is changing something already on screen, say what " +
            "to change rather than describing the whole page again.",
        },
      },
      required: ["request"],
      additionalProperties: false,
    },
  },
];

export type RenderViewArgs = { request: string };

/**
 * Tool arguments arrive as whatever JSON the model produced — the SDK parses
 * them but validates nothing. Parsing here rather than in the component keeps
 * the shape next to the JSON Schema that asked for it, so the two cannot drift.
 */
export function parseRenderViewArgs(args: unknown): RenderViewArgs | null {
  if (typeof args !== "object" || args === null) return null;

  const { request } = args as { request?: unknown };
  if (typeof request !== "string" || request.trim() === "") return null;

  return { request: request.trim().slice(0, 2000) };
}
