import { experimental_useRealtime, type Experimental_UseRealtimeOptions } from "@ai-sdk/react";
import {
  IonBadge,
  IonButtons,
  IonContent,
  IonFooter,
  IonHeader,
  IonModal,
  IonNote,
  IonSpinner,
  IonTitle,
  IonToolbar,
} from "@ionic/react";
import { gateway } from "ai";
import { useEffect, useRef, useState } from "react";

import {
  AUDIO_FORMAT_TYPE,
  AUDIO_SAMPLE_RATE,
  parseRebuildViewArgs,
  parseRenderViewArgs,
  REBUILD_VIEW_TOOL_NAME,
  RENDER_VIEW_TOOL_NAME,
  VOICE_MODEL_ID,
  VOICE_NAME,
  voiceTurnUsd,
} from "../../shared/realtime.ts";
import { realtimeSetupUrl } from "../lib/api.ts";
import { ASTRO_DEFAULT_EXPRESSION } from "../lib/astro/astro.ts";
import { faceForSession, pixelsToViewport } from "../lib/astro/interaction.ts";
import {
  cloneAudioStream,
  hasLiveAudioTrack,
  setAudioTracksEnabled,
  stopMediaStream,
} from "../lib/media-stream.ts";
import { sealViewHtml, VIEW_ALLOW, VIEW_SANDBOX } from "../lib/seal-view.ts";
import { useAstroStore } from "../lib/astro/store.ts";
import { useIdleHangUp } from "../lib/use-idle-hang-up.ts";
import { useMediaQuery } from "../lib/use-media-query.ts";
import { useProjectAutoSave } from "../lib/use-projects.ts";
import { useViewBuilder } from "../lib/use-view-builder.ts";
import { describeViewEvent, useViewEvents } from "../lib/use-view-events.ts";
import { addVoiceCost, startSessionClock, stopSessionClock } from "../lib/voice-usage.ts";
import AudioWaveform from "./AudioWaveform.tsx";
import LiquidGlassIcon from "./LiquidGlassIcon.tsx";
import ProjectsSheet, { type LoadedProject } from "./ProjectsSheet.tsx";
import UsageMeter from "./UsageMeter.tsx";

/**
 * Both of these are compared by identity inside the hook: a fresh object on
 * every render tears the session down and rebuilds it in a loop. They are
 * module constants for that reason, not as a micro-optimization.
 *
 * `gateway.experimental_realtime(...)` is safe in the browser — it holds no
 * credential. Minting the token is what needs the Gateway key, and that happens
 * on the Worker.
 */
const voiceModel = gateway.experimental_realtime(VOICE_MODEL_ID);

const sessionConfig = {
  instructions:
    "You are Astro, a friendly voice assistant with a screen. Keep replies " +
    "short and conversational — one or two sentences unless asked for more.\n\n" +
    "You can put things on that screen with the render_view tool, which hands " +
    "the job to a coding agent. Reach for it whenever the answer is better seen " +
    "than heard, and describe what you want in full — the coding agent cannot " +
    "hear the conversation and knows only what you write. It edits whatever is " +
    "already on screen without losing the user's place, so changing a running " +
    "page (or game) mid-use is cheap and encouraged — for a tweak, describe " +
    "just the change.\n\n" +
    "When a page has outgrown quick edits — the user says things are broken, " +
    "inconsistent or missing, a change broke something else, or the app reports " +
    "errors from the page — call rebuild_view instead: a stronger model rewrites " +
    "it cleanly from the features asked for so far, keeping the user's data. It " +
    "is slower, so tell the user it will take a moment.\n\n" +
    "render_view returns the moment the work starts, not when the page is " +
    "ready. Say something to fill the wait, then stop and let the user speak. " +
    "Messages that begin with '(app status)' are the app talking to you, not " +
    "the user: no one said them aloud. Use them to tell the user the page has " +
    "landed, what it shows, or that it failed — briefly, and never read one out " +
    "word for word.",
  voice: VOICE_NAME,
  // Stated explicitly so the browser's capture/playback rate and the model's
  // format cannot disagree. Omit these and the provider picks its own.
  inputAudioFormat: { type: AUDIO_FORMAT_TYPE, rate: AUDIO_SAMPLE_RATE },
  outputAudioFormat: { type: AUDIO_FORMAT_TYPE, rate: AUDIO_SAMPLE_RATE },
  // The transcript below is built entirely from transcription events. Asking
  // for both directions explicitly beats relying on a provider default —
  // without them the audio still works and the page just looks empty.
  inputAudioTranscription: {},
  outputAudioTranscription: {},
  // Server-side VAD: the model decides when a turn ends, so there is no
  // push-to-talk button.
  turnDetection: { type: "server-vad" },
} satisfies NonNullable<Experimental_UseRealtimeOptions["sessionConfig"]>;

