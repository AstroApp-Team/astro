import { describe, expect, it } from "vite-plus/test";

import { VIEW_ERROR_TYPE, VIEW_EVENT_TYPE } from "../../shared/view.ts";
import { parseViewError } from "./use-view-events.ts";

describe("parseViewError", () => {
  it("accepts the reserved shape", () => {
    expect(parseViewError({ type: VIEW_ERROR_TYPE, message: "x is undefined" })).toBe(
      "x is undefined",
    );
  });

  it("truncates a long message instead of holding it", () => {
    expect(parseViewError({ type: VIEW_ERROR_TYPE, message: "x".repeat(5_000) })).toHaveLength(300);
  });

  it("drops anything else on the message bus", () => {
    expect(parseViewError({ type: VIEW_EVENT_TYPE, message: "x" })).toBeNull();
    expect(parseViewError({ type: VIEW_ERROR_TYPE, message: "  " })).toBeNull();
    expect(parseViewError({ type: VIEW_ERROR_TYPE, message: { toString: () => "x" } })).toBeNull();
    expect(parseViewError(null)).toBeNull();
  });
});
