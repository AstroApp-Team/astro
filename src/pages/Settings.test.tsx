// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { PropsWithChildren } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

const { routerMock } = vi.hoisted(() => ({
  routerMock: {
    canGoBack: vi.fn(() => true),
    goBack: vi.fn(),
    push: vi.fn(),
  },
}));

vi.mock("@ionic/react", () => {
  const PassThrough = ({ children, ...rest }: PropsWithChildren<Record<string, unknown>>) => (
    <div {...rest}>{children}</div>
  );
  return {
    IonButtons: ({
      children,
      slot,
      ...rest
    }: PropsWithChildren<{ slot?: string } & Record<string, unknown>>) => (
      <div data-slot={slot} {...rest}>
        {children}
      </div>
    ),
    IonContent: PassThrough,
    IonHeader: ({ children, ...rest }: PropsWithChildren<Record<string, unknown>>) => (
      <header {...rest}>{children}</header>
    ),
    IonNote: ({ children, ...rest }: PropsWithChildren<Record<string, unknown>>) => (
      <span {...rest}>{children}</span>
    ),
    IonPage: PassThrough,
    IonTitle: ({ children, ...rest }: PropsWithChildren<Record<string, unknown>>) => (
      <h1 {...rest}>{children}</h1>
    ),
    IonToolbar: PassThrough,
    useIonRouter: () => routerMock,
    useIonViewWillEnter: (cb: () => void) => cb(),
  };
});

import { useAstroStore } from "../lib/astro/store.ts";
import { getPassword, setPassword } from "../lib/password.ts";
import { getTheme, setTheme } from "../lib/theme.ts";
import { addViewCost, addVoiceCost, getUsage, resetUsage, usageToUsd } from "../lib/voice-usage.ts";
import Settings from "./Settings.tsx";

describe("Settings", () => {
  beforeEach(() => {
    routerMock.canGoBack.mockReset().mockReturnValue(true);
    routerMock.goBack.mockReset();
    routerMock.push.mockReset();
    resetUsage();
    setPassword("secret-pass");
    useAstroStore.getState().setHidden(false);
  });

  afterEach(() => {
    cleanup();
    resetUsage();
    setPassword("");
    useAstroStore.getState().setHidden(false);
  });

  it("shows the spend visor, resets accumulated cost, and hides Astro", () => {
    addVoiceCost(0.0125);
    addViewCost(0.005);

    render(<Settings />);

    expect(useAstroStore.getState().hidden).toBe(true);
    expect(screen.getByText("$0.0175")).toBeTruthy();
    expect(screen.getByText(/voz \$0\.0125 · páginas \$0\.0050/i)).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Zerar total acumulado" }));
    expect(usageToUsd(getUsage())).toBe(0);
    expect(screen.getByText("$0.0000")).toBeTruthy();
  });

  it("forgets the password and returns to the voice screen", () => {
    render(<Settings />);

    fireEvent.click(screen.getByRole("button", { name: "Esquecer senha" }));

    expect(getPassword()).toBe("");
    expect(routerMock.goBack).toHaveBeenCalledTimes(1);
  });

  it("falls back to /voice when no prior history exists on Back", () => {
    routerMock.canGoBack.mockReturnValue(false);
    render(<Settings />);

    fireEvent.click(screen.getByRole("button", { name: "Voltar" }));

    expect(routerMock.goBack).not.toHaveBeenCalled();
    expect(routerMock.push).toHaveBeenCalledWith("/voice", "back", "replace");
  });

  it("switches between the dark and light themes, and remembers the choice", () => {
    setTheme("dark");
    render(<Settings />);

    const dark = screen.getByRole("button", { name: "Escuro" });
    const light = screen.getByRole("button", { name: "Claro" });
    expect(dark.getAttribute("aria-pressed")).toBe("true");

    fireEvent.click(light);
    expect(getTheme()).toBe("light");
    expect(document.documentElement.dataset["theme"]).toBe("light");
    expect(localStorage.getItem("astro.theme.v1")).toBe("light");
    expect(light.getAttribute("aria-pressed")).toBe("true");

    fireEvent.click(dark);
    expect(document.documentElement.dataset["theme"]).toBe("dark");
    expect(localStorage.getItem("astro.theme.v1")).toBeNull();
  });
});