/**
 * One conversation. The parent remounts this with a new `key` to clear it —
 * the hook keeps its store in a ref, so a remount is what starts a fresh one.
 */

/** Wide enough to dock the transcript beside the page instead of a sheet over it. */
const DOCKED_TRANSCRIPT_QUERY = "(min-width: 900px)";

/** How often the voice may *speak about* page events. See the effect below. */
const EVENT_SPEECH_THROTTLE_MS = 5_000;

/** Rotating orange prompts shown under Astro on the initial welcome screen. */
const HERO_PROMPTS = [
  "Qual é a vibe de hoje?",
  "O que vamos criar hoje?",
  "Qual é a ideia do dia?",
] as const;

const HERO_PROMPT_INTERVAL_MS = 4_200;

/** Brief silent tail before stopping capture so server-VAD closes the user's turn cleanly. */
const MUTE_SILENCE_TAIL_MS = 350;

/** Ignore leftover audio frames from an interrupted reply for this window (ms). */
const INTERRUPT_SUPPRESS_MS = 1_500;

/** Ignore startup iframe events/errors right after switching projects so Astro stays silent. */
const PROJECT_SWITCH_SILENCE_MS = 1_500;

function isResponseActive(events: ReadonlyArray<{ type: string }>): boolean {
  for (let i = events.length - 1; i >= 0; i--) {
    const type = events[i]?.type;
    if (type === "response-done" || type === "speech-started" || type === "session-closed") {
      return false;
    }
    if (
      type === "response-created" ||
      type === "audio-delta" ||
      type === "audio-chunk" ||
      type === "audio-transcript-delta" ||
      type === "text-delta"
    ) {
      return true;
    }
  }
  return false;
}

