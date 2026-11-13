// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { createRef, type PropsWithChildren } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { getAskerMode, setAskerMode } from "../lib/asker-mode.ts";
import { PTT_HOLD_DELAY_MS, PTT_LOCK_THRESHOLD_PX } from "../lib/ptt-gesture.ts";
import { PTT_TOO_SHORT_HINT_MS } from "../lib/use-push-to-talk.ts";

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
    sendEvent: vi.fn(),
    options: null as null | {
      onToolCall: (call: { toolCall: { toolName: string; args: unknown } }) => unknown;
      sessionConfig: { instructions: string };
    },
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
  experimental_useRealtime: (options: typeof realtimeState.options) => {
    realtimeState.options = options;
    return realtimeState;
  },
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
import VoiceSession, { type VoiceSessionHandle } from "./VoiceSession.tsx";

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
    realtimeState.sendEvent.mockReset();
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
    await act(async () => {
      await vi.advanceTimersByTimeAsync(PTT_HOLD_DELAY_MS);
    });
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

  it("waits for Astro to finish before speaking a page report", () => {
    realtimeState.status = "connected";
    realtimeState.isPlaying = true;
    realtimeState.events = [{ type: "response-created" }];
    const { rerender } = render(<VoiceSession password="pw" />);

    /* A page lands while Astro is mid-sentence: the report is recorded, but no new response starts. */
    viewBuilderState.report = { text: "The page is ready." } as never;
    rerender(<VoiceSession password="pw" />);
    expect(realtimeState.sendEvent).toHaveBeenCalled();
    expect(realtimeState.requestResponse).not.toHaveBeenCalled();

    /* Once he has finished, the deferred report is spoken. */
    realtimeState.isPlaying = false;
    realtimeState.events = [{ type: "response-created" }, { type: "response-done" }];
    rerender(<VoiceSession password="pw" />);
    expect(realtimeState.requestResponse).toHaveBeenCalledTimes(1);

    viewBuilderState.report = null;
    realtimeState.sendEvent.mockClear();
    realtimeState.requestResponse.mockClear();
  });

  describe("push-to-talk gesture", () => {
    const buttonRect = {
      left: 0,
      right: 200,
      top: 400,
      bottom: 446,
      width: 200,
      height: 46,
      x: 0,
      y: 400,
      toJSON: () => ({}),
    } as DOMRect;

    const press = async (pointerId = 7, clientY = 420) => {
      fireEvent.pointerDown(screen.getByRole("button", { name: "Segurar para falar" }), {
        button: 0,
        pointerId,
        clientY,
      });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(PTT_HOLD_DELAY_MS);
      });
      return screen.getByRole("button", { name: "Solte para enviar" });
    };

    beforeEach(() => {
      vi.useFakeTimers();
      vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue(buttonRect);
      realtimeState.status = "connected";
    });

    afterEach(() => {
      vi.restoreAllMocks();
    });

    it("locks when the hold slides up, survives the lift, and a tap sends it", async () => {
      const vibrate = vi.fn();
      Object.defineProperty(navigator, "vibrate", { configurable: true, value: vibrate });
      render(<VoiceSession password="pw" />);

      const held = await press(7, 420);
      expect(realtimeState.startAudioCapture).toHaveBeenCalledTimes(1);

      /* Not far enough: still a plain hold, no buzz. */
      fireEvent.pointerMove(held, { pointerId: 7, clientY: 400 });
      expect(screen.getByRole("button", { name: "Solte para enviar" })).toBeTruthy();
      expect(vibrate).not.toHaveBeenCalled();

      /* Past the threshold: locked, with a buzz, the stop button, and a running timer. */
      fireEvent.pointerMove(held, { pointerId: 7, clientY: 420 - PTT_LOCK_THRESHOLD_PX });
      const locked = screen.getByRole("button", { name: "Parar e enviar" });
      expect(vibrate).toHaveBeenCalledTimes(1);
      expect(screen.getByRole("timer").textContent).toBe("0:00");
      await act(async () => {
        await vi.advanceTimersByTimeAsync(3000);
      });
      expect(screen.getByRole("timer").textContent).toBe("0:03");

      /* Lifting the finger, losing focus and waiting change nothing. */
      fireEvent.pointerUp(locked, { pointerId: 7 });
      fireEvent.blur(locked);
      await act(async () => {
        await vi.advanceTimersByTimeAsync(2000);
      });
      expect(screen.getByRole("button", { name: "Parar e enviar" })).toBeTruthy();
      expect(realtimeState.stopAudioCapture).not.toHaveBeenCalled();

      /* A tap on stop ends it exactly like a normal release: tail, silence flush, stop. */
      fireEvent.pointerDown(screen.getByRole("button", { name: "Parar e enviar" }), {
        button: 0,
        pointerId: 8,
      });
      expect(screen.getByRole("button", { name: "Segurar para falar" })).toBeTruthy();
      await act(async () => {
        await vi.advanceTimersByTimeAsync(2000);
      });
      expect(realtimeState.stopAudioCapture).toHaveBeenCalledTimes(1);
    });

    it("ends as a normal release when the finger lifts before the threshold", async () => {
      render(<VoiceSession password="pw" />);
      const held = await press();
      await act(async () => {
        await vi.advanceTimersByTimeAsync(300);
      });
      fireEvent.pointerMove(held, { pointerId: 7, clientY: 400 });
      fireEvent.pointerUp(held, { pointerId: 7 });

      expect(screen.getByRole("button", { name: "Segurar para falar" })).toBeTruthy();
      await act(async () => {
        await vi.advanceTimersByTimeAsync(2000);
      });
      expect(realtimeState.stopAudioCapture).toHaveBeenCalledTimes(1);
    });

    it("ends the recording when the finger is dragged off the button", async () => {
      render(<VoiceSession password="pw" />);
      const held = await press();
      await act(async () => {
        await vi.advanceTimersByTimeAsync(300);
      });
      fireEvent.pointerMove(held, { pointerId: 7, clientX: 500, clientY: 430 });

      expect(screen.getByRole("button", { name: "Segurar para falar" })).toBeTruthy();
      await act(async () => {
        await vi.advanceTimersByTimeAsync(2000);
      });
      expect(realtimeState.stopAudioCapture).toHaveBeenCalledTimes(1);
    });

    it("does not record on a tap that is too short, and says how the button works", async () => {
      render(<VoiceSession password="pw" />);
      const button = screen.getByRole("button", { name: "Segurar para falar" });
      fireEvent.pointerDown(button, { button: 0, pointerId: 3, clientY: 420 });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(50);
      });
      fireEvent.pointerUp(screen.getByRole("button", { name: "Solte para enviar" }), {
        pointerId: 3,
      });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(PTT_HOLD_DELAY_MS * 2);
      });

      expect(realtimeState.startAudioCapture).not.toHaveBeenCalled();
      expect(realtimeState.stopPlayback).not.toHaveBeenCalled();
      expect(screen.getByText("Segure para falar")).toBeTruthy();

      await act(async () => {
        await vi.advanceTimersByTimeAsync(PTT_TOO_SHORT_HINT_MS);
      });
      expect(screen.queryByText("Segure para falar")).toBeNull();
    });
  });

  it("lets the user close a floating notice", () => {
    realtimeState.status = "connected";
    render(<VoiceSession password="pw" />);

    Object.defineProperty(document, "hidden", { configurable: true, value: true });
    act(() => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    Object.defineProperty(document, "hidden", { configurable: true, value: false });

    expect(screen.getByText(/segundo plano/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Fechar aviso" }));
    expect(screen.queryByText(/segundo plano/)).toBeNull();
  });

  it("refuses to change the page for an app-started response, but not for the user's request", async () => {
    vi.useFakeTimers();
    realtimeState.status = "connected";
    const { rerender } = render(<VoiceSession password="pw" />);
    const renderView = { toolCall: { toolName: "render_view", args: { request: "add a chart" } } };

    /* The app asks Astro to speak (a page landed): that response may not edit anything. */
    viewBuilderState.report = { text: "The page threw an error." } as never;
    rerender(<VoiceSession password="pw" />);
    expect(realtimeState.requestResponse).toHaveBeenCalledTimes(1);
    expect(realtimeState.options?.onToolCall(renderView)).toMatchObject({ ok: false });
    expect(viewBuilderState.build).not.toHaveBeenCalled();

    /* The user speaks: now a tool call is theirs. */
    fireEvent.pointerDown(screen.getByRole("button", { name: "Segurar para falar" }), {
      button: 0,
      pointerId: 5,
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(PTT_HOLD_DELAY_MS);
    });
    expect(realtimeState.options?.onToolCall(renderView)).toMatchObject({ ok: true });
    expect(viewBuilderState.build).toHaveBeenCalledTimes(1);

    viewBuilderState.report = null;
  });

  describe("asker mode", () => {
    afterEach(() => setAskerMode(false));

    it("swaps in the asker prompt, keeps the normal prompt as it is, and stays stable across renders", () => {
      const sessionRef = createRef<VoiceSessionHandle>();
      const { rerender } = render(<VoiceSession password="pw" sessionRef={sessionRef} />);
      const normal = realtimeState.options?.sessionConfig;
      expect(normal?.instructions).not.toContain("ASKER MODE");

      act(() => sessionRef.current?.changeMode(true));
      const asker = realtimeState.options?.sessionConfig;
      expect(getAskerMode()).toBe(true);
      expect(asker?.instructions).toContain("ASKER MODE");
      expect(asker?.instructions.startsWith(normal?.instructions ?? "-")).toBe(true);
      expect(screen.getByText(/Modo perguntador ativado/)).toBeTruthy();

      /* Same object on every render: a fresh one would rebuild the session in a loop. */
      rerender(<VoiceSession password="pw" sessionRef={sessionRef} />);
      expect(realtimeState.options?.sessionConfig).toBe(asker);

      act(() => sessionRef.current?.changeMode(false));
      expect(realtimeState.options?.sessionConfig).toBe(normal);
    });

    it("hangs up a live conversation before switching", () => {
      realtimeState.status = "connected";
      const sessionRef = createRef<VoiceSessionHandle>();
      render(<VoiceSession password="pw" sessionRef={sessionRef} />);
      realtimeState.disconnect.mockClear();

      act(() => sessionRef.current?.changeMode(true));
      expect(realtimeState.disconnect).toHaveBeenCalledTimes(1);
      expect(screen.getByText(/A conversa foi reiniciada/)).toBeTruthy();
    });
  });

  it("shows Push-to-Talk only once the session is connected", () => {
    realtimeState.status = "disconnected";
    const { rerender } = render(<VoiceSession password="pw" />);
    expect(screen.queryByRole("button", { name: "Segurar para falar" })).toBeNull();

    realtimeState.status = "connecting";
    rerender(<VoiceSession password="pw" />);
    expect(screen.queryByRole("button", { name: "Segurar para falar" })).toBeNull();

    realtimeState.status = "connected";
    rerender(<VoiceSession password="pw" />);
    expect(screen.getByRole("button", { name: "Segurar para falar" })).toBeTruthy();
  });

  it("discards a recording released the instant it starts, without manual buffer commands", async () => {
    vi.useFakeTimers();
    realtimeState.status = "connected";
    realtimeState.isPlaying = false;

    render(<VoiceSession password="pw" />);
    const pttBtn = screen.getByRole("button", { name: "Segurar para falar" });
    fireEvent.pointerDown(pttBtn, { button: 0, pointerId: 2 });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(PTT_HOLD_DELAY_MS);
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
