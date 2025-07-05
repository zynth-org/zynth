import { NativeEventEmitter } from "@rune/core";
import type { NavigationState } from "../ios/core/types";

const emitter = new NativeEventEmitter();

export const STACK_CHANGED_EVENT = "rune.androidRouter.stackChanged";
export const BACK_PRESS_EVENT = "rune.androidRouter.backPress";
export const ROUTER_EVENT_STATE_CHANGED = "rune.router.stateChanged";
export const ROUTER_EVENT_BEFORE_REMOVE = "rune.router.beforeRemove";
export const ROUTER_EVENT_TRANSITION_START = "rune.router.transitionStart";
export const ROUTER_EVENT_TRANSITION_END = "rune.router.transitionEnd";
export const ROUTER_EVENT_TRANSITION_PROGRESS = "rune.router.transitionProgress";
export const NATIVE_RESTART_EVENT = "rune.androidRouter.nativeRestart";

export interface StackChangedPayload {
  routes: string[];
  stackLength: number;
  canGoBack: boolean;
  reason?: string;
}

export interface BackPressPayload {
  source: string;
  handled: boolean;
}

export interface RouterStateChangedPayload {
  state: NavigationState;
}

export interface BeforeRemovePayload {
  key: string;
  action: {
    type: string;
    payload?: Record<string, any>;
    source?: string;
  };
  requestId: string;
}

export interface TransitionStartPayload {
  key: string;
  progress?: number;
}

export interface TransitionEndPayload {
  key: string;
  finished: boolean;
}

export interface TransitionProgressPayload {
  key: string;
  progress: number;
}

export function onStackChanged(handler: (payload: StackChangedPayload) => void) {
  const subscription = emitter.addListener(STACK_CHANGED_EVENT, handler as any);
  return () => subscription.remove();
}

export function onBackPress(handler: (payload: BackPressPayload) => void) {
  const subscription = emitter.addListener(BACK_PRESS_EVENT, handler as any);
  return () => subscription.remove();
}

export function onRouterStateChanged(handler: (payload: RouterStateChangedPayload) => void) {
  const subscription = emitter.addListener(ROUTER_EVENT_STATE_CHANGED, handler as any);
  return () => subscription.remove();
}

export function onBeforeRemove(handler: (payload: BeforeRemovePayload) => void) {
  const subscription = emitter.addListener(ROUTER_EVENT_BEFORE_REMOVE, handler as any);
  return () => subscription.remove();
}

export function onTransitionStart(handler: (payload: TransitionStartPayload) => void) {
  const subscription = emitter.addListener(ROUTER_EVENT_TRANSITION_START, handler as any);
  return () => subscription.remove();
}

export function onTransitionEnd(handler: (payload: TransitionEndPayload) => void) {
  const subscription = emitter.addListener(ROUTER_EVENT_TRANSITION_END, handler as any);
  return () => subscription.remove();
}

export function onTransitionProgress(handler: (payload: TransitionProgressPayload) => void) {
  const subscription = emitter.addListener(ROUTER_EVENT_TRANSITION_PROGRESS, handler as any);
  return () => subscription.remove();
}

export function onNativeRestart(handler: () => void) {
  const subscription = emitter.addListener(NATIVE_RESTART_EVENT, handler as any);
  return () => subscription.remove();
}
