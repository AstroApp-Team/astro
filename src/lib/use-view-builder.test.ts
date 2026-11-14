import { describe, expect, it } from "vite-plus/test";

import { describeLanding } from "./use-view-builder.ts";

const page = (...items: string[]) =>
  `<title>Budget</title><!-- spec\n${items.map((item) => `- ${item}`).join("\n")}\n-->`;

describe("describeLanding", () => {
  it("says only that the page landed when nothing was lost and the check passed", () => {
    const html = page("Adds income", "Adds expenses");
    expect(describeLanding({ title: "Budget", html }, page("Adds income"), [])).toBe(
      'A página está na tela, com o título "Budget".',
    );
  });

  it("names every feature the run dropped, so the voice model can ask for it back", () => {
    // The failure that motivated the spec: an edit that quietly deletes a feature.
    const before = page("Adds income", "Tabs for Painel and Transações");
    const text = describeLanding({ title: "Budget", html: page("Adds income") }, before, []);

    expect(text).toContain("não lista mais estas funcionalidades: Tabs for Painel and Transações");
  });

  it("passes on problems the automatic fixes could not clear, and asks before changing anything", () => {
    const text = describeLanding({ title: "Budget", html: page("Adds income") }, null, [
      "action buy() from the starting state: s.wallet is undefined",
    ]);

    expect(text).toContain("s.wallet is undefined");
    expect(text).toContain("Não mude a página por conta própria");
    expect(text).not.toContain("rebuild_view");
  });
});
