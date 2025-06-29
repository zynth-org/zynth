import { createEffect, onCleanup } from "solid-js";
import type { BeforeRemoveHandler } from "../core/types";
import { useRouterContext, useRoute } from "../core/RouterContext";

export interface UseBeforeRemoveOptions {
  enabled?: boolean;
  data?: () => Record<string, unknown> | undefined;
}

/**
 * Runs `handler` before the current screen is removed.
 * Call `event.preventDefault()` inside the handler to block the navigation.
 */
export function useBeforeRemove(
  handler: BeforeRemoveHandler,
  options?: UseBeforeRemoveOptions
): void {
  const router = useRouterContext();
  const route = useRoute();

  createEffect(() => {
    const enabled = options?.enabled ?? true;
    if (!enabled) {
      return;
    }

    const unsubscribe = router.addBeforeRemoveListener(route.key, (event) => {
      if (options?.data) {
        event.data = options.data() ?? event.data;
      }
      handler(event);
    });

    onCleanup(unsubscribe);
  });
}
