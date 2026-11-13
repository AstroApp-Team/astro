import { useEffect, useRef, useState } from "react";

/**
 * Manages immersive fullscreen mode across browsers and mobile WebViews.
 *
 * Hides surrounding app chrome via React state everywhere (including WebViews
 * where the DOM Fullscreen API is unavailable) and synchronizes with native
 * `document.documentElement.requestFullscreen()` when supported.
 */
export function useFullscreen(enabled = true) {
  const [fullscreen, setFullscreen] = useState(false);
  const wasNativeRef = useRef(false);
  const active = enabled && fullscreen;

  const enter = () => {
    if (!enabled) return;
    setFullscreen(true);
    if (
      document.fullscreenEnabled &&
      typeof document.documentElement.requestFullscreen === "function"
    ) {
      void document.documentElement.requestFullscreen().catch(() => {});
    }
  };

  const exit = () => {
    wasNativeRef.current = false;
    setFullscreen(false);
    if (document.fullscreenElement != null && typeof document.exitFullscreen === "function") {
      void document.exitFullscreen().catch(() => {});
    }
  };

  useEffect(() => {
    if (!active) return;
    if (document.fullscreenElement != null) {
      wasNativeRef.current = true;
    }

    const onFullscreenChange = () => {
      if (document.fullscreenElement != null) {
        wasNativeRef.current = true;
      } else if (wasNativeRef.current) {
        wasNativeRef.current = false;
        setFullscreen(false);
      }
    };

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (document.fullscreenElement == null) {
        setFullscreen(false);
      }
    };

    document.addEventListener("fullscreenchange", onFullscreenChange);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("fullscreenchange", onFullscreenChange);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [active]);

  return {
    fullscreen: active,
    enter,
    exit,
  };
}
