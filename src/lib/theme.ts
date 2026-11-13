import { useSyncExternalStore } from "react";

/**
 * Light or dark, remembered per device in localStorage like the asker mode. The choice is
 * written to `<html data-theme>`, which `theme-light.css` keys on; dark is the original
 * look and carries no attribute-scoped rules at all, so it is never touched.
 *
 * Applied on import (main.tsx imports this before rendering), so a light-theme reload
 * never flashes dark first.
 */

export type Theme = "dark" | "light";

const STORAGE_KEY = "astro.theme.v1";

function read(): Theme {
  try {
    return globalThis.localStorage?.getItem(STORAGE_KEY) === "light" ? "light" : "dark";
  } catch {
    return "dark";
  }
}

function apply(next: Theme): void {
  const root = globalThis.document?.documentElement;
  if (root == null) return;
  root.dataset["theme"] = next;
  // The browser's own chrome (scrollbars, form controls) follows along.
  root.style.colorScheme = next;
}

let theme = read();
apply(theme);

const listeners = new Set<() => void>();

export function setTheme(next: Theme): void {
  theme = next;
  apply(next);
  try {
    if (next === "light") globalThis.localStorage?.setItem(STORAGE_KEY, "light");
    else globalThis.localStorage?.removeItem(STORAGE_KEY);
  } catch {
    // Storage unavailable — the choice lives for this page load only.
  }
  for (const listener of listeners) listener();
}

export function getTheme(): Theme {
  return theme;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useTheme(): Theme {
  return useSyncExternalStore(subscribe, getTheme, getTheme);
}
