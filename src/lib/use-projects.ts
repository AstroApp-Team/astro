import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { InferResponseType } from "hono/client";
import { useEffect, useRef } from "react";

import { PASSWORD_QUERY_PARAM } from "../../shared/realtime.ts";
import { MAX_VIEW_STATE_BYTES, viewSpec, viewTitle, type View } from "../../shared/view.ts";
import { api } from "./api.ts";

export type ProjectSummaryDto = InferResponseType<
  typeof api.projects.$get,
  200
>["projects"][number];
export type ProjectDetailsDto = InferResponseType<
  (typeof api.projects)[":id"]["$get"],
  200
>["project"];

const STATE_AUTOSAVE_DEBOUNCE_MS = 600;

export const projectKeys = {
  all: ["projects"] as const,
  detail: (id: string) => ["projects", id] as const,
};

export async function fetchProjectsList(password: string): Promise<ProjectSummaryDto[]> {
  const res = await api.projects.$get({
    query: { [PASSWORD_QUERY_PARAM]: password },
  });
  if (!res.ok) {
    throw new Error("Could not load saved projects.");
  }
  const data = await res.json();
  return data.projects;
}

export async function fetchProjectDetails(
  password: string,
  id: string,
): Promise<ProjectDetailsDto> {
  const res = await api.projects[":id"].$get({
    param: { id },
    query: { [PASSWORD_QUERY_PARAM]: password },
  });
  if (!res.ok) {
    throw new Error("Could not open the selected project.");
  }
  const data = await res.json();
  return data.project;
}

export function useProjectsList(password: string, enabled: boolean) {
  return useQuery({
    queryKey: projectKeys.all,
    queryFn: () => fetchProjectsList(password),
    enabled: enabled && password !== "",
  });
}

export function useDeleteProject(password: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (id: string) => {
      const res = await api.projects[":id"].$delete({
        param: { id },
        query: { [PASSWORD_QUERY_PARAM]: password },
      });
      if (!res.ok) {
        throw new Error("Could not delete project.");
      }
      return id;
    },
    onSuccess: (deletedId) => {
      void queryClient.invalidateQueries({ queryKey: projectKeys.all });
      queryClient.removeQueries({ queryKey: projectKeys.detail(deletedId) });
    },
  });
}

/**
 * Silently persists valid builds (`index.html` + project metadata) and
 * debounced runtime state (`astro:state`) to D1 without interrupting voice.
 */
export function useProjectAutoSave({
  password,
  activeProjectId,
  onProjectCreated,
  lastCheckedView,
  latestState,
}: {
  password: string;
  activeProjectId: string | null;
  onProjectCreated: (id: string) => void;
  lastCheckedView: { id: number; view: View } | null;
  latestState: { id: number; data: unknown } | null;
}) {
  const queryClient = useQueryClient();
  const lastSavedBuildIdRef = useRef(0);
  const lastSavedStateIdRef = useRef(0);
  const onProjectCreatedRef = useRef(onProjectCreated);

  useEffect(() => {
    onProjectCreatedRef.current = onProjectCreated;
  });

  useEffect(() => {
    if (lastCheckedView == null || password === "") return;
    if (lastSavedBuildIdRef.current === lastCheckedView.id) return;
    lastSavedBuildIdRef.current = lastCheckedView.id;

    const controller = new AbortController();
    const { html } = lastCheckedView.view;
    const title = lastCheckedView.view.title || viewTitle(html);
    const spec = (viewSpec(html) ?? []).join("\n");

    const persistBuild = async () => {
      try {
        if (activeProjectId == null) {
          const res = await api.projects.$post({
            json: { password, title, spec, html },
          });
          if (!res.ok) return;
          const data = await res.json();
          if (!controller.signal.aborted) {
            onProjectCreatedRef.current(data.project.id);
          }
          void queryClient.invalidateQueries({ queryKey: projectKeys.all });
          return;
        }

        const res = await api.projects[":id"].files.$put({
          param: { id: activeProjectId },
          json: {
            password,
            filePath: "index.html",
            content: html,
            title,
            spec,
          },
        });
        if (!res.ok) return;
        void queryClient.invalidateQueries({ queryKey: projectKeys.all });
        void queryClient.invalidateQueries({ queryKey: projectKeys.detail(activeProjectId) });
      } catch (error) {
        console.error("Project build auto-save failed:", error);
      }
    };

    void persistBuild();
    return () => {
      controller.abort();
    };
  }, [lastCheckedView, activeProjectId, password, queryClient]);

  useEffect(() => {
    if (latestState == null || activeProjectId == null || password === "") return;
    if (lastSavedStateIdRef.current === latestState.id) return;

    const timer = setTimeout(() => {
      let serialized: string | undefined;
      try {
        serialized = JSON.stringify(latestState.data);
      } catch {
        return;
      }
      if (serialized === undefined || serialized.length > MAX_VIEW_STATE_BYTES) return;

      lastSavedStateIdRef.current = latestState.id;

      const persistState = async () => {
        try {
          const res = await api.projects[":id"].state.$put({
            param: { id: activeProjectId },
            json: { password, stateData: serialized },
          });
          if (!res.ok) return;
          void queryClient.invalidateQueries({ queryKey: projectKeys.detail(activeProjectId) });
        } catch (error) {
          console.error("Project state auto-save failed:", error);
        }
      };

      void persistState();
    }, STATE_AUTOSAVE_DEBOUNCE_MS);

    return () => clearTimeout(timer);
  }, [latestState, activeProjectId, password, queryClient]);
}
