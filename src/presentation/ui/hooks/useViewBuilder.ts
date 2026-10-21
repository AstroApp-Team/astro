import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import { useState } from "react";

import { describeProgress, type View, type ViewUIMessage } from "@shared/view.ts";
import { viewUrl } from "@infra/api/httpClient.ts";

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
  const [status, setStatus] = useState<string | null>(null);
  const [report, setReport] = useState<ViewReport | null>(null);

  const say = (text: string) => setReport((previous) => ({ id: (previous?.id ?? 0) + 1, text }));

  const { sendMessage } = useChat<ViewUIMessage>({
    transport,
    onData: (part) => {
      if (part.type === "data-progress") setStatus(describeProgress(part.data));

      if (part.type === "data-view") {
        setView(part.data);
        setStatus(null);
        say(`The page is on screen. It is titled "${part.data.title}". ${part.data.summary}`);
      }
    },
    onError: (error) => {
      setStatus(null);
      say(`Building the page failed: ${error.message}`);
    },
  });

  /**
   * `view` is read at call time rather than through a ref: the realtime hook
   * re-binds `onToolCall` on every render, so the closure that reaches this is
   * always the current one.
   */
  const build = (request: string) => {
    setStatus("Starting…");
    void sendMessage(
      { text: request },
      { body: { password, ...(view != null && { currentHtml: view.html }) } },
    );
  };

  return { view, status, report, build };
}
