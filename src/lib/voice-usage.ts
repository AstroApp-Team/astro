import { useSyncExternalStore } from "react";

/**
 * Running total of what the app has cost, kept in localStorage so a page
 * reload does not reset it.
 *
 * Both models bill by the token, so the money is a sum of what each reports:
 * the voice model's per-turn usage (priced by `voiceTurnUsd`) and the coding
 * agent's per-step cost, which the Gateway states outright. The clock still
 * runs while a session is open — it prices nothing now, but connected time is
 * what the idle hang-up guards, so it stays on screen.
 */
export type VoiceUsage = {
  /** What the voice model has cost, in USD. */
  voiceUsd: number;
  /** What the coding agent has cost, in USD — failed builds included. */
  viewUsd: number;
  /** Wall-clock seconds connected, across all sessions. */
  seconds: number;
  /** How many sessions have been opened. */
  sessions: number;
};

const STORAGE_KEY = "astro.voice-usage.v3";

/**
 * v2 only counted seconds, priced at Grok voice's $0.001334 per connected
 * second. That money was really spent, so it carries over as voice cost.
 */
const LEGACY_STORAGE_KEY = "astro.voice-usage.v2";
const LEGACY_USD_PER_SECOND = 0.001334;

const EMPTY: VoiceUsage = { voiceUsd: 0, viewUsd: 0, seconds: 0, sessions: 0 };

const TICK_MS = 1000;

export function usageToUsd(usage: VoiceUsage): number {
  return usage.voiceUsd + usage.viewUsd;
}

/**
 * localStorage throws outright in some privacy modes and does not exist in the
 * node test environment, so every access is guarded and a failure just means
 * the total lives for this page load only.
 */
function read(): VoiceUsage {
  try {
    const raw = globalThis.localStorage?.getItem(STORAGE_KEY);
    if (raw != null) {
      const { voiceUsd, viewUsd, seconds, sessions } = parseObject(raw);
      return {
        voiceUsd: numberOr0(voiceUsd),
        viewUsd: numberOr0(viewUsd),
        seconds: numberOr0(seconds),
        sessions: numberOr0(sessions),
      };
    }

    const legacy = globalThis.localStorage?.getItem(LEGACY_STORAGE_KEY);
    if (legacy == null) return EMPTY;

    const { seconds, sessions } = parseObject(legacy);
    return {
      ...EMPTY,
      voiceUsd: numberOr0(seconds) * LEGACY_USD_PER_SECOND,
      seconds: numberOr0(seconds),
      sessions: numberOr0(sessions),
    };
  } catch {
    return EMPTY;
  }
}

function parseObject(raw: string): Partial<Record<keyof VoiceUsage, unknown>> {
  const parsed: unknown = JSON.parse(raw);
  return typeof parsed === "object" && parsed !== null ? parsed : {};
}

function numberOr0(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

/** Everything already banked. The live session's seconds are not in here yet. */
let banked: VoiceUsage = read();

/** Snapshot handed to React. Replaced (new identity) only when it changes. */
let current: VoiceUsage = banked;

let liveSince: number | null = null;
let ticker: ReturnType<typeof setInterval> | null = null;

const listeners = new Set<() => void>();

function persist(): void {
  try {
    globalThis.localStorage?.setItem(STORAGE_KEY, JSON.stringify(banked));
  } catch {
    // Storage unavailable — the in-memory total still works.
  }
}

function publish(next: VoiceUsage): void {
  current = next;
  for (const listener of listeners) listener();
}

function liveSeconds(): number {
  return liveSince == null ? 0 : (Date.now() - liveSince) / 1000;
}

/**
 * Folds the elapsed time into the banked total and restarts the clock from now,
 * so a crash or a closed tab loses at most one tick.
 */
function bankElapsed(): void {
  if (liveSince == null) return;

  banked = { ...banked, seconds: banked.seconds + liveSeconds() };
  liveSince = Date.now();
  persist();
}

export function startSessionClock(): void {
  if (liveSince != null) return;

  banked = { ...banked, sessions: banked.sessions + 1 };
  liveSince = Date.now();
  persist();

  ticker ??= setInterval(() => {
    bankElapsed();
    publish(banked);
  }, TICK_MS);

  publish(banked);
}

export function stopSessionClock(): void {
  bankElapsed();
  liveSince = null;

  if (ticker != null) {
    clearInterval(ticker);
    ticker = null;
  }

  publish(banked);
}

/**
 * Banks money as each model reports it, without waiting for anything to end:
 * a voice turn's cost lands with its `response-done`, a build step's with the
 * step.
 */
export function addVoiceCost(usd: number): void {
  addCost("voiceUsd", usd);
}

export function addViewCost(usd: number): void {
  addCost("viewUsd", usd);
}

function addCost(key: "voiceUsd" | "viewUsd", usd: number): void {
  if (!Number.isFinite(usd) || usd <= 0) return;

  banked = { ...banked, [key]: banked[key] + usd };
  persist();
  publish(banked);
}

export function resetUsage(): void {
  banked = EMPTY;
  if (liveSince != null) liveSince = Date.now();
  persist();
  publish(banked);
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function snapshot(): VoiceUsage {
  return current;
}

export function getUsage(): VoiceUsage {
  return current;
}

export function useVoiceUsage(): VoiceUsage {
  return useSyncExternalStore(subscribe, snapshot, snapshot);
}
