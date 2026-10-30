import { useState } from "react";

import type { ShowcasePanelProps } from "./types.ts";

import "@presentation/ui/styles/panel-infra.css";

const SERVICES = [
  { id: "worker", name: "Worker", ms: 12 },
  { id: "d1", name: "D1", ms: 4 },
  { id: "gateway", name: "AI Gateway", ms: 240 },
  { id: "r2", name: "R2", ms: 31 },
];

const STATES = ["ok", "warm", "cold"] as const;

/**
 * The panel the `Infra` satellite opens.
 *
 * Its own poll counter, its own rows. The numbers are invented — this panel is a
 * placeholder for a real health view, and it is written the way a real one would
 * be: local state, local styles, one prop in.
 */
export default function InfraPanel({ onClose }: ShowcasePanelProps) {
  const [polls, setPolls] = useState(1);

  const rows = SERVICES.map((service, index) => ({
    ...service,
    state: STATES[(index + polls) % STATES.length],
  }));

  return (
    <div className="panel-infra">
      <table className="panel-infra__table">
        <thead>
          <tr>
            <th>Binding</th>
            <th>State</th>
            <th>p50</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id}>
              <td>{row.name}</td>
              <td>
                <span className={`panel-infra__state panel-infra__state--${row.state}`}>
                  {row.state}
                </span>
              </td>
              <td>{row.ms} ms</td>
            </tr>
          ))}
        </tbody>
      </table>

      <p className="panel-infra__foot">
        Poll <strong>{polls}</strong> · numbers are stand-ins, not a live probe
      </p>

      <div className="panel-infra__actions">
        <button type="button" className="panel-infra__poll" onClick={() => setPolls((n) => n + 1)}>
          Re-poll
        </button>
        <button type="button" className="panel-infra__done" onClick={onClose}>
          Done
        </button>
      </div>
    </div>
  );
}
