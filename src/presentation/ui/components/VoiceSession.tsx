import { experimental_useRealtime, type Experimental_UseRealtimeOptions } from "@ai-sdk/react";
import { IonButton, IonChip, IonIcon, IonNote, IonSpinner, IonText } from "@ionic/react";
import { gateway } from "ai";
import { micOffOutline, micOutline, terminalOutline, volumeHighOutline } from "ionicons/icons";
import { useEffect, useRef, useState } from "react";

import {
  AUDIO_FORMAT_TYPE,
  AUDIO_SAMPLE_RATE,
  parseRenderViewArgs,
  RENDER_VIEW_TOOL_NAME,
  VOICE_MODEL_ID,
  VOICE_NAME,
} from "@shared/realtime.ts";
import { realtimeSetupUrl } from "@infra/api/httpClient.ts";
import { useViewBuilder } from "@presentation/ui/hooks/useViewBuilder.ts";
import { describeViewEvent, useViewEvents } from "@presentation/ui/hooks/useViewEvents.ts";
import { startSessionClock, stopSessionClock } from "@presentation/state/useVoiceUsageStore.ts";

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
/**
 * Billing runs on wall-clock time, so an unattended open session is a leak.
 * Two guards close it: leaving the tab, and going quiet for this long.
 */
const IDLE_TIMEOUT_MS = 2 * 60_000;
const IDLE_CHECK_MS = 5_000;

/** How often the voice may *speak about* page events. See the effect below. */
const EVENT_SPEECH_THROTTLE_MS = 5_000;

