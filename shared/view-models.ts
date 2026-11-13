/**
 * The models the coding agent may run on, chosen from the app (Settings → Modelo).
 *
 * This list is the allowlist: the Worker accepts only these ids from a request, so the
 * client cannot point the Gateway key at an arbitrary model. Ids are the AI Gateway's
 * (`curl https://ai-gateway.vercel.sh/v1/models`).
 *
 * Runtime-agnostic: imported by both the Worker and the SPA.
 */

export const VIEW_MODEL_IDS = [
  "anthropic/claude-haiku-5.5",
  "anthropic/claude-sonnet-5.5",
  "anthropic/claude-opus-5.5",
] as const;

export type ViewModelId = (typeof VIEW_MODEL_IDS)[number];

/**
 * What a request without a `model` runs on, and what a fresh device starts with. Haiku: Sonnet
 * and Opus cost several times more per build.
 */
export const DEFAULT_VIEW_MODEL_ID: ViewModelId = "anthropic/claude-haiku-5.5";

export const VIEW_MODEL_INFO: Record<ViewModelId, { label: string; hint: string }> = {
  "anthropic/claude-haiku-5.5": { label: "Haiku 5.5", hint: "Rápido e barato" },
  "anthropic/claude-sonnet-5.5": { label: "Sonnet 5.5", hint: "Equilibrado" },
  "anthropic/claude-opus-5.5": { label: "Opus 5.5", hint: "O mais capaz e o mais caro" },
};

export function isViewModelId(value: unknown): value is ViewModelId {
  return typeof value === "string" && (VIEW_MODEL_IDS as readonly string[]).includes(value);
}
