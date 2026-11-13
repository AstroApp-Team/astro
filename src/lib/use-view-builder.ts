import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import { useRef, useState } from "react";

import {
  describeProgress,
  removedSpecItems,
  viewTitle,
  type View,
  type ViewUIMessage,
} from "../../shared/view.ts";
import { viewUrl } from "./api.ts";
import { runViewCheck } from "./view-check.ts";
import { addViewCost } from "./voice-usage.ts";

/**
 * Built once: `useChat` resolves the transport per request through its own
 * ref, but nothing here varies per render either. Everything that *does* vary
 * rides in the request body instead.
 */
const transport = new DefaultChatTransport<ViewUIMessage>({
  api: viewUrl(),
  /**
   * `/api/view` takes one request, not a transcript. The coding agent is
   * stateless and gets the page it is editing as `currentHtml`, so shipping the
   * history would pay for the same HTML on every turn.
   */
  prepareSendMessagesRequest: ({ messages, body }) => ({
    body: { ...body, request: lastText(messages) },
  }),
});

function lastText(messages: ViewUIMessage[]): string {
  const parts = messages.at(-1)?.parts ?? [];
  return parts.map((part) => (part.type === "text" ? part.text : "")).join("");
}

/**
 * How many times a failed runtime check is sent straight back to the coding
 * agent before the page is reported as landed-with-problems. Each round is a
 * few seconds on the fast model; past two, the page needs a rebuild, and that
 * is the voice model's call.
 */
const MAX_AUTO_FIXES = 2;

export type BuildMode = "edit" | "rebuild";

/**
 * News the voice agent has to be told, because nobody said it out loud. The id
 * makes each one distinct: two identical failures in a row are still two
 * things worth mentioning, and state that compares equal would swallow the
 * second.
 */
export type ViewReport = { id: number; text: string };

/**
 * Drives the coding agent and holds whatever it last published.
 *
 * Every finished page is run once in a hidden frame (`runViewCheck`) before it
 * is reported. Problems go straight back to the agent as a fix request, up to
 * `MAX_AUTO_FIXES` times, without bothering the voice model.
 *
 * `report` is published as state rather than fired through a callback so the
 * caller can send it from an effect. The voice session reaches its socket
 * through a ref, and handing a ref-reading callback down through render is
 * what makes the React Compiler skip the component entirely.
 */
