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
import { experimental_decodeRealtimeAudio as decodeRealtimeAudio, gateway } from "ai";
import { type Ref, useEffect, useEffectEvent, useImperativeHandle, useRef, useState } from "react";

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
import { setAskerMode, useAskerMode } from "../lib/asker-mode.ts";
import { useAstroStore } from "../lib/astro/store.ts";
import { astroVoiceLevel, voiceClock } from "../lib/astro/voice-level.ts";
import { useIdleHangUp } from "../lib/use-idle-hang-up.ts";
import { useMediaQuery } from "../lib/use-media-query.ts";
import { usePushToTalk } from "../lib/use-push-to-talk.ts";
import { useProjectAutoSave } from "../lib/use-projects.ts";
import { useViewBuilder } from "../lib/use-view-builder.ts";
import { describeViewEvent, useViewEvents } from "../lib/use-view-events.ts";
import { addVoiceCost, startSessionClock, stopSessionClock } from "../lib/voice-usage.ts";
import LiquidGlassIcon from "./LiquidGlassIcon.tsx";
import PushToTalkButton from "./PushToTalkButton.tsx";
import ProjectsSheet, { type LoadedProject } from "./ProjectsSheet.tsx";

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
    "inconsistent or missing, or a change broke something else — call " +
    "rebuild_view instead: a stronger model rewrites " +
    "it cleanly from the features asked for so far, keeping the user's data. It " +
    "is slower, so tell the user it will take a moment.\n\n" +
    "render_view returns the moment the work starts, not when the page is " +
    "ready. Say something to fill the wait, then stop and let the user speak. " +
    "Messages that begin with '(app status)' are the app talking to you, not " +
    "the user: no one said them aloud. Use them to tell the user the page has " +
    "landed, what it shows, or that it failed — briefly, and never read one out " +
    "word for word.\n\n" +
    "You only change the page when the user asks you to, in their own words. An " +
    "(app status) message is never a request: not an error, not a problem found " +
    "by a check, not a missing feature. Never call render_view or rebuild_view " +
    "because of one. If something looks wrong, say so in a sentence and ask " +
    "whether they want it fixed, then wait for their answer.",
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
  // Gemini 3.8 Live requires server-side VAD (sending `disabled` or manual
  // commit/clear frames closes the WebSocket with code 1008). Push-to-talk
  // gates local microphone capture to the hold window instead.
  turnDetection: { type: "server-vad" },
} satisfies NonNullable<Experimental_UseRealtimeOptions["sessionConfig"]>;

/**
 * Asker mode's system prompt: Astro interviews the user before he builds.
 *
 * It is its own prompt, written as a section on top of the normal one rather than a copy of
 * it: the tool, (app status) and "only when asked" rules are the same in both modes, and a copy
 * would drift. Where the two disagree — the normal prompt says to reach for the screen right
 * away — this section says it wins.
 */
const ASKER_INSTRUCTIONS =
  "ASKER MODE. The user turned this mode on because they want to be asked before anything " +
  "is built. These rules override the guidance above wherever the two disagree.\n\n" +
  "Before you call render_view for a new page or app, interview the user first. Find out " +
  "what matters for it: what it is for, the main features, how it should look (colors, " +
  "style, layout), and any content or data it should show. Ask one short question at a " +
  "time and wait for the answer — usually three to five questions in all. Skip anything the " +
  "user already told you, and offer a couple of examples when a question is open-ended.\n\n" +
  "When you have enough, sum up the plan in one or two sentences and ask whether you can " +
  "start. Call render_view only after the user says yes, and put every answer they gave " +
  "into the request — the coding agent knows only what you write.\n\n" +
  "For a change to a page already on screen, ask one clarifying question if the request is " +
  "ambiguous; a clear, small change only needs a quick confirmation. Always confirm before " +
  "rebuild_view.\n\n" +
  "If the user says to skip the questions or just start, start right away.";

