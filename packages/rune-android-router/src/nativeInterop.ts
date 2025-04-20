import type { RouterAction } from "./types";

let dispatchRef: ((action: RouterAction) => void) | null = null;

export function setNativeRouterDispatch(
  dispatch: ((action: RouterAction) => void) | null
) {
  dispatchRef = dispatch;
}

export function getNativeRouterDispatch() {
  return dispatchRef;
}
