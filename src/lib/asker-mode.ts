import { useSyncExternalStore } from "react";

/**
 * Asker mode: Astro asks questions before he builds anything. Remembered per device in
 * localStorage, the same way as the password, so the choice survives a reload.
 *
 * Read by `VoiceSession`, which picks the session config (and so the system prompt) from it.
 */

const STORAGE_KEY = "astro.asker-mode.v1";

function read(): boolean {
  try {
    return globalThis.localStorage?.getItem(STORAGE_KEY) === "on";
  } catch {
    return false;
  }
}

let askerMode = read();

const listeners = new Set<() => void>();

export function setAskerMode(next: boolean): void {
  askerMode = next;
  try {
    if (next) globalThis.localStorage?.setItem(STORAGE_KEY, "on");
    else globalThis.localStorage?.removeItem(STORAGE_KEY);
  } catch {
    // Storage unavailable — the choice lives for this page load only.
  }
  for (const listener of listeners) listener();
}

export function getAskerMode(): boolean {
  return askerMode;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useAskerMode(): boolean {
  return useSyncExternalStore(subscribe, getAskerMode, getAskerMode);
}
