import { experimental_useRealtime, type Experimental_UseRealtimeOptions } from "@ai-sdk/react";
import {
  IonBadge,
  IonButton,
  IonButtons,
  IonContent,
  IonFooter,
  IonHeader,
  IonIcon,
  IonModal,
  IonNote,
  IonSpinner,
  IonTitle,
  IonToolbar,
} from "@ionic/react";
import { gateway } from "ai";
import {
  chatbubblesOutline,
  folderOpenOutline,
  micOffOutline,
  micOutline,
  stopCircleOutline,
  terminalOutline,
} from "ionicons/icons";
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
import { faceForSession } from "../lib/astro/interaction.ts";
import { sealViewHtml, VIEW_ALLOW, VIEW_SANDBOX } from "../lib/seal-view.ts";
import { useAstroStore } from "../lib/astro/store.ts";
import { useIdleHangUp } from "../lib/use-idle-hang-up.ts";
import { useMediaQuery } from "../lib/use-media-query.ts";
import { useProjectAutoSave } from "../lib/use-projects.ts";
import { useViewBuilder } from "../lib/use-view-builder.ts";
import { describeViewEvent, useViewEvents } from "../lib/use-view-events.ts";
import { addVoiceCost, startSessionClock, stopSessionClock } from "../lib/voice-usage.ts";
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

