/**
 * Selection ↔ URL.
 *
 * Selection is query state (`?sel=state:locomotion/idle`) so a workspace can be reproduced
 * from a link and a bug report can *be* the link (§1). The codec is pure and total: an
 * unparseable value is `null` (nothing selected), never a throw, because a hand-typed URL
 * must not take the page down.
 */

import type { Selection } from "@core/models/animationStateMachineEditor.ts";

/** `state:<layer>/<state>`, `transition:<layer>/<from>/<to>/<index>`, … */
export function encodeSelection(selection: Selection): string | null {
  if (selection == null) return null;
  switch (selection.kind) {
    case "state":
      return `state:${selection.layer}/${selection.state}`;
    case "transition":
      return `transition:${selection.layer}/${selection.from}/${selection.to}/${selection.index}`;
    case "layer":
      return `layer:${selection.layer}`;
    case "input":
      return `input:${selection.name}`;
    case "listener":
      return `listener:${selection.index}`;
    case "timeline":
      return `timeline:${selection.clipId}`;
  }
}

export function decodeSelection(value: string | null | undefined): Selection {
  if (value == null || value === "") return null;
  const colon = value.indexOf(":");
  if (colon < 0) return null;
  const kind = value.slice(0, colon);
  const body = value.slice(colon + 1);

  switch (kind) {
    case "state": {
      const [layer, state] = body.split("/");
      return layer == null || state == null ? null : { kind: "state", layer, state };
    }
    case "transition": {
      /* The pair itself may contain a slash only if a state id does, and state ids are
         `[A-Za-z0-9_-]` by validation — so splitting from the right is safe. */
      const parts = body.split("/");
      const index = Number(parts.pop());
      const to = parts.pop();
      const from = parts.pop();
      const layer = parts.join("/");
      if (layer === "" || from == null || to == null || !Number.isInteger(index)) return null;
      return { kind: "transition", layer, from, to, index };
    }
    case "layer":
      return body === "" ? null : { kind: "layer", layer: body };
    case "input":
      return body === "" ? null : { kind: "input", name: body };
    case "listener": {
      const index = Number(body);
      return Number.isInteger(index) && index >= 0 ? { kind: "listener", index } : null;
    }
    case "timeline":
      return body === "" ? null : { kind: "timeline", clipId: body };
    default:
      return null;
  }
}

/** The same node, addressed by the string the graph and the editor file use. */
export function selectionNodeKey(selection: Selection): string | null {
  return selection?.kind === "state" ? `${selection.layer}/${selection.state}` : null;
}