export default function VoiceSession({
  password,
  fullscreen = false,
  onExitFullscreen,
}: {
  password: string;
  fullscreen?: boolean;
  onExitFullscreen?: () => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [hasStarted, setHasStarted] = useState(false);
  const [promptIndex, setPromptIndex] = useState(0);
  /**
   * Muted keeps the session open and pauses the microphone.
   *
   * Deliberately not the same thing as hanging up: the socket bills by the second either
   * way, so muting is the cheap gesture and ending is the expensive one. Keeping the
   * master tracks alive in `streamRef` (and handing a clone to `realtime`) means
   * unmuting with "Falar" resumes cleanly without re-prompting for permission.
   */
  const [muted, setMuted] = useState(false);
  const streamRef = useRef<MediaStream | null>(null);
  const captureStreamRef = useRef<MediaStream | null>(null);
  const muteStopTimerRef = useRef<number | null>(null);
  const suppressIndexRef = useRef(0);
  const suppressUntilRef = useRef(0);
  const suppressProjectEventsUntilRef = useRef(0);
  const mountedRef = useRef(true);
  const [micStream, setMicStream] = useState<MediaStream | null>(null);
  const [activeProjectId, setActiveProjectId] = useState<string | null>(null);

  const clearMuteTimer = () => {
    if (muteStopTimerRef.current != null) {
      window.clearTimeout(muteStopTimerRef.current);
      muteStopTimerRef.current = null;
    }
  };

  const viewBuilder = useViewBuilder({ password });

  /**
   * Clicks inside a published view reach the model the same way a finished
   * build does: as state here, spoken from an effect. Errors the live page
   * throws are kept too — they ride along with the next build request.
   */
  const {
    frameRef,
    event: viewEvent,
    pageErrors,
    latestState,
    onFrameLoad,
    restoreState,
  } = useViewEvents({ finishedHtml: viewBuilder.finishedHtml });

  useProjectAutoSave({
    password,
    activeProjectId,
    onProjectCreated: setActiveProjectId,
    lastCheckedView: viewBuilder.lastCheckedView,
    latestState,
  });

  const realtime = experimental_useRealtime({
    model: voiceModel,
    api: { token: realtimeSetupUrl(password) },
    sessionConfig,
    sampleRate: AUDIO_SAMPLE_RATE,
    /**
     * Whatever this returns (as long as it is not `undefined`) is sent back as
     * the tool output, and the SDK asks for the follow-up response itself once
     * every call in the turn has answered. Returning nothing leaves the model
     * waiting on a result that never arrives, so the failure path returns too.
     *
     * It answers immediately and lets the build run on: holding the model for
     * the twenty seconds the coding agent needs would buy nothing but silence.
     * `useViewBuilder` reports back through `reportToVoice` when there is
     * actually news.
     */
    onToolCall: ({ toolCall }) => {
      const errors = pageErrors.map((error) => error.message);

      if (toolCall.toolName === REBUILD_VIEW_TOOL_NAME) {
        const args = parseRebuildViewArgs(toolCall.args);
        if (args == null) {
          return { ok: false, error: "rebuild_view needs a non-empty `reason` string." };
        }
        if (!viewBuilder.hasView) {
          return { ok: false, error: "There is no page on screen to rebuild. Use render_view." };
        }

        viewBuilder.build(args.reason, { mode: "rebuild", pageErrors: errors });
        return {
          ok: true,
          status: "rebuilding",
          note: "A stronger model is rewriting the page; it takes a while. Tell the user, then wait — you will get an (app status) message when it lands.",
        };
      }

      if (toolCall.toolName !== RENDER_VIEW_TOOL_NAME) {
        return { ok: false, error: `Astro has no tool called ${toolCall.toolName}.` };
      }

      const args = parseRenderViewArgs(toolCall.args);
      if (args == null) {
        return { ok: false, error: "render_view needs a non-empty `request` string." };
      }

      viewBuilder.build(args.request, { pageErrors: errors });
      return {
        ok: true,
        status: "building",
        note: "The coding agent is working. Say something to the user, then wait — you will get an (app status) message when the page lands.",
      };
    },
    onEvent: (event) => {
      /* Gemini states each turn's token usage on its raw `response-done`. */
      if (event.type === "response-done") {
        const usd = voiceTurnUsd(event.raw);
        if (usd != null) addVoiceCost(usd);
      }
    },
    onError: (sessionError) => setError(sessionError.message),
  });

  const { status, messages, events, isCapturing, isPlaying, startAudioCapture, stopPlayback } =
    realtime;

  const eventsRef = useRef(events);
  const statusRef = useRef(status);
  const cancelResponseRef = useRef(realtime.cancelResponse);
  const stopPlaybackRef = useRef(stopPlayback);
  useEffect(() => {
    eventsRef.current = events;
    statusRef.current = status;
    cancelResponseRef.current = realtime.cancelResponse;
    stopPlaybackRef.current = stopPlayback;
  });

  useEffect(() => {
    if (suppressUntilRef.current <= Date.now()) return;

    for (let i = suppressIndexRef.current; i < events.length; i++) {
      const type = events[i]?.type;
      if (
        type === "response-done" ||
        type === "response-created" ||
        type === "input-transcription-completed" ||
        type === "audio-committed" ||
        type === "speech-started"
      ) {
        suppressUntilRef.current = 0;
        return;
      }
    }

    if (isPlaying) {
      stopPlayback();
    }
  }, [events, isPlaying, stopPlayback]);

  /**
   * The app's side of the conversation: everything the model learns without a
   * person saying it. It goes in as a *user* item because that is the only role
   * the realtime protocol accepts from a client — hence the prefix, which the
   * instructions explain so the model does not read these aloud.
   */
  const reportToVoice = (report: string, { speak = true } = {}) => {
    if (status !== "connected") return;
    realtime.sendEvent({
      type: "conversation-item-create",
      item: { type: "text-message", role: "user", text: `(app status) ${report}` },
    });
    if (speak) realtime.requestResponse();
  };

  /**
   * Held in a ref for the same reason as `stopRef` below: the realtime hook
   * re-binds its methods every render, so depending on `reportToVoice`
   * directly would re-run the effects under it on every render and report the
   * same news repeatedly.
   */
  const reportRef = useRef(reportToVoice);
  useEffect(() => {
    reportRef.current = reportToVoice;
  });

  /**
   * The coding agent finishes long after the tool call that started it, so the
   * news arrives as state and is spoken from here.
   */
  useEffect(() => {
    if (viewBuilder.report == null) return;
    reportRef.current(viewBuilder.report.text);
  }, [viewBuilder.report]);

  /**
   * Every event goes into the conversation, but a *spoken* reaction is
   * throttled: a game posts an event per click, and a voice that starts
   * talking on each one would make the page unplayable. Between utterances
   * the model still accumulates the events silently, so its next turn knows
   * everything that happened.
   */
  const lastSpokenEventRef = useRef(0);

  useEffect(() => {
    if (viewEvent == null) return;
    if (Date.now() < suppressProjectEventsUntilRef.current) return;

    const speak = Date.now() - lastSpokenEventRef.current > EVENT_SPEECH_THROTTLE_MS;
    if (speak) lastSpokenEventRef.current = Date.now();
    reportRef.current(describeViewEvent(viewEvent), { speak });
  }, [viewEvent]);

  /**
   * A page error goes into the conversation silently: the user may not have
   * noticed, but the model should know when it next decides whether a page
   * needs a rebuild rather than another edit.
   */
  const latestPageError = pageErrors.at(-1);
  useEffect(() => {
    if (latestPageError == null) return;
    if (Date.now() < suppressProjectEventsUntilRef.current) return;
    reportRef.current(`The page threw an error: ${latestPageError.message}`, { speak: false });
  }, [latestPageError]);

  /**
   * Connected time, shown beside the cost. Stopping on unmount matters: the
   * Clear button remounts this component, and a clock left running would keep
   * counting a socket that no longer exists.
   */
  useEffect(() => {
    if (status !== "connected") return;

    startSessionClock();
    return () => stopSessionClock();
  }, [status]);

  /**
   * The session's lifecycle, shown as a face.
   *
   * The store is the only channel between this component and the character — the
   * same rule the rest of the page follows, and the reason the hero never reaches
   * into a mesh: this writes a derived expression, the hero draws it. Reading it
   * from `status` alone (rather than from the transcript) is what keeps a turn with
   * no text at all — a tool call — from showing nothing.
   *
   * The cleanup parks the character when the session goes away. `Clear` remounts
   * this component and `Forget the password` replaces it with the gate, and without
   * a cleanup the last face of a dead session — `look-right`, say — would stay on
   * the screen as if something were still happening.
   */
  useEffect(() => {
    const face = faceForSession({
      status,
      isCapturing: isCapturing && !muted,
      isPlaying,
      hasError: error != null,
    });
    const store = useAstroStore.getState();
    store.syncSession(face.expression, face.sustained);

    return () => {
      /* Unmounting (Clear, Forget password) must not leave a dead session's face up, and it
         must not leave him asleep either: `idle` is the state a visitor finds him in. */
      useAstroStore.getState().syncSession(ASTRO_DEFAULT_EXPRESSION, true);
    };
  }, [status, isCapturing, muted, isPlaying, error]);

  const isPlayingRef = useRef(isPlaying);
  useEffect(() => {
    isPlayingRef.current = isPlaying;
  });

  /**
   * Events sent before the socket opens are dropped, so capture waits for
   * `connected` (which the SDK sets on the session-created event) rather than
   * starting right after `connect()` resolves.
   *
   * `realtime.stopAudioCapture()` stops every track on the stream it receives when
   * `api.token` is set, so we pass a clone while `streamRef` holds the live master
   * stream for `AudioWaveform` and subsequent "Falar" resumes.
   */
  useEffect(() => {
    if (status !== "connected" || isCapturing || muted) return;

    const master = streamRef.current;
    if (!master || !hasLiveAudioTrack(master)) return;

    stopMediaStream(captureStreamRef.current);
    const captureStream = cloneAudioStream(master);
    setAudioTracksEnabled(captureStream, true);
    captureStreamRef.current = captureStream;
    startAudioCapture(captureStream);
    if (isPlayingRef.current) {
      setAudioTracksEnabled(captureStream, false);
    }
  }, [status, isCapturing, muted, micStream, startAudioCapture]);

  /**
   * The model must never hear itself, and pausing with `[■]` must immediately
   * send silence rather than room noise while closing out any active speech turn.
   */
  useEffect(() => {
    setAudioTracksEnabled(captureStreamRef.current, !isPlaying && !muted);
  }, [isPlaying, muted]);

  /* Clean up any cloned capture tracks when leaving the connected state. */
  useEffect(() => {
    if (status !== "connected") return;
    return () => {
      clearMuteTimer();
      stopMediaStream(captureStreamRef.current);
      captureStreamRef.current = null;
    };
  }, [status]);

  /* Release the microphone if the page navigates away mid-conversation. */
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      clearMuteTimer();
      stopMediaStream(captureStreamRef.current);
      captureStreamRef.current = null;
      stopMediaStream(streamRef.current);
      streamRef.current = null;
    };
  }, []);

  const openMicrophone = async (): Promise<boolean> => {
    /*
     * `navigator.mediaDevices` is undefined outside a secure context, and reading
     * `.getUserMedia` off it throws the `TypeError` that used to surface here as
     * "The microphone could not be opened (TypeError)." — accurate, unactionable, and it
     * pointed at the device when the problem was the URL. Browsers expose the microphone on
     * `https`, on `localhost`, and inside the app's own WebView; a LAN address such as
     * `http://192.168.1.5:5199`, which is exactly where a phone test starts, gets nothing.
     */
    if (navigator.mediaDevices?.getUserMedia === undefined) {
      setError(
        window.isSecureContext === false
          ? "O microfone precisa de HTTPS ou localhost — esta página foi aberta via HTTP simples."
          : "Este navegador não disponibiliza uma API de microfone.",
      );
      return false;
    }

    try {
      stopMediaStream(captureStreamRef.current);
      captureStreamRef.current = null;
      stopMediaStream(streamRef.current);
      streamRef.current = null;

      // Requested inside the click so the permission prompt lands in the
      // user's gesture, and so the AudioContext is allowed to make sound.
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (!mountedRef.current) {
        stopMediaStream(stream);
        return false;
      }
      streamRef.current = stream;
      setMicStream(stream);
      return true;
    } catch (cause) {
      /**
       * The name matters: every failure here used to read as "denied", which
       * sent us hunting for a permission problem when the microphone was
       * missing or already held by another app.
       */
      const name = cause instanceof Error ? cause.name : "";
      setError(
        name === "NotAllowedError" || name === "SecurityError" || name === ""
          ? "O acesso ao microfone foi negado."
          : `Não foi possível abrir o microfone (${name}).`,
      );
      return false;
    }
  };

  const start = async () => {
    clearMuteTimer();
    suppressUntilRef.current = 0;
    setHasStarted(true);
    setError(null);
    setNotice(null);
    /* Hanging up while muted must not leave the next session muted. */
    setMuted(false);

    if (!(await openMicrophone())) return;

    /*
     * A second failure point, and a separate message: by here the microphone is open, so a
     * `TypeError` is the socket or the audio graph, not permission. Left uncaught it was an
     * unhandled rejection — no message on screen at all.
     */
    try {
      await realtime.connect();
    } catch (cause) {
      const detail = cause instanceof Error ? `${cause.name}: ${cause.message}` : String(cause);
      setError(`Não foi possível iniciar a conversa (${detail}).`);
      stopRef.current();
    }
  };

  const stop = () => {
    clearMuteTimer();
    suppressUntilRef.current = 0;
    stopPlayback();
    realtime.stopAudioCapture();
    stopMediaStream(captureStreamRef.current);
    captureStreamRef.current = null;
    stopMediaStream(streamRef.current);
    streamRef.current = null;
    setMicStream(null);
    realtime.disconnect();
  };

  /**
   * Held in a ref so the guards below can depend on `status` alone. The hook
   * re-binds its methods every render, so putting `stop` in a dependency array
   * would tear the idle timer down before it ever fires.
   */
  const stopRef = useRef(stop);
  useEffect(() => {
    stopRef.current = stop;
  });

  /**
   * The two ways a session is left open with nobody in it: the tab goes to the
   * background (another app, a locked phone) or it stays connected in an empty
   * room. Both hang up rather than keep streaming the microphone.
   */
  useEffect(() => {
    if (status !== "connected") return;

    const onVisibilityChange = () => {
      if (!document.hidden) return;
      setNotice("Chamada encerrada quando a aba foi para segundo plano.");
      stopRef.current();
    };

    /* Closing the tab kills the socket; this banks the last seconds of the clock. */
    const onPageHide = () => stopSessionClock();

    document.addEventListener("visibilitychange", onVisibilityChange);
    window.addEventListener("pagehide", onPageHide);

    return () => {
      document.removeEventListener("visibilitychange", onVisibilityChange);
      window.removeEventListener("pagehide", onPageHide);
    };
  }, [status]);

  /* Two minutes with no sign of life ends the call. See `useIdleHangUp`. */
  useIdleHangUp(
    status === "connected",
    { messages, isPlaying, report: viewBuilder.report, viewEvent },
    () => {
      setNotice("Chamada encerrada após dois minutos de silêncio.");
      stopRef.current();
    },
  );

  const isLive = status === "connected" || status === "connecting";

  /**
   * The character's start/stop, published for the overlay.
   *
   * He is the page's start button, but the microphone permission and the socket live here —
   * so the overlay calls through the store rather than reaching into this component. The
   * wrappers are stable (they read refs), because `start` and `stop` are rebound on every
   * render and an effect that depended on them would re-register constantly.
   */
  const startRef = useRef(start);
  useEffect(() => {
    startRef.current = start;
  });

  useEffect(() => {
    useAstroStore.getState().setVoice({
      start: () => void startRef.current(),
      /* `stopRef` already exists for the idle hang-up, and is re-pointed every render for
         exactly this reason: `stop` closes over `realtime`, which the hook rebinds. */
      stop: () => stopRef.current(),
    });

    return () => useAstroStore.getState().setVoice(null);
  }, []);

  /* What a tap on him means. Published here because this is where `status` lives. */
  useEffect(() => {
    useAstroStore.getState().setLive(isLive);
  }, [isLive]);

  const interruptAssistant = (): boolean => {
    const active = isPlayingRef.current || isResponseActive(eventsRef.current);
    stopPlaybackRef.current();
    if (!active) return false;

    suppressIndexRef.current = eventsRef.current.length;
    suppressUntilRef.current = Date.now() + INTERRUPT_SUPPRESS_MS;
    if (statusRef.current === "connected") {
      try {
        cancelResponseRef.current();
      } catch {
        /* Session closing between click and dispatch is harmless here. */
      }
    }
    return true;
  };

  const toggleMute = () => {
    if (!muted) {
      const interrupted = interruptAssistant();
      setMuted(true);
      setAudioTracksEnabled(captureStreamRef.current, false);
      clearMuteTimer();

      if (interrupted) {
        realtime.stopAudioCapture();
        stopMediaStream(captureStreamRef.current);
        captureStreamRef.current = null;
        return;
      }

      muteStopTimerRef.current = window.setTimeout(() => {
        muteStopTimerRef.current = null;
        realtime.stopAudioCapture();
        stopMediaStream(captureStreamRef.current);
        captureStreamRef.current = null;
      }, MUTE_SILENCE_TAIL_MS);
      return;
    }

    interruptAssistant();
    clearMuteTimer();
    const existing = streamRef.current;
    if (existing && hasLiveAudioTrack(existing)) {
      setAudioTracksEnabled(captureStreamRef.current, !isPlayingRef.current);
      setMuted(false);
      return;
    }

    void (async () => {
      if (await openMicrophone()) {
        setMuted(false);
      }
    })();
  };

  /**
   * The transcript is a sheet, not a column: the app the coding agent builds is
   * the page, and the conversation is something you open. A transcript sharing
   * the app's scroll pushed the app off screen with every line.
   */
  const [transcriptOpen, setTranscriptOpen] = useState(false);
  const [projectsOpen, setProjectsOpen] = useState(false);
  const [seenTurns, setSeenTurns] = useState(0);
  const unread = transcriptOpen ? 0 : Math.max(0, messages.length - seenTurns);
  const transcriptEndRef = useRef<HTMLDivElement>(null);

  const closeTranscript = () => {
    setTranscriptOpen(false);
    setSeenTurns(messages.length);
  };

  useEffect(() => {
    if (transcriptOpen) transcriptEndRef.current?.scrollIntoView({ block: "end" });
  }, [transcriptOpen, messages]);

  /**
   * A draggable bottom sheet is a phone gesture; with a mouse it reads as a
   * mobile app squeezed into a window. Wide screens dock the transcript beside
   * the page instead — on the left, because the bottom-right is Astro's corner
   * and he would sit on top of the newest lines.
   */
  const docked = useMediaQuery(DOCKED_TRANSCRIPT_QUERY);
  const heroSlotRef = useRef<HTMLDivElement>(null);
  const isHero = !hasStarted && !isLive && viewBuilder.screen == null && !fullscreen;

  useEffect(() => {
    if (!isHero) return;
    const timer = window.setInterval(() => {
      setPromptIndex((current) => (current + 1) % HERO_PROMPTS.length);
    }, HERO_PROMPT_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [isHero]);

  useEffect(() => {
    if (!isHero) {
      useAstroStore.getState().setHeroSpot(null);
      return;
    }

    const slot = heroSlotRef.current;
    if (!slot) return;

    const updateHeroSpot = () => {
      const rect = slot.getBoundingClientRect();
      if (
        rect.width <= 0 ||
        rect.height <= 0 ||
        window.innerWidth <= 0 ||
        window.innerHeight <= 0
      ) {
        return;
      }
      const center = pixelsToViewport(
        { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 },
        window.innerWidth,
        window.innerHeight,
      );
      const prev = useAstroStore.getState().heroSpot;
      if (
        prev != null &&
        Math.abs(prev.x - center.x) < 0.001 &&
        Math.abs(prev.y - center.y) < 0.001
      ) {
        return;
      }
      useAstroStore.getState().setHeroSpot(center);
    };

    updateHeroSpot();
    const rafId = window.requestAnimationFrame(updateHeroSpot);
    const observer = new ResizeObserver(updateHeroSpot);
    observer.observe(slot);
    observer.observe(document.documentElement);
    window.addEventListener("resize", updateHeroSpot);

    return () => {
      window.cancelAnimationFrame(rafId);
      observer.disconnect();
      window.removeEventListener("resize", updateHeroSpot);
      useAstroStore.getState().setHeroSpot(null);
    };
  }, [isHero, docked, transcriptOpen, projectsOpen]);

  const toggleTranscript = () => {
    if (transcriptOpen) {
      closeTranscript();
    } else {
      setProjectsOpen(false);
      setTranscriptOpen(true);
    }
  };

  const toggleProjects = () => {
    if (projectsOpen) {
      setProjectsOpen(false);
    } else {
      closeTranscript();
      setProjectsOpen(true);
    }
  };

  const handleSelectProject = (project: LoadedProject) => {
    suppressProjectEventsUntilRef.current = Date.now() + PROJECT_SWITCH_SILENCE_MS;
    setActiveProjectId(project.id);
    restoreState(project.state);
    viewBuilder.loadView({ title: project.title, html: project.html });
  };

  const handleNewProject = () => {
    suppressProjectEventsUntilRef.current = Date.now() + PROJECT_SWITCH_SILENCE_MS;
    setActiveProjectId(null);
    restoreState(undefined);
    viewBuilder.loadView(null);
  };

  const handleActiveProjectDeleted = () => {
    setActiveProjectId(null);
  };

  const transcriptBody = (
    <>
      <UsageMeter />

      {/**
       * Dev-only, and the fastest way to tell the two bring-up failures apart:
       * `audio-delta` arriving with nothing audible is the playback path, no
       * `audio-delta` at all is the session config.
       */}
      {import.meta.env.DEV && events.length > 0 && (
        <pre className="voice-events">
          {events
            .slice(-12)
            .map((event) => event.type)
            .join(" · ")}
        </pre>
      )}

      {messages.length === 0 ? (
        <IonNote className="voice-empty">Nada dito ainda.</IonNote>
      ) : (
        <div className="voice-transcript">
          {messages.map((message) => (
            <div key={message.id} className={`voice-turn voice-turn--${message.role}`}>
              <span className="voice-turn__role">
                {message.role === "user"
                  ? "Você"
                  : message.role === "assistant"
                    ? "Astro"
                    : message.role}
              </span>
              {/**
               * Rendered part by part rather than joined into one string: a
               * turn that only calls a tool has no text at all, and collapsing
               * the parts would make a working call look like a dropped reply.
               * Part indexes are stable — the reducer updates parts in place.
               */}
              {message.parts.map((part, index) => {
                if (part.type === "text") return <p key={index}>{part.text}</p>;

                if (part.type === "dynamic-tool") {
                  return (
                    <p key={part.toolCallId} className="voice-turn__tool">
                      <LiquidGlassIcon name="terminal" size={15} />
                      {part.toolName || "…"}
                      {part.state === "input-streaming" ? "" : `(${JSON.stringify(part.input)})`}
                      {part.state === "output-available" && " ✓"}
                    </p>
                  );
                }

                return null;
              })}
            </div>
          ))}
        </div>
      )}
      <div ref={transcriptEndRef} />
    </>
  );

  const activity = !isLive
    ? null
    : muted
      ? "silenciado"
      : isPlaying
        ? "falando"
        : isCapturing
          ? "ouvindo"
          : status === "connecting"
            ? "conectando"
            : null;

  return (
    <>
      <IonContent scrollY={false}>
        <div className="voice-layout">
          {docked && transcriptOpen && !fullscreen && (
            <aside className="voice-panel" aria-label="Transcrição">
              <header className="voice-panel__header">
                <h2>Transcrição</h2>
                <button
                  type="button"
                  className="apple-liquid-glass-pill apple-liquid-glass-pill--dark apple-liquid-glass-pill--sm"
                  onClick={closeTranscript}
                >
                  Fechar
                </button>
              </header>
              <div className="voice-panel__body">{transcriptBody}</div>
            </aside>
          )}
          <ProjectsSheet
            isOpen={projectsOpen && !fullscreen}
            docked={docked}
            password={password}
            activeProjectId={activeProjectId}
            onClose={() => setProjectsOpen(false)}
            onSelectProject={handleSelectProject}
            onNewProject={handleNewProject}
            onActiveProjectDeleted={handleActiveProjectDeleted}
          />
          <div className={`voice-stage${fullscreen ? " voice-stage--fullscreen" : ""}`}>
            {fullscreen && onExitFullscreen != null && (
              <button
                type="button"
                className="apple-liquid-glass-pill apple-liquid-glass-pill--dark apple-liquid-glass-pill--sm voice-stage__exit-fullscreen"
                onClick={onExitFullscreen}
                title="Voltar para a tela original"
                aria-label="Voltar para a tela original"
              >
                <LiquidGlassIcon name="exit-fullscreen" size={16} />
                Voltar
              </button>
            )}
            {viewBuilder.screen == null ? (
              isHero ? (
                <div className="voice-stage__empty voice-stage__empty--hero">
                  <div
                    ref={heroSlotRef}
                    className="voice-stage__astro-hero-slot"
                    aria-hidden="true"
                  />
                  <p key={promptIndex} className="voice-stage__headline">
                    {HERO_PROMPTS[promptIndex]}
                  </p>
                  <span className="voice-stage__subline">Toque no astro para começar</span>
                </div>
              ) : (
                <div className="voice-stage__empty">
                  <p className="voice-stage__headline">
                    {isLive
                      ? "Estou ouvindo. Pode pedir o que quiser."
                      : "Toque em Iniciar ou no Astro."}
                  </p>
                  <IonNote>
                    Peça algo (um jogo, um temporizador, uma lista) e aparece aqui em tela cheia.{" "}
                    {VOICE_MODEL_ID} responde em voz alta.
                  </IonNote>
                </div>
              )
            ) : (
              /**
               * `VIEW_SANDBOX` / `VIEW_ALLOW` open nearly everything — see
               * `seal-view.ts` for what and why. The page shares this app's
               * origin, so it can use storage and load libraries; it just cannot
               * navigate the app away.
               *
               * `onLoad` hands the previous page's saved state to the new one —
               * this is what lets the coding agent edit a game mid-play without
               * resetting the score.
               *
               * `screen` changes every few hundred milliseconds while a page
               * streams in, so the user watches it being built.
               */
              <iframe
                ref={frameRef}
                className="voice-view"
                title={viewBuilder.screen.title}
                sandbox={VIEW_SANDBOX}
                allow={VIEW_ALLOW}
                srcDoc={sealViewHtml(viewBuilder.screen.html)}
                onLoad={onFrameLoad}
              />
            )}

            {/**
             * Floated over the top of the stage so a status never moves the app.
             * `status` is what the coding agent is doing right now, built from its
             * own lifecycle rather than a spinner — the page takes ten or twenty
             * seconds and the wait should say why.
             */}
            <div className="voice-banners">
              {viewBuilder.status != null && (
                <div className="voice-banner">
                  <IonSpinner name="dots" />
                  <span>{viewBuilder.status}</span>
                </div>
              )}
              {viewBuilder.failure != null && (
                <div className="voice-banner voice-banner--error" role="alert">
                  Não foi possível criar a página: {viewBuilder.failure}
                </div>
              )}
              {error != null && (
                <div className="voice-banner voice-banner--error" role="alert">
                  {error}
                </div>
              )}
              {notice != null && <div className="voice-banner">{notice}</div>}
            </div>

            {activity != null && (
              <IonNote className="voice-bar__activity">
                {status === "connecting" && <IonSpinner name="dots" />}
                {activity}
              </IonNote>
            )}
          </div>
        </div>
      </IonContent>

      {!fullscreen && (
        <IonFooter className="astro-footer">
          <IonToolbar className="astro-toolbar">
            {/**
             * Astro is the start button — tapping him starts the conversation — and the
             * Start / live controls stay centered in the middle of the bar while utility
             * buttons sit on the left, keeping the bottom-right corner clear for Astro 3D.
             */}
            <div className="voice-bar">
              <div className="voice-bar__left">
                <button
                  type="button"
                  className={`apple-liquid-glass-btn voice-bar__transcript${transcriptOpen ? " apple-liquid-glass-btn--active" : ""}`}
                  onClick={toggleTranscript}
                  title={transcriptOpen ? "Ocultar transcrição" : "Mostrar transcrição"}
                  aria-label={transcriptOpen ? "Ocultar transcrição" : "Mostrar transcrição"}
                >
                  <LiquidGlassIcon
                    name="chat"
                    tone={transcriptOpen ? "active" : "default"}
                    size={20}
                  />
                  {unread > 0 && <IonBadge className="voice-bar__badge">{unread}</IonBadge>}
                </button>

                <button
                  type="button"
                  className={`apple-liquid-glass-btn${projectsOpen ? " apple-liquid-glass-btn--active" : ""}`}
                  onClick={toggleProjects}
                  title={projectsOpen ? "Ocultar projetos" : "Projetos salvos"}
                  aria-label={projectsOpen ? "Ocultar projetos" : "Projetos salvos"}
                >
                  <LiquidGlassIcon
                    name="folder"
                    tone={projectsOpen ? "active" : "default"}
                    size={20}
                  />
                </button>
              </div>

              <div className="voice-bar__center">
                {isLive ? (
                  muted ? (
                    <button
                      type="button"
                      className="apple-liquid-glass-pill apple-liquid-glass-pill--primary"
                      onClick={toggleMute}
                      title="Falar"
                      aria-label="Falar"
                    >
                      <LiquidGlassIcon name="mic" tone="cream" size={18} />
                      Falar
                    </button>
                  ) : (
                    <>
                      <button
                        type="button"
                        className="apple-liquid-glass-square"
                        onClick={toggleMute}
                        title="Parar de falar"
                        aria-label="Parar de falar"
                      >
                        <LiquidGlassIcon name="stop-square" tone="cream" size={18} />
                      </button>
                      <AudioWaveform
                        stream={micStream}
                        active={isLive && !muted && isCapturing && !isPlaying}
                      />
                    </>
                  )
                ) : (
                  <button
                    type="button"
                    className="apple-liquid-glass-pill apple-liquid-glass-pill--primary"
                    onClick={() => void start()}
                  >
                    <LiquidGlassIcon name="mic" tone="cream" size={18} />
                    Iniciar
                  </button>
                )}
              </div>

              <div className="voice-bar__right" />
            </div>
          </IonToolbar>
        </IonFooter>
      )}

      {/* Phones keep the sheet: there, dragging it is the native gesture. */}
      <IonModal
        className="astro-modal"
        isOpen={transcriptOpen && !docked && !fullscreen}
        onDidDismiss={closeTranscript}
        breakpoints={[0, 0.6, 1]}
        initialBreakpoint={0.6}
      >
        <IonHeader className="astro-header">
          <IonToolbar className="astro-toolbar">
            <IonTitle>Transcrição</IonTitle>
            <IonButtons slot="end">
              <button
                type="button"
                className="apple-liquid-glass-pill apple-liquid-glass-pill--dark apple-liquid-glass-pill--sm"
                onClick={closeTranscript}
              >
                Fechar
              </button>
            </IonButtons>
          </IonToolbar>
        </IonHeader>
        <IonContent className="ion-padding astro-modal-content">{transcriptBody}</IonContent>
      </IonModal>
    </>
  );
}
