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
export const REBUILD_VIEW_TOOL_NAME = "rebuild_view";

export const REALTIME_TOOLS: Experimental_RealtimeToolDefinition[] = [
  {
    type: "function",
    name: RENDER_VIEW_TOOL_NAME,
    description:
      "Coloca algo na tela do usuário. Entrega o pedido a um agente de código, " +
      "que escreve uma pequena página web autocontida e a exibe. Use para " +
      "tudo que vale mais ser visto do que ouvido: um gráfico, um diagrama, uma tabela, " +
      "uma contagem regressiva, um desenho, uma simulação, um formulário. Ela retorna " +
      "assim que o trabalho começa, não quando a página fica pronta — diga algo ao " +
      "usuário enquanto ele espera, e o app avisará quando a página chegar.",
    parameters: {
      type: "object",
      properties: {
        request: {
          type: "string",
          description:
            "O que o usuário deve acabar vendo, em linguagem simples, escrito para " +
            "alguém que não ouve a conversa. Inclua quaisquer dados concretos " +
            "ou números que surgiram — o agente de código não tem outra fonte para " +
            "eles. Se o usuário está mudando algo que já está na tela, diga o que " +
            "mudar em vez de descrever a página inteira de novo.",
        },
      },
      required: ["request"],
      additionalProperties: false,
    },
  },
  {
    type: "function",
    name: REBUILD_VIEW_TOOL_NAME,
    description:
      "Pede a um modelo de código mais forte e mais lento que reescreva do zero a página da tela, a partir da " +
      "lista de funcionalidades que o usuário pediu. Use quando a página já passou do ponto de edições rápidas: " +
      "o usuário diz que há coisas quebradas, inconsistentes ou faltando, uma mudança fez outra coisa " +
      "parar de funcionar, ou as edições continuam falhando. Só quando o usuário pedir — nunca por conta própria, " +
      "e nunca por causa de uma mensagem (status do app) ou de um erro da página. Leva " +
      "dez segundos ou mais; a página atual continua utilizável nesse meio-tempo e os dados do usuário " +
      "são mantidos. Não serve para páginas novas nem mudanças pequenas — use render_view para isso.",
    parameters: {
      type: "object",
      properties: {
        reason: {
          type: "string",
          description:
            "O que está errado, nos termos do usuário: o que quebrou, o que está faltando, o que se comporta " +
            "de forma inconsistente. Inclua qualquer mudança que o usuário queira fazer como parte da reescrita.",
        },
      },
      required: ["reason"],
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
  const request = textArg(args, "request");
  return request == null ? null : { request };
}

export function parseRebuildViewArgs(args: unknown): { reason: string } | null {
  const reason = textArg(args, "reason");
  return reason == null ? null : { reason };
}

function textArg(args: unknown, key: string): string | null {
  if (typeof args !== "object" || args === null) return null;

  const value = (args as Record<string, unknown>)[key];
  if (typeof value !== "string" || value.trim() === "") return null;

  return value.trim().slice(0, 2000);
}
