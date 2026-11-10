import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import { useState } from "react";

import { describeProgress, viewTitle, type View, type ViewUIMessage } from "../../shared/view.ts";
import { viewUrl } from "./api.ts";
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
   * stateless and reads whatever it is editing through `inspect_current_view`,
   * so shipping the history would pay for the same HTML on every turn.
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
 * News the voice agent has to be told, because nobody said it out loud. The id
 * makes each one distinct: two identical failures in a row are still two
 * things worth mentioning, and state that compares equal would swallow the
 * second.
 */
export type ViewReport = { id: number; text: string };

/**
 * Drives the coding agent and holds whatever it last published.
 *
 * `report` is published as state rather than fired through a callback so the
 * caller can send it from an effect. The voice session reaches its socket
 * through a ref, and handing a ref-reading callback down through render is
 * what makes the React Compiler skip the component entirely.
 *
 * Only landing and failing are reported. Progress in between stays on screen
 * and out of the conversation — narrating every step aloud would be worse than
 * silence.
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
   * The last build failure, kept on screen until the next build starts.
   * Telling only the voice model was not enough: it paraphrases ("I ran into a
   * problem, let me try again") and retries, and the actual reason showed up
   * nowhere a person could read it.
   */
  const [failure, setFailure] = useState<string | null>(null);

  const say = (text: string) => setReport((previous) => ({ id: (previous?.id ?? 0) + 1, text }));

  const { sendMessage } = useChat<ViewUIMessage>({
    transport,
    onData: (part) => {
      if (part.type === "data-progress") setStatus(describeProgress(part.data));
      if (part.type === "data-draft") setDraft(part.data.html);
      if (part.type === "data-cost") addViewCost(part.data.usd);

      if (part.type === "data-view") {
        setView(part.data);
        setDraft(null);
        setStatus(null);
        say(`The page is on screen, titled "${part.data.title}".`);
      }
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
  const build = (request: string) => {
    setStatus("Starting…");
    setFailure(null);
    void sendMessage(
      { text: request },
      { body: { password, ...(view != null && { currentHtml: view.html }) } },
    );
  };

  return { screen, status, failure, report, build };
}
