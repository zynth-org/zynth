import { NativeEventEmitter } from "@rune/core";

const emitter = new NativeEventEmitter();

export const STACK_CHANGED_EVENT = "rune.androidRouter.stackChanged";
export const BACK_PRESS_EVENT = "rune.androidRouter.backPress";

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

export function onStackChanged(handler: (payload: StackChangedPayload) => void) {
  const subscription = emitter.addListener(STACK_CHANGED_EVENT, handler as any);
  return () => subscription.remove();
}

export function onBackPress(handler: (payload: BackPressPayload) => void) {
  const subscription = emitter.addListener(BACK_PRESS_EVENT, handler as any);
  return () => subscription.remove();
}