/**
 * The session config for asker mode. A module constant for the same reason as
 * `sessionConfig`: the hook compares it by identity, so it must be the same object on every
 * render. Switching modes swaps one constant for the other, which the hook treats as a new
 * session — `changeMode` hangs up first so the old one ends cleanly.
 */
const askerSessionConfig = {
  ...sessionConfig,
  instructions: `${sessionConfig.instructions}\n\n${ASKER_INSTRUCTIONS}`,
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

/** Brief capture tail on release so final syllable audio frames finish flushing. */
const PTT_RELEASE_TAIL_MS = 180;

/**
 * The most silence fed while waiting for the server to close the turn. Server-vad only decides
 * the user stopped by *hearing* silence, so cutting the audio stream off early leaves the turn
 * open and the speech unanswered until the next press restarts the stream. Capture therefore
 * stays open, muted, until the server shows it took the turn (see `TURN_CLOSED_EVENTS`); this
 * is only the ceiling for when it never does.
 */
const PTT_TURN_CLOSE_MAX_MS = 6_000;

/** Server events that prove the turn the user just spoke was closed and taken. */
const TURN_CLOSED_EVENTS: ReadonlySet<string> = new Set([
  "audio-committed",
  "input-transcription-completed",
  "response-created",
  "audio-delta",
  "response-done",
]);

/** The close button every floating banner carries. */
function BannerClose({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      className="voice-banner__close"
      aria-label="Fechar aviso"
      onClick={onClick}
    >
      ✕
    </button>
  );
}

/** Minimum connected hold time (ms) before a release commits audio as a turn. */
const PTT_MIN_HOLD_MS = 120;

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

export type VoiceSessionHandle = {
  closeTranscript(): void;
  /** Turn asker mode on or off. A live conversation is ended, since it was set up for the other mode. */
  changeMode(asker: boolean): void;
};

export default function VoiceSession({
  password,
  fullscreen = false,
  projectsOpen = false,
  onOpenTranscript,
  onCloseProjects,
  onExitFullscreen,
  sessionRef,
}: {
  password: string;
  fullscreen?: boolean;
  projectsOpen?: boolean;
  onOpenTranscript?: () => void;
  onCloseProjects?: () => void;
  onExitFullscreen?: () => void;
  sessionRef?: Ref<VoiceSessionHandle>;
}) {
  const askerMode = useAskerMode();
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  /** The build failure the user closed; a new build clears it so the next failure shows. */
  const [dismissedFailure, setDismissedFailure] = useState<string | null>(null);
  /**
   * True while the model's current response was started by the app, not by the user: set when
   * the app asks for a spoken report, cleared when the user next presses to talk. A tool call
   * made in that window is refused (see `onToolCall`) — the model only edits the page when the
   * user asked, whatever an (app status) message said.
   */
  const [appTurn, setAppTurn] = useState(false);
  const [promptIndex, setPromptIndex] = useState(0);
  /**
   * Push-to-talk keeps the microphone silent by default while connected and only streams
   * audio while the user actively holds the talk button. Keeping the master tracks alive
   * in `streamRef` (and handing a clone to `realtime`) lets every press resume cleanly
   * without re-prompting for permission.
   */
  const [talking, setTalking] = useState(false);
  const streamRef = useRef<MediaStream | null>(null);
  const captureStreamRef = useRef<MediaStream | null>(null);
  const releaseTimerRef = useRef<number | null>(null);
  /**
   * Set from release until the server closes the turn: the index into `events` where this
   * release began, so only events after it count. `null` when no turn is waiting to close.
   */
  const awaitingTurnCloseRef = useRef<number | null>(null);
  const holdStartRef = useRef<number | null>(null);
  /**
   * Resets the push-to-talk gesture (idle/pressing/locked). It lives in `usePushToTalk`, declared
   * further down because it needs `beginTalk`/`endTalk`; the session-ending paths above reach it
   * through this ref.
   */
  const resetGestureRef = useRef<() => void>(() => {});
  const suppressIndexRef = useRef(0);
  const suppressUntilRef = useRef(0);
  const suppressProjectEventsUntilRef = useRef(0);
  const mountedRef = useRef(true);
  const [micStream, setMicStream] = useState<MediaStream | null>(null);
  const [activeProjectId, setActiveProjectId] = useState<string | null>(null);

  const clearReleaseTimer = () => {
    awaitingTurnCloseRef.current = null;
    if (releaseTimerRef.current != null) {
      window.clearTimeout(releaseTimerRef.current);
      releaseTimerRef.current = null;
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
    sessionConfig: askerMode ? askerSessionConfig : sessionConfig,
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
      if (appTurn) {
        return {
          ok: false,
          error:
            "Refused: the user has not asked for a change. An (app status) message is not a " +
            "request. Tell the user what you noticed in a sentence, ask whether they want it " +
            "fixed, and wait for their answer.",
        };
      }

      const errors = pageErrors.map((error) => error.message);

      if (toolCall.toolName === REBUILD_VIEW_TOOL_NAME) {
        const args = parseRebuildViewArgs(toolCall.args);
        if (args == null) {
          return { ok: false, error: "rebuild_view needs a non-empty `reason` string." };
        }
        if (!viewBuilder.hasView) {
          return { ok: false, error: "There is no page on screen to rebuild. Use render_view." };
        }

        setDismissedFailure(null);
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

      setDismissedFailure(null);
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
    onError: (sessionError) =>
      setError((previous) =>
        previous != null &&
        sessionError.message.startsWith("Realtime WebSocket closed unexpectedly") &&
        !previous.startsWith("Realtime WebSocket closed unexpectedly")
          ? `${previous} (${sessionError.message})`
          : sessionError.message,
      ),
  });

  const { status, messages, events, isCapturing, isPlaying, startAudioCapture, stopPlayback } =
    realtime;

  const eventsRef = useRef(events);
  const statusRef = useRef(status);
  const cancelResponseRef = useRef(realtime.cancelResponse);
  const requestResponseRef = useRef(realtime.requestResponse);
  const stopPlaybackRef = useRef(stopPlayback);
  useEffect(() => {
    eventsRef.current = events;
    statusRef.current = status;
    cancelResponseRef.current = realtime.cancelResponse;
    requestResponseRef.current = realtime.requestResponse;
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
  const requestAppResponse = () => {
    setAppTurn(true);
    requestResponseRef.current();
  };
  /** Held in a ref so the idle flush below can call it from an effect. */
  const requestAppResponseRef = useRef(requestAppResponse);
  useEffect(() => {
    requestAppResponseRef.current = requestAppResponse;
  });

  const reportToVoice = (report: string, { speak = true } = {}) => {
    if (status !== "connected") return;
    realtime.sendEvent({
      type: "conversation-item-create",
      item: { type: "text-message", role: "user", text: `(app status) ${report}` },
    });
    if (!speak) return;
    /*
     * Asking for a response while Astro is mid-sentence starts a new one, and the
     * provider cuts the current reply off. The report is already in the conversation,
     * so it waits here and is spoken once he has finished.
     */
    if (isPlaying || isResponseActive(events)) {
      speakWhenIdleRef.current = true;
      return;
    }
    requestAppResponse();
  };

  /** A spoken report that arrived while Astro was talking. See `reportToVoice`. */
  const speakWhenIdleRef = useRef(false);
  useEffect(() => {
    if (!speakWhenIdleRef.current) return;
    if (status !== "connected" || talking || isPlaying || isResponseActive(events)) return;
    speakWhenIdleRef.current = false;
    requestAppResponseRef.current();
  }, [events, isPlaying, talking, status]);

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
      isCapturing: isCapturing && talking,
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
  }, [status, isCapturing, talking, isPlaying, error]);

  const isPlayingRef = useRef(isPlaying);
  const talkingRef = useRef(talking);
  useEffect(() => {
    isPlayingRef.current = isPlaying;
    talkingRef.current = talking;
  });

  /**
   * Events sent before the socket opens are dropped, so capture waits for `connected`
   * (which the SDK sets on session-created) and only runs while Push-to-Talk is held.
   *
   * `realtime.stopAudioCapture()` stops every track on the stream it receives when
   * `api.token` is set, so we pass a clone while `streamRef` holds the live master
   * stream for `AudioWaveform` and subsequent Push-to-Talk holds.
   */
  useEffect(() => {
    if (status !== "connected" || isCapturing || !talking) return;

    const master = streamRef.current;
    if (!master || !hasLiveAudioTrack(master)) return;

    stopMediaStream(captureStreamRef.current);
    const captureStream = cloneAudioStream(master);
    setAudioTracksEnabled(captureStream, !isPlayingRef.current);
    captureStreamRef.current = captureStream;
    startAudioCapture(captureStream);
  }, [status, isCapturing, talking, micStream, startAudioCapture]);

  /* If Push-to-Talk was held before the socket or mic finished opening, clock hold duration from capture readiness. */
  useEffect(() => {
    if (status !== "connected" || !talking || micStream == null) return;
    if (holdStartRef.current == null) {
      holdStartRef.current = Date.now();
    }
  }, [status, talking, micStream]);

  /**
   * The model must never hear itself. When Astro is silent and Push-to-Talk is
   * held, re-enable the capture track; when released, `endTalk` manages the
   * brief syllable tail and silent VAD flush before tearing capture down.
   */
  useEffect(() => {
    if (isPlaying) {
      setAudioTracksEnabled(captureStreamRef.current, false);
    } else if (talking) {
      setAudioTracksEnabled(captureStreamRef.current, true);
    }
  }, [isPlaying, talking]);

  /* Clean up any cloned capture tracks when leaving the connected state. */
  useEffect(() => {
    if (status !== "connected") return;
    return () => {
      clearReleaseTimer();
      resetGestureRef.current();
      holdStartRef.current = null;
      stopMediaStream(captureStreamRef.current);
      captureStreamRef.current = null;
    };
  }, [status]);

  /* Release the microphone if the page navigates away mid-conversation. */
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      clearReleaseTimer();
      holdStartRef.current = null;
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
    clearReleaseTimer();
    holdStartRef.current = null;
    suppressUntilRef.current = 0;
    setError(null);
    setNotice(null);
    talkingRef.current = false;
    setTalking(false);
    resetGestureRef.current();

    if (!(await openMicrophone())) {
      talkingRef.current = false;
      setTalking(false);
      return;
    }

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
    clearReleaseTimer();
    holdStartRef.current = null;
    talkingRef.current = false;
    setTalking(false);
    resetGestureRef.current();
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
  const isAssistantSpeaking = isLive && isPlaying;

  /**
   * Cuts off Astro's spoken reply right away without activating or altering the user's
   * push-to-talk state. Called by the Interrupt button, by tapping Astro 3D, or automatically
   * when pressing Push-to-Talk while Astro is speaking.
   */
  const interruptAssistant = (): boolean => {
    const active = isPlayingRef.current || isResponseActive(eventsRef.current);
    stopPlaybackRef.current();
    if (talkingRef.current) {
      setAudioTracksEnabled(captureStreamRef.current, true);
    }
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

  /**
   * The character's start/stop/interrupt handle, published for the overlay.
   *
   * He is the page's start and tap-to-interrupt button, while the microphone permission and
   * the socket live here — so the overlay calls through the store rather than reaching into
   * this component. The wrappers are stable (they read refs), because `start`, `stop`, and
   * `interruptAssistant` close over values rebound on every render.
   */
  const startRef = useRef(start);
  const interruptRef = useRef(interruptAssistant);
  useEffect(() => {
    startRef.current = start;
    interruptRef.current = interruptAssistant;
  });

  useEffect(() => {
    useAstroStore.getState().setVoice({
      start: () => void startRef.current(),
      /* `stopRef` already exists for the idle hang-up, and is re-pointed every render for
         exactly this reason: `stop` closes over `realtime`, which the hook rebinds. */
      stop: () => stopRef.current(),
      interrupt: () => void interruptRef.current(),
    });

    return () => useAstroStore.getState().setVoice(null);
  }, []);

  /* What a tap on him means. Published here because this is where `status` and `isPlaying` live. */
  useEffect(() => {
    useAstroStore.getState().setLive(isLive);
  }, [isLive]);

  useEffect(() => {
    useAstroStore.getState().setSpeaking(isAssistantSpeaking);
    return () => useAstroStore.getState().setSpeaking(false);
  }, [isAssistantSpeaking]);

  /**
   * Astro's voice level, for the halo. Each new `audio-delta` is scheduled on the meter
   * the way the SDK schedules its playback (see `voice-level.ts`). Walked from the end
   * until an event already seen, so a long session does not rescan its whole history.
   */
  const meteredRef = useRef(new WeakSet<object>());
  useEffect(() => {
    const fresh: string[] = [];
    for (let i = events.length - 1; i >= 0; i--) {
      const event = events[i];
      if (event === undefined || meteredRef.current.has(event)) break;
      meteredRef.current.add(event);
      if (event.type === "audio-delta") fresh.push(event.delta);
    }
    /* Leftovers of an interrupted reply are stopped as they arrive, so they are not metered. */
    if (suppressUntilRef.current > Date.now()) return;
    const now = voiceClock();
    for (let i = fresh.length - 1; i >= 0; i--) {
      astroVoiceLevel.push(decodeRealtimeAudio(fresh[i]!), AUDIO_SAMPLE_RATE, now);
    }
  }, [events]);

  /* Playback stopped — finished, interrupted or hung up — so nothing queued will be heard. */
  useEffect(() => {
    if (!isAssistantSpeaking) astroVoiceLevel.clear();
  }, [isAssistantSpeaking]);

  const stopCaptureAndStreams = () => {
    realtime.stopAudioCapture();
    stopMediaStream(captureStreamRef.current);
    captureStreamRef.current = null;
  };

  const beginTalk = () => {
    clearReleaseTimer();
    if (talkingRef.current) return;

    /* The user is speaking: whatever the model does next is theirs to ask for. */
    setAppTurn(false);

    talkingRef.current = true;
    setTalking(true);

    if (isPlayingRef.current || isResponseActive(eventsRef.current)) {
      interruptAssistant();
    }

    if (statusRef.current === "connected") {
      holdStartRef.current = Date.now();
    }

    const existing = streamRef.current;
    if (existing && hasLiveAudioTrack(existing)) {
      setAudioTracksEnabled(captureStreamRef.current, !isPlayingRef.current);
      return;
    }

    void (async () => {
      if (!(await openMicrophone())) {
        talkingRef.current = false;
        setTalking(false);
        holdStartRef.current = null;
        resetGestureRef.current();
      }
    })();
  };

  const endTalk = (commit: boolean) => {
    if (!talkingRef.current) return;

    talkingRef.current = false;
    setTalking(false);
    const holdStart = holdStartRef.current;
    holdStartRef.current = null;
    clearReleaseTimer();

    if (statusRef.current !== "connected" || holdStart == null) {
      stopCaptureAndStreams();
      return;
    }

    const heldMs = Date.now() - holdStart;
    if (!commit || heldMs < PTT_MIN_HOLD_MS) {
      stopCaptureAndStreams();
      return;
    }

    /*
     * Tail, then silence — and the silence keeps flowing until the server acknowledges the turn.
     * Stopping after a fixed window left the turn open whenever the VAD wanted more silence than
     * that: nothing happened until the next press restarted the audio stream and let it finish.
     */
    awaitingTurnCloseRef.current = eventsRef.current.length;
    releaseTimerRef.current = window.setTimeout(() => {
      setAudioTracksEnabled(captureStreamRef.current, false);
      releaseTimerRef.current = window.setTimeout(() => {
        clearReleaseTimer();
        stopCaptureAndStreams();
      }, PTT_TURN_CLOSE_MAX_MS);
    }, PTT_RELEASE_TAIL_MS);
  };

  /* The server took the turn: the silence has done its job, so stop capturing. */
  const finishRelease = useEffectEvent(() => {
    clearReleaseTimer();
    stopCaptureAndStreams();
  });
  useEffect(() => {
    const from = awaitingTurnCloseRef.current;
    if (from == null) return;
    for (let i = from; i < events.length; i++) {
      const type = events[i]?.type;
      if (type !== undefined && TURN_CLOSED_EVENTS.has(type)) {
        finishRelease();
        return;
      }
    }
  }, [events]);

  /**
   * The push-to-talk gesture. It decides when a press becomes a recording (`onStart`), when the
   * recording ends and whether it is sent (`onEnd`), and what the button looks like; everything
   * about audio stays in `beginTalk` / `endTalk` above.
   */
  const ptt = usePushToTalk({
    onStart: () => beginTalk(),
    onEnd: (send) => endTalk(send),
  });
  useEffect(() => {
    resetGestureRef.current = ptt.reset;
  });

  /**
   * The transcript is a sheet, not a column: the app the coding agent builds is
   * the page, and the conversation is something you open. A transcript sharing
   * the app's scroll pushed the app off screen with every line.
   */
  const [transcriptOpen, setTranscriptOpen] = useState(false);
  const [seenTurns, setSeenTurns] = useState(0);
  const unread = transcriptOpen ? 0 : Math.max(0, messages.length - seenTurns);
  const transcriptEndRef = useRef<HTMLDivElement>(null);

  const closeTranscript = () => {
    setTranscriptOpen(false);
    setSeenTurns(messages.length);
  };

  const changeMode = (asker: boolean) => {
    if (asker === askerMode) return;
    const live = statusRef.current !== "disconnected";
    if (live) stopRef.current();
    setNotice(
      asker
        ? live
          ? "Modo perguntador ativado. A conversa foi reiniciada — toque no Astro para continuar."
          : "Modo perguntador ativado: o Astro vai fazer perguntas antes de criar."
        : live
          ? "Modo perguntador desativado. A conversa foi reiniciada — toque no Astro para continuar."
          : "Modo perguntador desativado.",
    );
    setAskerMode(asker);
  };

  useImperativeHandle(sessionRef, () => ({ closeTranscript, changeMode }));

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
  /* Stay large and centered for fresh / blank projects until the coding agent starts building. */
  const isHero = viewBuilder.screen == null && viewBuilder.status == null && !fullscreen;

  useEffect(() => {
    if (!isHero || isLive) return;
    const timer = window.setInterval(() => {
      setPromptIndex((current) => (current + 1) % HERO_PROMPTS.length);
    }, HERO_PROMPT_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [isHero, isLive]);

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
    };
  }, [isHero, isLive, talking, docked, transcriptOpen, projectsOpen]);

  useEffect(() => () => useAstroStore.getState().setHeroSpot(null), []);

  const toggleTranscript = () => {
    if (transcriptOpen) {
      closeTranscript();
    } else {
      onOpenTranscript?.();
      setTranscriptOpen(true);
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
    useAstroStore.getState().setAnchor(null);
  };

  const handleActiveProjectDeleted = () => {
    setActiveProjectId(null);
  };

  const transcriptBody = (
    <>
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
    : talking
      ? "ouvindo"
      : isPlaying
        ? "falando"
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
            onClose={() => onCloseProjects?.()}
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
                <LiquidGlassIcon name="exit-fullscreen" size={18} />
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
                  <p key={isLive ? "live" : promptIndex} className="voice-stage__headline">
                    {isLive
                      ? talking
                        ? "Estou ouvindo…"
                        : isPlaying
                          ? "Astro está falando"
                          : "Pronto para criar"
                      : HERO_PROMPTS[promptIndex]}
                  </p>
                  <span className="voice-stage__subline">
                    {isLive
                      ? status === "connecting"
                        ? "Conectando ao Astro…"
                        : talking
                          ? "Solte o botão quando terminar de falar"
                          : isPlaying
                            ? "Toque no Astro para interromper ou segure para falar"
                            : "Segure o botão abaixo para falar"
                      : "Toque no astro para começar"}
                  </span>
                </div>
              ) : (
                <div className="voice-stage__empty">
                  <p className="voice-stage__headline">
                    {viewBuilder.status != null
                      ? "Desenvolvendo seu projeto…"
                      : talking
                        ? "Estou ouvindo…"
                        : isLive
                          ? "Segure para falar."
                          : "Toque no Astro para começar."}
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
              {viewBuilder.failure != null && viewBuilder.failure !== dismissedFailure && (
                <div className="voice-banner voice-banner--error" role="alert">
                  <span>Não foi possível criar a página: {viewBuilder.failure}</span>
                  <BannerClose onClick={() => setDismissedFailure(viewBuilder.failure)} />
                </div>
              )}
              {error != null && (
                <div className="voice-banner voice-banner--error" role="alert">
                  <span>{error}</span>
                  <BannerClose onClick={() => setError(null)} />
                </div>
              )}
              {notice != null && (
                <div className="voice-banner">
                  <span>{notice}</span>
                  <BannerClose onClick={() => setNotice(null)} />
                </div>
              )}
            </div>

            {/* Not while a press is down: the lock badge, the button and the headline already
                say Astro is listening, and the badge rises through this spot. */}
            {activity != null && ptt.state.phase === "idle" && (
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
             * Start / live controls stay centered in the middle of the bar, the transcript
             * button sits on the left and the asker-mode toggle mirrors it on the right.
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
                    size={26}
                  />
                  {unread > 0 && <IonBadge className="voice-bar__badge">{unread}</IonBadge>}
                </button>
              </div>

              <div className="voice-bar__center">
                {/* Hidden until the socket is open: Astro is the only way to start a conversation. */}
                {status === "connected" && (
                  <PushToTalkButton
                    state={ptt.state}
                    tooShort={ptt.tooShort}
                    buttonProps={ptt.buttonProps}
                    micStream={micStream}
                    waveformActive={isLive && talking && isCapturing && !isPlaying}
                  />
                )}
                {isAssistantSpeaking && !talking && (
                  <button
                    type="button"
                    className="apple-liquid-glass-pill apple-liquid-glass-pill--dark voice-bar__interrupt"
                    onClick={() => void interruptAssistant()}
                    title="Interromper Astro"
                    aria-label="Interromper Astro"
                  >
                    <LiquidGlassIcon name="stop" tone="ember" size={22} />
                    <span className="voice-bar__interrupt-label">Interromper</span>
                  </button>
                )}
              </div>

              <div className="voice-bar__right">
                {/* Asker mode, mirroring the transcript button in the opposite corner. */}
                <button
                  type="button"
                  className={`apple-liquid-glass-btn${askerMode ? " apple-liquid-glass-btn--active" : ""}`}
                  onClick={() => changeMode(!askerMode)}
                  aria-pressed={askerMode}
                  title={askerMode ? "Desativar modo perguntador" : "Ativar modo perguntador"}
                  aria-label="Modo perguntador"
                >
                  <LiquidGlassIcon
                    name="astro-ask"
                    tone={askerMode ? "active" : "default"}
                    size={26}
                  />
                </button>
              </div>
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
