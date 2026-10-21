import { useStore } from "zustand";
import { createStore } from "zustand/vanilla";

import type { VoiceUsage } from "@core/models/voiceUsage.ts";
import { voiceUsageTracker } from "@infra/api/voiceUsageTracker.ts";

/**
 * The session meter, exposed to React.
 *
 * The tracker is a domain object with its own subscription protocol, so it is
 * mirrored into a vanilla Zustand store rather than rewritten as one: the money
 * arithmetic stays in `core/`, and this file is the one-way mirror that lets a
 * component read it.
 *
 * The mirror is one-directional on purpose. Nothing in the UI writes a usage
 * number — the only writes are `start` / `stop` / `reset`, and they are the
 * session lifecycle, not a view's business.
 */
export const voiceUsageStore = createStore<VoiceUsage>(() => voiceUsageTracker.getUsage());

voiceUsageTracker.subscribe(() => {
  voiceUsageStore.setState(voiceUsageTracker.getUsage());
});

export function useVoiceUsage(): VoiceUsage {
  return useStore(voiceUsageStore);
}

/** Called when the realtime socket is `connected`, and its cleanup calls `stop`. */
export function startSessionClock(): void {
  voiceUsageTracker.start();
}

export function stopSessionClock(): void {
  voiceUsageTracker.stop();
}

export function resetUsage(): void {
  voiceUsageTracker.reset();
}