export default function VoiceSession({ password }: { password: string }) {
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const lastActivityRef = useRef(0);

  const viewBuilder = useViewBuilder({ password });

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
     * It answers immediately and lets the build run on: a voice session bills
     * by wall-clock second, and holding the model for the twenty seconds the
     * coding agent needs would buy nothing but silence. `useViewBuilder`
     * reports back through `reportToVoice` when there is actually news.
     */
    onToolCall: ({ toolCall }) => {
      if (toolCall.toolName !== RENDER_VIEW_TOOL_NAME) {
        return { ok: false, error: `Astro has no tool called ${toolCall.toolName}.` };
      }

      const args = parseRenderViewArgs(toolCall.args);
      if (args == null) {
        return { ok: false, error: "render_view needs a non-empty `request` string." };
      }

      viewBuilder.build(args.request);
      return {
        ok: true,
        status: "building",
        note: "The coding agent is working. Say something to the user, then wait — you will get an (app status) message when the page lands.",
      };
    },
    onEvent: (event) => {
      if (
        event.type === "speech-started" ||
        event.type === "audio-delta" ||
        event.type === "input-transcription-completed"
      ) {
        lastActivityRef.current = Date.now();
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
   *
   * Also counts as activity. A build the user is watching in silence should
   * not trip the idle hang-up.
   */
  const reportToVoice = (report: string, { speak = true } = {}) => {
    lastActivityRef.current = Date.now();

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
   * Clicks inside a published view reach the model the same way a finished
   * build does: as state here, spoken from an effect.
   *
   * Every event goes into the conversation, but a *spoken* reaction is
   * throttled: a game posts an event per click, and a voice that starts
   * talking on each one would make the page unplayable. Between utterances
   * the model still accumulates the events silently, so its next turn knows
   * everything that happened.
   */
  const { frameRef, event: viewEvent, onFrameLoad } = useViewEvents();
  const lastSpokenEventRef = useRef(0);

  useEffect(() => {
    if (viewEvent == null) return;

    const speak = Date.now() - lastSpokenEventRef.current > EVENT_SPEECH_THROTTLE_MS;
    if (speak) lastSpokenEventRef.current = Date.now();
    reportRef.current(describeViewEvent(viewEvent), { speak });
  }, [viewEvent]);

  /**
   * The Gateway bills by the second the session is open, so the meter runs off
   * the connection itself. Stopping on unmount matters: the Clear button
   * remounts this component, and a clock left running would keep charging for a
   * socket that no longer exists.
   */
  useEffect(() => {
    if (status !== "connected") return;

    startSessionClock();
    return () => stopSessionClock();
  }, [status]);

  /**
   * Events sent before the socket opens are dropped, so capture waits for
   * `connected` (which the SDK sets on the session-created event) rather than
   * starting right after `connect()` resolves.
   */
  useEffect(() => {
    if (status !== "connected" || isCapturing) return;

    const stream = streamRef.current;
    if (stream) startAudioCapture(stream);
  }, [status, isCapturing, startAudioCapture]);

  /* Release the microphone if the page navigates away mid-conversation. */
  useEffect(() => {
    return () => {
      for (const track of streamRef.current?.getTracks() ?? []) track.stop();
    };
  }, []);

  const start = async () => {
    setError(null);
    setNotice(null);
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

    await realtime.connect();
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
   * The two ways an open session quietly costs money: the tab goes to the
   * background (another app, a locked phone) or it is left connected in an
   * empty room. Both hang up rather than keep the meter running.
   */
  useEffect(() => {
    if (status !== "connected") return;

    lastActivityRef.current = Date.now();

    const hangUp = (why: string) => {
      setNotice(why);
      stopRef.current();
    };

    const onVisibilityChange = () => {
      if (document.hidden)
        hangUp("Hung up when the tab went to the background — it bills by the second.");
    };

    /* Closing the tab kills the socket; this banks the last seconds locally. */
    const onPageHide = () => stopSessionClock();

    const idleTimer = setInterval(() => {
      if (Date.now() - lastActivityRef.current > IDLE_TIMEOUT_MS) {
        hangUp("Hung up after two minutes of silence.");
      }
    }, IDLE_CHECK_MS);

    document.addEventListener("visibilitychange", onVisibilityChange);
    window.addEventListener("pagehide", onPageHide);

    return () => {
      clearInterval(idleTimer);
      document.removeEventListener("visibilitychange", onVisibilityChange);
      window.removeEventListener("pagehide", onPageHide);
    };
  }, [status]);

  const isLive = status === "connected" || status === "connecting";

  return (
    <>
      <div className="voice-controls">
        {isLive ? (
          <IonButton color="danger" expand="block" onClick={stop}>
            <IonIcon slot="start" icon={micOffOutline} />
            End conversation
          </IonButton>
        ) : (
          <IonButton expand="block" onClick={() => void start()}>
            <IonIcon slot="start" icon={micOutline} />
            Start talking
          </IonButton>
        )}

        <div className="voice-status">
          <IonChip color={status === "connected" ? "success" : "medium"}>
            {status === "connecting" && <IonSpinner name="dots" />}
            {status}
          </IonChip>
          {isCapturing && (
            <IonChip color="primary">
              <IonIcon icon={micOutline} />
              listening
            </IonChip>
          )}
          {isPlaying && (
            <IonChip color="secondary">
              <IonIcon icon={volumeHighOutline} />
              speaking
            </IonChip>
          )}
        </div>

        {error != null && (
          <IonText color="danger">
            <p>{error}</p>
          </IonText>
        )}

        {notice != null && <IonNote>{notice}</IonNote>}
      </div>

      {/**
       * The coding agent's output. `status` is what the run is doing right now,
       * built from the agent's own lifecycle rather than a spinner — the page
       * takes ten or twenty seconds and the wait should say why.
       */}
      {viewBuilder.status != null && (
        <div className="voice-building">
          <IonSpinner name="dots" />
          <IonNote>{viewBuilder.status}</IonNote>
        </div>
      )}

      {viewBuilder.view != null && (
        <div className="voice-view-panel">
          {/**
           * `sandbox="allow-scripts"` **without** `allow-same-origin` is the
           * whole security model: the document lands on an opaque origin, so
           * it cannot reach this page's DOM, cookies, or storage. The two are
           * only safe apart — adding `allow-same-origin` back would hand a
           * model-written page the run of the app.
           */}
          {/**
           * `onLoad` hands the previous page's saved state to the new one —
           * this is what lets the coding agent edit a game mid-play without
           * resetting the score.
           */}
          <iframe
            ref={frameRef}
            className="voice-view"
            title={viewBuilder.view.title}
            sandbox="allow-scripts"
            srcDoc={viewBuilder.view.html}
            onLoad={onFrameLoad}
          />
          <IonNote className="voice-view-panel__title">{viewBuilder.view.title}</IonNote>
        </div>
      )}

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
        <IonNote className="voice-empty">
          Nothing said yet. Hit start, allow the microphone, and just talk — {VOICE_MODEL_ID}{" "}
          answers out loud and the transcript shows up here.
        </IonNote>
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
    </>
  );
}
