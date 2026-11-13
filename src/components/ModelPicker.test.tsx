// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { PropsWithChildren } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

const { authMock } = vi.hoisted(() => ({ authMock: vi.fn() }));

vi.mock("@ionic/react", () => ({
  IonText: ({ children }: PropsWithChildren) => <div>{children}</div>,
  IonInput: ({
    value,
    label,
    onIonInput,
  }: {
    value: string;
    label: string;
    onIonInput: (event: { detail: { value: string } }) => void;
  }) => (
    <input
      aria-label={label}
      type="password"
      value={value}
      onChange={(event) => onIonInput({ detail: { value: event.target.value } })}
    />
  ),
}));

vi.mock("../lib/api.ts", () => ({ api: { auth: { $post: authMock } } }));

import { DEFAULT_VIEW_MODEL_ID } from "../../shared/view-models.ts";
import { getViewModel, setViewModel } from "../lib/view-model.ts";
import ModelPicker from "./ModelPicker.tsx";

const HAIKU = "anthropic/claude-haiku-5.5";

describe("ModelPicker", () => {
  beforeEach(() => {
    authMock.mockReset();
    setViewModel(DEFAULT_VIEW_MODEL_ID);
  });

  afterEach(() => {
    cleanup();
    setViewModel(DEFAULT_VIEW_MODEL_ID);
  });

  const type = (value: string) =>
    fireEvent.change(screen.getByLabelText("Senha"), { target: { value } });

  it("starts on the default model with no password prompt", () => {
    render(<ModelPicker />);
    expect(screen.getByRole("button", { name: /Sonnet 5.5/ }).getAttribute("aria-pressed")).toBe(
      "true",
    );
    expect(screen.queryByLabelText("Senha")).toBeNull();
  });

  it("asks for the password before switching, and switches once the Worker accepts it", async () => {
    authMock.mockResolvedValue({ ok: true });
    render(<ModelPicker />);

    fireEvent.click(screen.getByRole("button", { name: /Haiku 5.5/ }));
    // Nothing changes yet: the prompt is up and the old model is still in use.
    expect(getViewModel()).toBe(DEFAULT_VIEW_MODEL_ID);
    expect(screen.getByText(/Digite a senha para trocar para/)).toBeTruthy();

    type("the-password");
    fireEvent.click(screen.getByRole("button", { name: "Confirmar" }));

    await waitFor(() => expect(getViewModel()).toBe(HAIKU));
    expect(authMock).toHaveBeenCalledWith({ json: { password: "the-password" } });
    expect(localStorage.getItem("astro.view-model.v1")).toBe(HAIKU);
    expect(screen.queryByLabelText("Senha")).toBeNull();
    expect(screen.getByRole("button", { name: /Haiku 5.5/ }).getAttribute("aria-pressed")).toBe(
      "true",
    );
  });

  it("keeps the old model and says so when the password is wrong", async () => {
    authMock.mockResolvedValue({ ok: false });
    render(<ModelPicker />);

    fireEvent.click(screen.getByRole("button", { name: /Haiku 5.5/ }));
    type("wrong");
    fireEvent.click(screen.getByRole("button", { name: "Confirmar" }));

    expect(await screen.findByText("Senha incorreta.")).toBeTruthy();
    expect(getViewModel()).toBe(DEFAULT_VIEW_MODEL_ID);
  });

  it("does not call the Worker for an empty password", () => {
    render(<ModelPicker />);
    fireEvent.click(screen.getByRole("button", { name: /Haiku 5.5/ }));
    fireEvent.click(screen.getByRole("button", { name: "Confirmar" }));

    expect(screen.getByText("Digite a senha para trocar o modelo.")).toBeTruthy();
    expect(authMock).not.toHaveBeenCalled();
  });

  it("reports a failed check and keeps the old model when the Worker cannot be reached", async () => {
    authMock.mockRejectedValue(new Error("offline"));
    render(<ModelPicker />);

    fireEvent.click(screen.getByRole("button", { name: /Haiku 5.5/ }));
    type("whatever");
    fireEvent.click(screen.getByRole("button", { name: "Confirmar" }));

    expect(await screen.findByText(/Não foi possível verificar a senha/)).toBeTruthy();
    expect(getViewModel()).toBe(DEFAULT_VIEW_MODEL_ID);
  });

  it("asks again for the next change, and Cancel closes the prompt without changing anything", async () => {
    authMock.mockResolvedValue({ ok: true });
    render(<ModelPicker />);

    fireEvent.click(screen.getByRole("button", { name: /Haiku 5.5/ }));
    type("pw");
    fireEvent.click(screen.getByRole("button", { name: "Confirmar" }));
    await waitFor(() => expect(getViewModel()).toBe(HAIKU));

    fireEvent.click(screen.getByRole("button", { name: /Opus 5.5/ }));
    // The password is never remembered between changes.
    expect((screen.getByLabelText("Senha") as HTMLInputElement).value).toBe("");

    fireEvent.click(screen.getByRole("button", { name: "Cancelar" }));
    expect(screen.queryByLabelText("Senha")).toBeNull();
    expect(getViewModel()).toBe(HAIKU);
  });
});
