import { QueryClient } from "@tanstack/react-query";

/**
 * Nothing queries the API yet — the realtime session talks straight to xAI over
 * a WebSocket. The provider stays mounted so the next server-state feature has
 * somewhere to land.
 */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Mobile clients reconnect often; refetching on every focus is noisy.
      refetchOnWindowFocus: false,
      staleTime: 30_000,
      retry: 2,
    },
  },
});
