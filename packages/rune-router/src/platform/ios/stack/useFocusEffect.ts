import { onCleanup } from "solid-js";
import type { FocusEffectCallback } from "../core/types";
import {
  useRouterContext,
  useRoute,
  isRouteKeyFocused,
} from "../core/RouterContext";

export function useFocusEffect(effect: FocusEffectCallback): void {
  const router = useRouterContext();
  const route = useRoute();

  let cleanup: void | (() => void);

  const runEffect = () => {
    cleanup?.();
    cleanup = effect() || undefined;
  };

  const unsubscribe = router.subscribeFocus(route.key, (focused) => {
    if (focused) {
      runEffect();
    } else if (cleanup) {
      cleanup();
      cleanup = undefined;
    }
  });

  if (isRouteKeyFocused(router.state(), route.key)) {
    runEffect();
  }

  onCleanup(() => {
    unsubscribe();
    if (cleanup) {
      cleanup();
    }
  });
}
