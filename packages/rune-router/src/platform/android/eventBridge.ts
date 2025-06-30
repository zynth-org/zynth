import {
  emitRouterEvent,
  ROUTER_EVENT_STATE_CHANGED,
  ROUTER_EVENT_FOCUS,
  ROUTER_EVENT_BLUR,
  ROUTER_EVENT_BACK,
} from "../ios/core/events";
import type { NavigationState, RouteNode } from "../ios/core/types";

let lastFocused: string | null = null;

export function emitStackChange(routes: string[]): void {
  const state = buildState(routes);
  emitRouterEvent(ROUTER_EVENT_STATE_CHANGED, { state });

  const nextFocus = routes[routes.length - 1] ?? null;
  if (nextFocus && nextFocus !== lastFocused) {
    if (lastFocused) {
      emitRouterEvent(ROUTER_EVENT_BLUR, { key: lastFocused });
    }
    emitRouterEvent(ROUTER_EVENT_FOCUS, { key: nextFocus });
    lastFocused = nextFocus;
  }
}

export function emitBackEvent(source?: string): void {
  emitRouterEvent(ROUTER_EVENT_BACK, { source });
}

function buildState(routes: string[]): NavigationState {
  const stackRoutes: RouteNode[] = routes.map((name, index) => ({
    key: `${name}-${index}`,
    name,
  }));
  return {
    key: "stack-root",
    type: "stack",
    index: stackRoutes.length > 0 ? stackRoutes.length - 1 : 0,
    routes: stackRoutes,
  };
}
