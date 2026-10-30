import { useState } from "react";

import type { ShowcasePanelProps } from "./types.ts";

import "@presentation/ui/styles/panel-voice.css";

const TAKES = [
  { id: "Take 1", note: "cold open, 0:00–0:14" },
  { id: "Take 2", note: "with the ring rising" },
  { id: "Take 3", note: "quieter, no reverb tail" },
  { id: "Take 4", note: "keeper" },
];

/**
 * The panel the `Voice` satellite opens.
 *
 * Self-contained on purpose: its own state, its own stylesheet, its own copy.
 * The page hands it one thing — a way to close itself.
 */
export default function VoicePanel({ onClose }: ShowcasePanelProps) {
  const [armed, setArmed] = useState(false);
  const [take, setTake] = useState(3);
  const current = take;

  return (
    <div className="panel-voice">
      <p className="panel-voice__lead">
        The realtime socket lives here. The browser holds the WebSocket; the Worker only mints the
        client secret.
      </p>

      <button
        type="button"
        className={`panel-voice__arm${armed ? " panel-voice__arm--on" : ""}`}
        onClick={() => setArmed((on) => !on)}
      >
        {armed ? "Listening" : "Standby"}
      </button>

      <ul className="panel-voice__takes">
        {TAKES.map((take, index) => (
          <li key={take.id}>
            <button
              type="button"
              className={`panel-voice__take${index === current ? " panel-voice__take--current" : ""}`}
              onClick={() => setTake(index)}
            >
              {take.id} — {take.note}
            </button>
          </li>
        ))}
      </ul>

      <p className="panel-voice__foot">
        Selected take: <strong>{TAKES[current]?.id ?? "none"}</strong>
      </p>

      <button type="button" className="panel-voice__done" onClick={onClose}>
        Done
      </button>
    </div>
  );
}
