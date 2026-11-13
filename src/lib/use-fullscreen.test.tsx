// @vitest-environment happy-dom
import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import { useFullscreen } from "./use-fullscreen.ts";

describe("useFullscreen", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    Object.defineProperty(document, "fullscreenElement", {
      configurable: true,
      get: () => null,
    });
    Object.defineProperty(document, "fullscreenEnabled", {
      configurable: true,
      get: () => false,
    });
  });

  it("enters and exits fullscreen in-app even when DOM Fullscreen API is unavailable", () => {
    const { result } = renderHook(() => useFullscreen(true));
    expect(result.current.fullscreen).toBe(false);

    act(() => result.current.enter());
    expect(result.current.fullscreen).toBe(true);

    act(() => result.current.exit());
    expect(result.current.fullscreen).toBe(false);
  });

  it("exits fullscreen on Escape when not in native fullscreen", () => {
    const { result } = renderHook(() => useFullscreen(true));
    act(() => result.current.enter());
    expect(result.current.fullscreen).toBe(true);

    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    });
    expect(result.current.fullscreen).toBe(false);
  });

  it("requests native fullscreen when enabled and syncs exit on fullscreenchange", () => {
    let nativeEl: Element | null = null;
    const requestFullscreen = vi.fn(async () => {
      nativeEl = document.documentElement;
      document.dispatchEvent(new Event("fullscreenchange"));
    });
    const exitFullscreen = vi.fn(async () => {
      nativeEl = null;
      document.dispatchEvent(new Event("fullscreenchange"));
    });

    Object.defineProperty(document, "fullscreenEnabled", { configurable: true, get: () => true });
    Object.defineProperty(document, "fullscreenElement", {
      configurable: true,
      get: () => nativeEl,
    });
    document.documentElement.requestFullscreen = requestFullscreen;
    document.exitFullscreen = exitFullscreen;

    const { result } = renderHook(() => useFullscreen(true));
    act(() => result.current.enter());

    expect(requestFullscreen).toHaveBeenCalledTimes(1);
    expect(result.current.fullscreen).toBe(true);

    /* Simulate user pressing Esc in the browser to leave native fullscreen. */
    act(() => {
      nativeEl = null;
      document.dispatchEvent(new Event("fullscreenchange"));
    });
    expect(result.current.fullscreen).toBe(false);
  });
});
