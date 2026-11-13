// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

vi.mock("@react-three/fiber", () => ({
  Canvas: () => null,
  useThree: () => ({
    size: { width: 400, height: 800 },
    camera: {},
    get: () => ({ camera: { zoom: 1, updateProjectionMatrix: () => {} } }),
  }),
  useFrame: () => {},
}));

import { useAstroStore } from "../../lib/astro/store.ts";
import AstroOverlay from "./AstroOverlay.tsx";

describe("AstroOverlay tap interruption", () => {
  beforeEach(() => {
    useAstroStore.getState().setAnchor(null);
    useAstroStore.getState().setLookOrigin(0, 0, 60);
    useAstroStore.getState().setLive(false);
    useAstroStore.getState().setSpeaking(false);
    useAstroStore.getState().setVoice(null);
  });

  afterEach(() => {
    cleanup();
    useAstroStore.getState().setLive(false);
    useAstroStore.getState().setSpeaking(false);
    useAstroStore.getState().setVoice(null);
  });

  it("interrupts Astro on tap while speaking without starting or hanging up", () => {
    const start = vi.fn();
    const stop = vi.fn();
    const interrupt = vi.fn();
    useAstroStore.getState().setVoice({ start, stop, interrupt });
    useAstroStore.getState().setLive(true);
    useAstroStore.getState().setSpeaking(true);

    render(<AstroOverlay />);
    const handle = screen.getByRole("button", {
      name: "Astro está falando — toque para interrompê-lo",
    });
    handle.setPointerCapture = vi.fn();

    fireEvent.pointerDown(handle, { pointerId: 1, clientX: 200, clientY: 400 });
    fireEvent.pointerUp(handle, { pointerId: 1, clientX: 200, clientY: 400 });

    expect(interrupt).toHaveBeenCalledTimes(1);
    expect(start).not.toHaveBeenCalled();
    expect(stop).not.toHaveBeenCalled();
  });

  it("greets only without interrupting when Astro is live and silent", () => {
    const start = vi.fn();
    const stop = vi.fn();
    const interrupt = vi.fn();
    useAstroStore.getState().setVoice({ start, stop, interrupt });
    useAstroStore.getState().setLive(true);
    useAstroStore.getState().setSpeaking(false);

    render(<AstroOverlay />);
    const handle = screen.getByRole("button", {
      name: "Astro está ouvindo — toque para cumprimentá-lo",
    });
    handle.setPointerCapture = vi.fn();

    fireEvent.pointerDown(handle, { pointerId: 2, clientX: 200, clientY: 400 });
    fireEvent.pointerUp(handle, { pointerId: 2, clientX: 200, clientY: 400 });

    expect(interrupt).not.toHaveBeenCalled();
    expect(start).not.toHaveBeenCalled();
    expect(stop).not.toHaveBeenCalled();
  });
});

describe("AstroOverlay asleep", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    useAstroStore.getState().setAnchor(null);
    useAstroStore.getState().setLookOrigin(0, 0, 60);
    useAstroStore.getState().setLive(false);
    useAstroStore.getState().setSpeaking(false);
    useAstroStore.getState().syncSession("sleep", true);
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    useAstroStore.getState().setVoice(null);
    useAstroStore.getState().syncSession("idle", true);
  });

  const zs = (container: HTMLElement) => container.querySelectorAll(".astro-zs__z").length;

  it("draws the Zz while he sleeps, and not once he is awake", () => {
    const { container } = render(<AstroOverlay />);
    expect(zs(container)).toBe(2);

    act(() => useAstroStore.getState().syncSession("idle", true));
    expect(zs(container)).toBe(0);
  });

  it("wakes all the way on the tap that starts a conversation", () => {
    const start = vi.fn();
    useAstroStore.getState().setVoice({ start, stop: vi.fn() });

    render(<AstroOverlay />);
    const handle = screen.getByRole("button", { name: "Acordar o Astro e começar a conversar" });
    handle.setPointerCapture = vi.fn();

    fireEvent.pointerDown(handle, { pointerId: 3, clientX: 200, clientY: 400 });
    fireEvent.pointerUp(handle, { pointerId: 3, clientX: 200, clientY: 400 });
    expect(start).toHaveBeenCalledTimes(1);

    /* The reaction's settle must not drop him back to sleep while the socket connects. */
    act(() => vi.advanceTimersByTime(5_000));
    expect(useAstroStore.getState().expression).toBe("idle");
  });
});
