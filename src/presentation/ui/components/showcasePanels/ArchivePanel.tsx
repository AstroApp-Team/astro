import { useState } from "react";

import type { ShowcasePanelProps } from "./types.ts";

import "@presentation/ui/styles/panel-archive.css";

const ENTRIES = [
  { id: "rig-014", title: "Rig: sting, four-second rise", tags: ["theatre", "camera"] },
  { id: "rig-015", title: "Rig: hub, slow orbit", tags: ["theatre"] },
  {
    id: "note-201",
    title: "Note: why the scroller must not own the pointer",
    tags: ["r3f", "css"],
  },
  { id: "note-214", title: "Note: D1 has no DATETIME", tags: ["d1", "drizzle"] },
  { id: "clip-007", title: "Clip: exported StudioSandbox → StingScene", tags: ["theatre", "cli"] },
];

/**
 * The panel the `Archive` satellite opens.
 *
 * A filter box over a list — the point is that this panel's state is *its own*.
 * Typing here re-renders this panel and nothing else on the page.
 */
export default function ArchivePanel({ onClose }: ShowcasePanelProps) {
  const [query, setQuery] = useState("");

  const needle = query.trim().toLowerCase();
  const matches =
    needle.length === 0
      ? ENTRIES
      : ENTRIES.filter(
          (entry) =>
            entry.title.toLowerCase().includes(needle) ||
            entry.tags.some((tag) => tag.includes(needle)),
        );

  return (
    <div className="panel-archive">
      <label className="panel-archive__search">
        <span>Filter</span>
        <input
          type="search"
          value={query}
          placeholder="title or tag"
          onChange={(event) => setQuery(event.target.value)}
        />
      </label>

      <ul className="panel-archive__list">
        {matches.map((entry) => (
          <li key={entry.id}>
            <strong>{entry.title}</strong>
            <span>{entry.tags.join(" · ")}</span>
          </li>
        ))}
        {matches.length === 0 ? (
          <li className="panel-archive__empty">Nothing matches “{query}”.</li>
        ) : null}
      </ul>

      <p className="panel-archive__foot">
        {matches.length} of {ENTRIES.length} entries
      </p>

      <button type="button" className="panel-archive__done" onClick={onClose}>
        Done
      </button>
    </div>
  );
}
