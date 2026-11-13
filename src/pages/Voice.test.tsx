// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import type { PropsWithChildren } from "react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

const { routerMock } = vi.hoisted(() => ({
  routerMock: {
    canGoBack: vi.fn(() => false),
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
      <div data-testid={`header-${slot ?? "none"}`} data-slot={slot} {...rest}>
        {children}
      </div>
    ),
    IonContent: PassThrough,
    IonHeader: ({ children, ...rest }: PropsWithChildren<Record<string, unknown>>) => (
      <header {...rest}>{children}</header>
    ),
    IonPage: PassThrough,
    IonTitle: ({ children, ...rest }: PropsWithChildren<Record<string, unknown>>) => (
      <h1 {...rest}>{children}</h1>
    ),
    IonToolbar: PassThrough,
    useIonRouter: () => routerMock,
  };
});

vi.mock("../components/PasswordGate.tsx", () => ({
  default: () => <div data-testid="password-gate" />,
}));

vi.mock("../components/VoiceSession.tsx", () => ({
  default: ({ projectsOpen }: { projectsOpen?: boolean }) => (
    <div data-testid="voice-session" data-projects-open={String(Boolean(projectsOpen))} />
  ),
}));

import { setPassword } from "../lib/password.ts";
import Voice from "./Voice.tsx";

describe("Voice header controls", () => {
  beforeEach(() => {
    routerMock.push.mockReset();
    setPassword("secret-pass");
  });

  afterEach(() => {
    cleanup();
    setPassword("");
  });

  it("keeps every header control together in one row and omits spend/forget-password", () => {
    render(
      <MemoryRouter initialEntries={["/voice"]}>
        <Voice />
      </MemoryRouter>,
    );

    const startSlot = screen.getByTestId("header-start");
    expect(screen.queryByTestId("header-end")).toBeNull();

    const settingsBtn = within(startSlot).getByRole("button", { name: "Configurações" });
    const projectsBtn = within(startSlot).getByRole("button", { name: "Projetos salvos" });
    expect(
      within(startSlot)
        .getAllByRole("button")
        .map((b) => b.getAttribute("aria-label")),
    ).toEqual(["Configurações", "Projetos salvos", "Tela cheia", "Limpar conversa"]);

    expect(screen.queryByRole("button", { name: "Esquecer senha" })).toBeNull();
    expect(screen.queryByText(/^\$\d/)).toBeNull();

    fireEvent.click(projectsBtn);
    expect(screen.getByTestId("voice-session").getAttribute("data-projects-open")).toBe("true");

    fireEvent.click(settingsBtn);
    expect(routerMock.push).toHaveBeenCalledWith("/settings", "forward", "push");
    expect(screen.getByTestId("voice-session").getAttribute("data-projects-open")).toBe("false");
  });
});
