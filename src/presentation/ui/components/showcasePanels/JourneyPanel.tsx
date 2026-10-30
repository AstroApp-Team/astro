import { useState } from "react";

import type { ShowcasePanelProps } from "./types.ts";

import "@presentation/ui/styles/panel-journey.css";

type Step = { year: string; title: string; body: string };

const STEPS: Step[] = [
  {
    year: "2019",
    title: "First shipped rig",
    body: "A cube, a camera, and a clip nobody keyframed.",
  },
  { year: "2021", title: "The ring", body: "Prefabs with labels, one theatreKey per node." },
  {
    year: "2023",
    title: "Studio as a bench",
    body: "Rig on the production sheet, land the export by CLI.",
  },
  {
    year: "2025",
    title: "The showcase",
    body: "The same sheet under a page that scrolls over it.",
  },
];

/** `index` is clamped by the two nav buttons, so this never fires in practice. */
const NO_STEP: Step = { year: "—", title: "Nothing here", body: "The stepper is out of range." };

/**
 * The panel the `Journey` satellite opens.
 *
 * A stepper. Independent state, independent stylesheet, same one prop.
 */
export default function JourneyPanel({ onClose }: ShowcasePanelProps) {
  const [index, setIndex] = useState(0);
  const step = STEPS[index] ?? NO_STEP;

  return (
    <div className="panel-journey">
      <ol className="panel-journey__track">
        {STEPS.map((entry, position) => (
          <li
            key={entry.year}
            className={`panel-journey__dot${position <= index ? " panel-journey__dot--lit" : ""}`}
          >
            {entry.year}
          </li>
        ))}
      </ol>

      <div className="panel-journey__step">
        <h3>{step.title}</h3>
        <p>{step.body}</p>
      </div>

      <div className="panel-journey__actions">
        <button
          type="button"
          className="panel-journey__nav"
          disabled={index === 0}
          onClick={() => setIndex((n) => Math.max(0, n - 1))}
        >
          Back
        </button>
        <button
          type="button"
          className="panel-journey__nav"
          disabled={index === STEPS.length - 1}
          onClick={() => setIndex((n) => Math.min(STEPS.length - 1, n + 1))}
        >
          Next
        </button>
        <button type="button" className="panel-journey__done" onClick={onClose}>
          Done
        </button>
      </div>
    </div>
  );
}
