import { useSyncExternalStore } from "react";

import {
  DEFAULT_VIEW_MODEL_ID,
  isViewModelId,
  type ViewModelId,
} from "../../shared/view-models.ts";

/**
 * Which model builds and edits the pages, remembered per device in localStorage like the
 * theme and asker mode. Changing it is gated by the password (`ModelPicker`); this module only
 * stores the choice. `useViewBuilder` sends it with every build request, and the Worker
 * accepts only the allowlisted ids.
 */

const STORAGE_KEY = "astro.view-model.v1";

function read(): ViewModelId {
  try {
    const stored = globalThis.localStorage?.getItem(STORAGE_KEY);
    return isViewModelId(stored) ? stored : DEFAULT_VIEW_MODEL_ID;
  } catch {
    return DEFAULT_VIEW_MODEL_ID;
  }
}

let model = read();

const listeners = new Set<() => void>();

export function setViewModel(next: ViewModelId): void {
  model = next;
  try {
    if (next === DEFAULT_VIEW_MODEL_ID) globalThis.localStorage?.removeItem(STORAGE_KEY);
    else globalThis.localStorage?.setItem(STORAGE_KEY, next);
  } catch {
    // Storage unavailable — the choice lives for this page load only.
  }
  for (const listener of listeners) listener();
}

export function getViewModel(): ViewModelId {
  return model;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useViewModel(): ViewModelId {
  return useSyncExternalStore(subscribe, getViewModel, getViewModel);
}
