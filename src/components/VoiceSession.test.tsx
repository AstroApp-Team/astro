// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { PropsWithChildren } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

const { realtimeState, viewBuilderState } = vi.hoisted(() => ({
  realtimeState: {
    status: "disconnected" as "disconnected" | "connecting" | "connected",
    messages: [] as Array<{
      id: string;
      role: string;
      parts: Array<{ type: string; text?: string }>;
    }>,
    events: [] as Array<{ type: string }>,
    isCapturing: false,
    isPlaying: false,
    error: undefined as Error | undefined,
    connect: vi.fn(async () => {}),
    disconnect: vi.fn(),
    sendMessage: vi.fn(),
    startAudioCapture: vi.fn(async () => {}),
    stopAudioCapture: vi.fn(),
    commitAudio: vi.fn(),
    clearAudioBuffer: vi.fn(),
    requestResponse: vi.fn(),
    stopPlayback: vi.fn(),
    cancelResponse: vi.fn(),
  },
  viewBuilderState: {
    screen: null as { title: string; html: string } | null,
    finishedHtml: null as string | null,
    hasView: false,
    status: null as string | null,
    failure: null as string | null,
    report: null,
    lastCheckedView: null,
    build: vi.fn(),
    loadView: vi.fn(),
  },
}));

vi.mock("@ai-sdk/react", () => ({
  experimental_useRealtime: () => realtimeState,
}));

vi.mock("@ionic/react", () => {
  const PassThrough = ({ children, ...rest }: PropsWithChildren<Record<string, unknown>>) => (
    <div {...rest}>{children}</div>
  );
  return {
    IonBadge: PassThrough,
    IonButtons: PassThrough,
    IonContent: PassThrough,
    IonFooter: ({ children, ...rest }: PropsWithChildren<Record<string, unknown>>) => (
      <footer {...rest}>{children}</footer>
    ),
    IonHeader: ({ children, ...rest }: PropsWithChildren<Record<string, unknown>>) => (
      <header {...rest}>{children}</header>
    ),
    IonModal: () => null,
    IonNote: ({ children, ...rest }: PropsWithChildren<Record<string, unknown>>) => (
      <span {...rest}>{children}</span>
    ),
    IonSpinner: () => null,
    IonTitle: ({ children, ...rest }: PropsWithChildren<Record<string, unknown>>) => (
      <h1 {...rest}>{children}</h1>
    ),
    IonToolbar: PassThrough,
  };
});

vi.mock("../lib/use-view-builder.ts", () => ({
  useViewBuilder: () => viewBuilderState,
}));

vi.mock("../lib/use-view-events.ts", () => ({
  describeViewEvent: () => "",
  useViewEvents: () => ({
    frameRef: { current: null },
    event: null,
    pageErrors: [],
    latestState: undefined,
    onFrameLoad: vi.fn(),
    restoreState: vi.fn(),
  }),
}));

vi.mock("../lib/use-projects.ts", () => ({
  useProjectAutoSave: vi.fn(),
}));

vi.mock("../lib/use-idle-hang-up.ts", () => ({
  useIdleHangUp: vi.fn(),
}));

vi.mock("./ProjectsSheet.tsx", () => ({
  default: ({ onNewProject }: { onNewProject: () => void }) => (
    <button type="button" onClick={onNewProject}>
      Mock new project
    </button>
  ),
}));

import { ASTRO_HERO_SCALE, characterScale } from "../lib/astro/corner.ts";
import { useAstroStore } from "../lib/astro/store.ts";
import VoiceSession from "./VoiceSession.tsx";

