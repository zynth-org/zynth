import { NativeEventEmitter, ensureNativeEmitter } from "@rune/core";
import type { NavigationState, RouterAction } from "./types";

export const ROUTER_EVENT_PREFIX = "rune.router";
export const ROUTER_EVENT_STATE_CHANGED = `${ROUTER_EVENT_PREFIX}.stateChanged` as const;
export const ROUTER_EVENT_TRANSITION_START = `${ROUTER_EVENT_PREFIX}.transitionStart` as const;
export const ROUTER_EVENT_TRANSITION_END = `${ROUTER_EVENT_PREFIX}.transitionEnd` as const;
export const ROUTER_EVENT_TRANSITION_PROGRESS = `${ROUTER_EVENT_PREFIX}.transitionProgress` as const;
export const ROUTER_EVENT_FOCUS = `${ROUTER_EVENT_PREFIX}.focus` as const;
export const ROUTER_EVENT_BLUR = `${ROUTER_EVENT_PREFIX}.blur` as const;
export const ROUTER_EVENT_BACK = `${ROUTER_EVENT_PREFIX}.back` as const;
export const ROUTER_EVENT_PREDICTIVE_BACK = `${ROUTER_EVENT_PREFIX}.predictiveBack` as const;
export const ROUTER_EVENT_BEFORE_REMOVE = `${ROUTER_EVENT_PREFIX}.beforeRemove` as const;
export const ROUTER_EVENT_TAB_SELECTED = `${ROUTER_EVENT_PREFIX}.tabSelected` as const;
export const ROUTER_EVENT_TAB_METRICS = `${ROUTER_EVENT_PREFIX}.tabMetrics` as const;

export type RouterEventName =
  | typeof ROUTER_EVENT_STATE_CHANGED
  | typeof ROUTER_EVENT_TRANSITION_START
  | typeof ROUTER_EVENT_TRANSITION_END
  | typeof ROUTER_EVENT_TRANSITION_PROGRESS
  | typeof ROUTER_EVENT_FOCUS
  | typeof ROUTER_EVENT_BLUR
  | typeof ROUTER_EVENT_PREDICTIVE_BACK
  | typeof ROUTER_EVENT_BACK
  | typeof ROUTER_EVENT_BEFORE_REMOVE
  | typeof ROUTER_EVENT_TAB_SELECTED
  | typeof ROUTER_EVENT_TAB_METRICS;

interface RouterEventsPayloadMap {
  [ROUTER_EVENT_STATE_CHANGED]: { state: NavigationState };
  [ROUTER_EVENT_TRANSITION_START]: { key: string; progress?: number };
  [ROUTER_EVENT_TRANSITION_END]: { key: string; finished: boolean };
  [ROUTER_EVENT_TRANSITION_PROGRESS]: { key: string; progress: number };
  [ROUTER_EVENT_FOCUS]: { key: string };
  [ROUTER_EVENT_BLUR]: { key: string };
  [ROUTER_EVENT_PREDICTIVE_BACK]: {
    key: string;
    progress: number;
    velocity?: number;
  };
  [ROUTER_EVENT_BACK]: { source?: string };
  [ROUTER_EVENT_BEFORE_REMOVE]: {
    key: string;
    action: RouterAction;
    requestId?: string;
    data?: Record<string, unknown>;
  };
  [ROUTER_EVENT_TAB_SELECTED]: {
    navigatorId: string;
    tabName: string;
  };
  [ROUTER_EVENT_TAB_METRICS]: {
    navigatorId: string;
    height: number;
    inset: number;
  };
}

export type RouterEventPayload<Name extends RouterEventName> =
  RouterEventsPayloadMap[Name];

export type RouterEventListener<Name extends RouterEventName> = (
  payload: RouterEventPayload<Name>
) => void;

const emitter = new NativeEventEmitter(ensureNativeEmitter());

export function addRouterEventListener<Name extends RouterEventName>(
  eventName: Name,
  listener: RouterEventListener<Name>
): () => void {
  const subscription = emitter.addListener(eventName, (payload) => {
    listener(payload as RouterEventPayload<Name>);
  });
  return () => subscription.remove();
}

export function emitRouterEvent<Name extends RouterEventName>(
  eventName: Name,
  payload: RouterEventPayload<Name>
): void {
  ensureNativeEmitter().emit(eventName, payload);
}