export function useViewBuilder({ password }: { password: string }) {
  const [view, setView] = useState<View | null>(null);
  /**
   * The page mid-run, painted as it streams in. Kept apart from `view`
   * because it has not passed the checks: it is what the user sees, never what
   * goes back as `currentHtml`, and a failed run drops it to reveal the last
   * good page again.
   */
  const [draft, setDraft] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [report, setReport] = useState<ViewReport | null>(null);
  /**
   * Incremented once a generated page finishes `runViewCheck` with zero
   * problems, so auto-save persists only verified builds rather than drafts
   * or failing intermediate attempts.
   */
  const [lastCheckedView, setLastCheckedView] = useState<{ id: number; view: View } | null>(null);
  /**
   * The last build failure, kept on screen until the next build starts.
   * Telling only the voice model was not enough: it paraphrases ("I ran into a
   * problem, let me try again") and retries, and the actual reason showed up
   * nowhere a person could read it.
   */
  const [failure, setFailure] = useState<string | null>(null);

  /**
   * One user request, across the automatic fix rounds it may take. `baseline`
   * is the page as it was before the request, so the report can say which
   * spec items the whole run dropped. `landed` is the page a request has
   * finished with, checked once its stream has closed.
   */
  const runRef = useRef({
    id: 0,
    fixes: 0,
    baseline: null as string | null,
    landed: null as View | null,
  });

  const say = (text: string) => setReport((previous) => ({ id: (previous?.id ?? 0) + 1, text }));

  const send = (
    request: string,
    options: { mode: BuildMode; currentHtml: string | null; pageErrors?: string[] },
  ) => {
    void sendMessage(
      { text: request },
      {
        body: {
          password,
          mode: options.mode,
          ...(options.currentHtml != null && { currentHtml: options.currentHtml }),
          ...(options.pageErrors != null &&
            options.pageErrors.length > 0 && { pageErrors: options.pageErrors }),
        },
      },
    );
  };

  /** Runs once the stream has closed, so a fix request never overlaps it. */
  const check = async (landed: View) => {
    const run = runRef.current;
    const id = run.id;
    setStatus("Verificando a página…");
    const problems = await runViewCheck(landed.html);
    if (runRef.current.id !== id) return;

    if (problems.length > 0 && run.fixes < MAX_AUTO_FIXES) {
      run.fixes += 1;
      setStatus(
        `Corrigindo ${problems.length} ${problems.length === 1 ? "problema" : "problemas"}…`,
      );
      send(
        "Running the page found these problems. Fix them without changing anything else:\n" +
          problems.map((problem) => `- ${problem}`).join("\n"),
        { mode: "edit", currentHtml: landed.html },
      );
      return;
    }

    setStatus(null);
    if (problems.length === 0) {
      setLastCheckedView((previous) => ({ id: (previous?.id ?? 0) + 1, view: landed }));
    }
    say(describeLanding(landed, run.baseline, problems));
  };

  const { sendMessage } = useChat<ViewUIMessage>({
    transport,
    onData: (part) => {
      if (part.type === "data-progress") setStatus(describeProgress(part.data));
      if (part.type === "data-draft") setDraft(part.data.html);
      if (part.type === "data-cost") addViewCost(part.data.usd);

      if (part.type === "data-view") {
        setView(part.data);
        setDraft(null);
        runRef.current.landed = part.data;
      }
    },
    onFinish: ({ isAbort, isError }) => {
      const landed = runRef.current.landed;
      runRef.current.landed = null;
      if (isAbort || isError || landed == null) return;
      void check(landed);
    },
    onError: (error) => {
      setDraft(null);
      setStatus(null);
      setFailure(error.message);
      console.error("Building the page failed:", error);
      say(`Building the page failed: ${error.message}`);
    },
  });

  /** What to render: the page being written if there is one, else the last good one. */
  const screen: View | null = draft != null ? { title: viewTitle(draft), html: draft } : view;

  /**
   * `view` is read at call time rather than through a ref: the realtime hook
   * re-binds `onToolCall` on every render, so the closure that reaches this is
   * always the current one.
   */
  const build = (
    request: string,
    { mode = "edit", pageErrors }: { mode?: BuildMode; pageErrors?: string[] } = {},
  ) => {
    runRef.current = {
      id: runRef.current.id + 1,
      fixes: 0,
      baseline: view?.html ?? null,
      landed: null,
    };
    setStatus(
      mode === "rebuild"
        ? "Reconstruindo o aplicativo — isso leva alguns instantes…"
        : "Iniciando…",
    );
    setFailure(null);
    send(request, {
      mode,
      currentHtml: view?.html ?? null,
      ...(pageErrors != null && { pageErrors }),
    });
  };

  /**
   * Injects a persisted project view (or `null` for a blank stage) without
   * triggering the coding agent or emitting a voice report.
   */
  const loadView = (loaded: View | null) => {
    runRef.current = {
      id: runRef.current.id + 1,
      fixes: 0,
      baseline: loaded?.html ?? null,
      landed: null,
    };
    setDraft(null);
    setStatus(null);
    setFailure(null);
    setView(loaded);
  };

  return {
    screen,
    /** The finished page, or null while a draft is on screen instead. */
    finishedHtml: draft == null ? (view?.html ?? null) : null,
    hasView: view != null,
    status,
    failure,
    report,
    lastCheckedView,
    build,
    loadView,
  };
}

/** Phrased for the voice model, which decides what is worth saying aloud. */
export function describeLanding(landed: View, baseline: string | null, problems: string[]): string {
  let text = `The page is on screen, titled "${landed.title}".`;

  const removed = baseline == null ? [] : removedSpecItems(baseline, landed.html);
  if (removed.length > 0) {
    text +=
      ` It no longer lists these features: ${removed.join("; ")}. If the user did not ask ` +
      "for that, mention it and ask whether they want them back. Do not change the page yourself.";
  }
  if (problems.length > 0) {
    text +=
      ` A check still finds problems: ${problems.join("; ")}. Mention it briefly and ask ` +
      "whether they want it fixed. Do not change the page yourself.";
  }
  return text;
}
