import { useSyncExternalStore } from "react";

/**
 * Whether a CSS media query matches, kept live. `useSyncExternalStore` is
 * React's documented way to read a browser subscription during render, so the
 * first paint already has the right answer — no flash of the wrong layout.
 */
export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (onChange) => {
      const list = window.matchMedia(query);
      list.addEventListener("change", onChange);
      return () => list.removeEventListener("change", onChange);
    },
    () => window.matchMedia(query).matches,
    () => false,
  );
}
