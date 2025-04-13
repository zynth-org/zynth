import { createEffect, onCleanup } from "solid-js";
import {
  ROUTER_EVENT_BLUR,
  ROUTER_EVENT_FOCUS,
  ROUTER_EVENT_TRANSITION_END,
  ROUTER_EVENT_TRANSITION_PROGRESS,
  ROUTER_EVENT_TRANSITION_START,
  ROUTER_EVENT_PREDICTIVE_BACK,
  addRouterEventListener,
} from "../core/events";
import type { RouterEventListener } from "../core/events";

export interface NavigationEventHandlers {
  transitionStart?: RouterEventListener<typeof ROUTER_EVENT_TRANSITION_START>;
  transitionEnd?: RouterEventListener<typeof ROUTER_EVENT_TRANSITION_END>;
  transitionProgress?: RouterEventListener<
    typeof ROUTER_EVENT_TRANSITION_PROGRESS
  >;
  focus?: RouterEventListener<typeof ROUTER_EVENT_FOCUS>;
  blur?: RouterEventListener<typeof ROUTER_EVENT_BLUR>;
  predictiveBack?: RouterEventListener<typeof ROUTER_EVENT_PREDICTIVE_BACK>;
}

export function useNavigationEvents(handlers: NavigationEventHandlers): void {
  createEffect(() => {
    const subscriptions: Array<() => void> = [];

    if (handlers.transitionStart) {
      subscriptions.push(
        addRouterEventListener(
          ROUTER_EVENT_TRANSITION_START,
          handlers.transitionStart
        )
      );
    }
    if (handlers.transitionEnd) {
      subscriptions.push(
        addRouterEventListener(
          ROUTER_EVENT_TRANSITION_END,
          handlers.transitionEnd
        )
      );
    }
    if (handlers.transitionProgress) {
      subscriptions.push(
        addRouterEventListener(
          ROUTER_EVENT_TRANSITION_PROGRESS,
          handlers.transitionProgress
        )
      );
    }
    if (handlers.focus) {
      subscriptions.push(
        addRouterEventListener(ROUTER_EVENT_FOCUS, handlers.focus)
      );
    }
    if (handlers.blur) {
      subscriptions.push(
        addRouterEventListener(ROUTER_EVENT_BLUR, handlers.blur)
      );
    }
    if (handlers.predictiveBack) {
      subscriptions.push(
        addRouterEventListener(
          ROUTER_EVENT_PREDICTIVE_BACK,
          handlers.predictiveBack
        )
      );
    }

    onCleanup(() => {
      for (const unsubscribe of subscriptions) {
        unsubscribe();
      }
    });
  });
}