describe("VoiceSession hero Astro lifecycle", () => {
  const originalGetBoundingClientRect = Element.prototype.getBoundingClientRect;
  const originalMediaDevices = Object.getOwnPropertyDescriptor(navigator, "mediaDevices");

  function createMockAudioStream(): MediaStream {
    const track = { readyState: "live", enabled: true, stop: vi.fn() };
    return {
      getAudioTracks: () => [track],
      getTracks: () => [track],
      clone: () => createMockAudioStream(),
    } as unknown as MediaStream;
  }

  beforeEach(() => {
    realtimeState.status = "disconnected";
    realtimeState.events = [];
    realtimeState.isPlaying = false;
    realtimeState.isCapturing = false;
    realtimeState.startAudioCapture.mockReset();
    realtimeState.stopAudioCapture.mockReset();
    realtimeState.commitAudio.mockReset();
    realtimeState.clearAudioBuffer.mockReset();
    realtimeState.requestResponse.mockReset();
    realtimeState.stopPlayback.mockReset();
    realtimeState.cancelResponse.mockReset();
    viewBuilderState.screen = null;
    viewBuilderState.status = null;
    viewBuilderState.loadView.mockReset();

    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: {
        getUserMedia: vi.fn(async () => createMockAudioStream()),
      },
    });

    useAstroStore.getState().setAnchor(null);
    useAstroStore.getState().setHeroSpot(null);
    useAstroStore.getState().setLive(false);
    useAstroStore.getState().setSpeaking(false);

    Object.defineProperty(window, "innerWidth", { configurable: true, value: 400 });
    Object.defineProperty(window, "innerHeight", { configurable: true, value: 800 });
    Element.prototype.getBoundingClientRect = function getRect() {
      if (this.classList.contains("voice-stage__astro-hero-slot")) {
        return {
          x: 100,
          y: 160,
          left: 100,
          top: 160,
          width: 200,
          height: 200,
          right: 300,
          bottom: 360,
          toJSON: () => ({}),
        } as DOMRect;
      }
      return originalGetBoundingClientRect.call(this);
    };
  });

  afterEach(() => {
    vi.useRealTimers();
    cleanup();
    Element.prototype.getBoundingClientRect = originalGetBoundingClientRect;
    if (originalMediaDevices) {
      Object.defineProperty(navigator, "mediaDevices", originalMediaDevices);
    } else {
      Reflect.deleteProperty(navigator, "mediaDevices");
    }
    useAstroStore.getState().setAnchor(null);
    useAstroStore.getState().setHeroSpot(null);
    useAstroStore.getState().setLive(false);
    useAstroStore.getState().setSpeaking(false);
  });

  it("keeps Astro enlarged until development starts, then shrinks to default and re-enlarges on new project", () => {
    const { rerender } = render(<VoiceSession password="pw" />);

    expect(useAstroStore.getState().heroSpot).not.toBeNull();
    expect(characterScale(useAstroStore.getState().heroSpot != null, false)).toBe(ASTRO_HERO_SCALE);

    /* Connecting / talking before any page begins building keeps Astro enlarged center-stage. */
    realtimeState.status = "connected";
    rerender(<VoiceSession password="pw" />);
    expect(useAstroStore.getState().heroSpot).not.toBeNull();
    expect(characterScale(useAstroStore.getState().heroSpot != null, false)).toBe(ASTRO_HERO_SCALE);

    /* As soon as the coding agent starts building, hero mode exits so Astro shrinks to 1. */
    viewBuilderState.status = "Iniciando…";
    rerender(<VoiceSession password="pw" />);
    expect(useAstroStore.getState().heroSpot).toBeNull();
    expect(characterScale(useAstroStore.getState().heroSpot != null, false)).toBe(1);

    /* Creating a new blank project clears view/status and anchor so Astro grows back in hero spot. */
    useAstroStore.getState().setAnchor({ x: 0.5, y: -0.5 });
    viewBuilderState.status = null;
    fireEvent.click(screen.getByRole("button", { name: "Mock new project" }));
    expect(viewBuilderState.loadView).toHaveBeenCalledWith(null);
    expect(useAstroStore.getState().anchor).toBeNull();
    rerender(<VoiceSession password="pw" />);
    expect(useAstroStore.getState().heroSpot).not.toBeNull();
    expect(
      characterScale(
        useAstroStore.getState().heroSpot != null,
        useAstroStore.getState().anchor != null,
      ),
    ).toBe(ASTRO_HERO_SCALE);
  });

  it("interrupts Astro cleanly while Push-to-Talk stays under manual hold control", async () => {
    vi.useFakeTimers();
    realtimeState.status = "connected";
    realtimeState.isPlaying = false;

    const { rerender } = render(<VoiceSession password="pw" />);
    expect(screen.getByRole("button", { name: "Segurar para falar" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Interromper Astro" })).toBeNull();
    expect(useAstroStore.getState().speaking).toBe(false);

    /* Astro starts speaking: Interrupt pill and 3D store flag activate while PTT remains idle. */
    realtimeState.isPlaying = true;
    realtimeState.events = [{ type: "response-created" }];
    rerender(<VoiceSession password="pw" />);
    expect(useAstroStore.getState().speaking).toBe(true);
    expect(screen.getByRole("button", { name: "Segurar para falar" })).toBeTruthy();

    /* Clicking Interromper stops Astro without capturing or committing user speech. */
    fireEvent.click(screen.getByRole("button", { name: "Interromper Astro" }));
    expect(realtimeState.stopPlayback).toHaveBeenCalledTimes(1);
    expect(realtimeState.cancelResponse).toHaveBeenCalledTimes(1);
    expect(realtimeState.startAudioCapture).not.toHaveBeenCalled();
    expect(realtimeState.commitAudio).not.toHaveBeenCalled();
    expect(realtimeState.requestResponse).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Segurar para falar" })).toBeTruthy();

    /* Tapping Astro 3D (through the store bridge) also interrupts without starting PTT. */
    realtimeState.stopPlayback.mockClear();
    realtimeState.cancelResponse.mockClear();
    useAstroStore.getState().voice?.interrupt?.();
    expect(realtimeState.stopPlayback).toHaveBeenCalledTimes(1);
    expect(realtimeState.cancelResponse).toHaveBeenCalledTimes(1);
    expect(realtimeState.startAudioCapture).not.toHaveBeenCalled();

    /* Holding Push-to-Talk while Astro speaks interrupts him, captures audio, then commits after the release tail. */
    realtimeState.stopPlayback.mockClear();
    realtimeState.cancelResponse.mockClear();
    const pttBtn = screen.getByRole("button", { name: "Segurar para falar" });
    fireEvent.pointerDown(pttBtn, { button: 0, pointerId: 1 });
    expect(realtimeState.stopPlayback).toHaveBeenCalledTimes(1);
    expect(realtimeState.cancelResponse).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: "Solte para enviar" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Interromper Astro" })).toBeNull();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(realtimeState.startAudioCapture).toHaveBeenCalledTimes(1);

    /* Mark Astro silent before releasing so we verify the full hold -> tail -> VAD silence flush -> stop cycle. */
    realtimeState.isPlaying = false;
    realtimeState.events = [];
    rerender(<VoiceSession password="pw" />);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });
    fireEvent.pointerUp(screen.getByRole("button", { name: "Solte para enviar" }), {
      pointerId: 1,
    });
    expect(screen.getByRole("button", { name: "Segurar para falar" })).toBeTruthy();
    expect(realtimeState.stopAudioCapture).not.toHaveBeenCalled();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(180);
    });
    expect(realtimeState.stopAudioCapture).not.toHaveBeenCalled();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(600);
    });
    expect(realtimeState.stopAudioCapture).toHaveBeenCalledTimes(1);
    expect(realtimeState.commitAudio).not.toHaveBeenCalled();
    expect(realtimeState.requestResponse).not.toHaveBeenCalled();
  });

  it("discards an accidental Push-to-Talk micro-tap immediately without manual buffer commands", async () => {
    vi.useFakeTimers();
    realtimeState.status = "connected";
    realtimeState.isPlaying = false;

    render(<VoiceSession password="pw" />);
    const pttBtn = screen.getByRole("button", { name: "Segurar para falar" });
    fireEvent.pointerDown(pttBtn, { button: 0, pointerId: 2 });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(50);
    });
    fireEvent.pointerUp(screen.getByRole("button", { name: "Solte para enviar" }), {
      pointerId: 2,
    });

    expect(realtimeState.stopAudioCapture).toHaveBeenCalledTimes(1);
    expect(realtimeState.clearAudioBuffer).not.toHaveBeenCalled();
    expect(realtimeState.commitAudio).not.toHaveBeenCalled();
    expect(realtimeState.requestResponse).not.toHaveBeenCalled();
  });
});