export default function VoiceSession({ password }: { password: string }) {
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  /**
   * Muted keeps the session open and stops the microphone.
   *
   * Deliberately not the same thing as hanging up: the socket bills by the second either
   * way, so muting is the cheap gesture and ending is the expensive one. Leaving the tracks
   * alive means unmuting does not re-prompt for permission.
   */
  const [muted, setMuted] = useState(false);
  const streamRef = useRef<MediaStream | null>(null);
  const [activeProjectId, setActiveProjectId] = useState<string | null>(null);

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

  const { status, messages, events, isCapturing, isPlaying, startAudioCapture } = realtime;

  /**
   * The app's side of the conversation: everything the model learns without a
   * person saying it. It goes in as a *user* item because that is the only role
   * the realtime protocol accepts from a client — hence the prefix, which the
   * instructions explain so the model does not read these aloud.
   */
  const reportToVoice = (report: string, { speak = true } = {}) => {
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
      isCapturing,
      isPlaying,
      hasError: error != null,
    });
    useAstroStore.getState().syncSession(face.expression, face.sustained);

    return () => {
      /* Unmounting (Clear, Forget password) must not leave a dead session's face up, and it
         must not leave him asleep either: `idle` is the state a visitor finds him in. */
      useAstroStore.getState().syncSession(ASTRO_DEFAULT_EXPRESSION, true);
    };
  }, [status, isCapturing, isPlaying, error]);

  /**
   * Events sent before the socket opens are dropped, so capture waits for
   * `connected` (which the SDK sets on the session-created event) rather than
   * starting right after `connect()` resolves.
   *
   * `muted` is a guard, not a note: without it this effect would restart capture the moment
   * mute stopped it, and the mute button would blink and do nothing.
   */
  useEffect(() => {
    if (status !== "connected" || isCapturing || muted) return;

    const stream = streamRef.current;
    if (stream) startAudioCapture(stream);
  }, [status, isCapturing, muted, startAudioCapture]);

  /**
   * The model must never hear itself. Wired earphones on a laptop combo jack
   * leak a faint copy of the playback into the headset mic, the browser's gain
   * control lifts it, and the server's VAD takes it as the user barging in: the
   * reply is cut a second in and its own words come back as the next user turn.
   * Browser echo cancellation does not reliably cover Web Audio playback, so
   * the track is muted while the model speaks — a disabled track sends silence.
   * The cost is barge-in by voice; "End conversation" still interrupts.
   */
  useEffect(() => {
    for (const track of streamRef.current?.getAudioTracks() ?? []) track.enabled = !isPlaying;
  }, [isPlaying]);

  /* Release the microphone if the page navigates away mid-conversation. */
  useEffect(() => {
    return () => {
      for (const track of streamRef.current?.getTracks() ?? []) track.stop();
    };
  }, []);

  const start = async () => {
    setError(null);
    setNotice(null);
    /* Hanging up while muted must not leave the next session muted. */
    setMuted(false);

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
          ? "The microphone needs https or localhost — this page was opened over plain http."
          : "This browser exposes no microphone API.",
      );
      return;
    }

    try {
      // Requested inside the click so the permission prompt lands in the
      // user's gesture, and so the AudioContext is allowed to make sound.
      streamRef.current = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (cause) {
      /**
       * The name matters: every failure here used to read as "denied", which
       * sent us hunting for a permission problem when the microphone was
       * missing or already held by another app.
       */
      const name = cause instanceof Error ? cause.name : "";
      setError(
        name === "NotAllowedError" || name === "SecurityError" || name === ""
          ? "Microphone access was denied."
          : `The microphone could not be opened (${name}).`,
      );
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
      setError(`The conversation could not be opened (${detail}).`);
      stopRef.current();
    }
  };

  const stop = () => {
    realtime.stopAudioCapture();
    for (const track of streamRef.current?.getTracks() ?? []) track.stop();
    streamRef.current = null;
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
      setNotice("Hung up when the tab went to the background.");
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
      setNotice("Hung up after two minutes of silence.");
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

  const toggleMute = () => {
    if (muted) {
      setMuted(false);
      return;
    }

    realtime.stopAudioCapture();
    setMuted(true);
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
    setActiveProjectId(project.id);
    restoreState(project.state);
    viewBuilder.loadView({ title: project.title, html: project.html });
    if (status === "connected") {
      reportRef.current(`The user opened the saved project "${project.title}".`, { speak: false });
    }
  };

  const handleNewProject = () => {
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
        <IonNote className="voice-empty">Nothing said yet.</IonNote>
      ) : (
        <div className="voice-transcript">
          {messages.map((message) => (
            <div key={message.id} className={`voice-turn voice-turn--${message.role}`}>
              <span className="voice-turn__role">{message.role}</span>
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
                      <IonIcon icon={terminalOutline} />
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
      ? "muted"
      : isPlaying
        ? "speaking"
        : isCapturing
          ? "listening"
          : status === "connecting"
            ? "connecting"
            : null;

  return (
    <>
      <IonContent scrollY={false}>
        <div className="voice-layout">
          {docked && transcriptOpen && (
            <aside className="voice-panel" aria-label="Transcript">
              <header className="voice-panel__header">
                <h2>Transcript</h2>
                <IonButton fill="clear" size="small" onClick={closeTranscript}>
                  Close
                </IonButton>
              </header>
              <div className="voice-panel__body">{transcriptBody}</div>
            </aside>
          )}
          <ProjectsSheet
            isOpen={projectsOpen}
            docked={docked}
            password={password}
            activeProjectId={activeProjectId}
            onClose={() => setProjectsOpen(false)}
            onSelectProject={handleSelectProject}
            onNewProject={handleNewProject}
            onActiveProjectDeleted={handleActiveProjectDeleted}
          />
          <div className="voice-stage">
            {viewBuilder.screen == null ? (
              <div className="voice-stage__empty">
                <p>Tap Astro and just talk.</p>
                <IonNote>
                  Ask for something (a game, a timer, a checklist) and it shows up here, full
                  screen. {VOICE_MODEL_ID} answers out loud.
                </IonNote>
              </div>
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
                  The page could not be built: {viewBuilder.failure}
                </div>
              )}
              {error != null && (
                <div className="voice-banner voice-banner--error" role="alert">
                  {error}
                </div>
              )}
              {notice != null && <div className="voice-banner">{notice}</div>}
            </div>
          </div>
        </div>
      </IonContent>

      <IonFooter>
        <IonToolbar>
          {/**
           * Astro is the start button — tapping him starts the conversation — so
           * this bar is the *other* things: stop and mute once it is running, and
           * a plain fallback when it is not. The fallback is not dead weight: a
           * WebView without WebGL gets `CanvasBoundary`'s notice instead of a
           * character, and then this is the only start control.
           *
           * Everything is packed to the left: the bottom-right is Astro's corner,
           * and his tap target there would swallow a button under it.
           */}
          <div className="voice-bar">
            {isLive ? (
              <>
                <IonButton
                  fill="outline"
                  color="tertiary"
                  onClick={toggleMute}
                  title={muted ? "Unmute" : "Mute microphone"}
                >
                  <IonIcon slot="icon-only" icon={muted ? micOffOutline : micOutline} />
                </IonButton>
                <IonButton color="danger" onClick={stop}>
                  <IonIcon slot="start" icon={stopCircleOutline} />
                  End
                </IonButton>
              </>
            ) : (
              <IonButton fill="outline" onClick={() => void start()}>
                <IonIcon slot="start" icon={micOutline} />
                Start
              </IonButton>
            )}

            <IonButton
              fill="clear"
              className="voice-bar__transcript"
              onClick={toggleTranscript}
              title={transcriptOpen ? "Hide the transcript" : "Show the transcript"}
            >
              <IonIcon slot="icon-only" icon={chatbubblesOutline} />
              {unread > 0 && <IonBadge className="voice-bar__badge">{unread}</IonBadge>}
            </IonButton>

            <IonButton
              fill="clear"
              onClick={toggleProjects}
              title={projectsOpen ? "Hide projects" : "Saved projects"}
              aria-label={projectsOpen ? "Hide projects" : "Saved projects"}
            >
              <IonIcon slot="icon-only" icon={folderOpenOutline} />
            </IonButton>

            {activity != null && (
              <IonNote className="voice-bar__activity">
                {status === "connecting" && <IonSpinner name="dots" />}
                {activity}
              </IonNote>
            )}
          </div>
        </IonToolbar>
      </IonFooter>

      {/* Phones keep the sheet: there, dragging it is the native gesture. */}
      <IonModal
        isOpen={transcriptOpen && !docked}
        onDidDismiss={closeTranscript}
        breakpoints={[0, 0.6, 1]}
        initialBreakpoint={0.6}
      >
        <IonHeader>
          <IonToolbar>
            <IonTitle>Transcript</IonTitle>
            <IonButtons slot="end">
              <IonButton onClick={closeTranscript}>Close</IonButton>
            </IonButtons>
          </IonToolbar>
        </IonHeader>
        <IonContent className="ion-padding">{transcriptBody}</IonContent>
      </IonModal>
    </>
  );
}
