import { create } from "zustand";

/**
 * Global app / navigation state.
 *
 * Route is owned by the router (Ionic's view stack is the source of truth for
 * *where the user is*), so this store does not duplicate it. What lives here is
 * the app-level state the router cannot express: which surface the shell is on,
 * whether the dev overlay is up, and whether the native shell has finished
 * wiring itself (status bar style, haptics, permissions).
 */
export type AppScreen = "voice" | "studio-corner" | "rig";

export type AppStore = {
  screen: AppScreen;
  devOverlayVisible: boolean;
  nativeShellReady: boolean;
  setScreen(screen: AppScreen): void;
  setDevOverlay(visible: boolean): void;
  markNativeShellReady(): void;
};

export const useAppStore = create<AppStore>((set) => ({
  screen: "voice",
  devOverlayVisible: import.meta.env.DEV,
  nativeShellReady: false,

  setScreen(screen) {
    set({ screen });
  },
  setDevOverlay(visible) {
    set({ devOverlayVisible: visible });
  },
  markNativeShellReady() {
    set({ nativeShellReady: true });
  },
}));
