import {
  ROUTER_EVENT_BACK,
  addRouterEventListener,
} from "../core/events";

export type BackHandler = () => boolean | void;

const handlers: BackHandler[] = [];
let subscribed = false;

function ensureSubscription(): void {
  if (subscribed) {
    return;
  }
  subscribed = true;
  addRouterEventListener(ROUTER_EVENT_BACK, () => {
    for (let i = handlers.length - 1; i >= 0; i -= 1) {
      const handled = handlers[i]?.();
      if (handled) {
        return;
      }
    }
  });
}

export function addBackHandler(handler: BackHandler): () => void {
  ensureSubscription();
  handlers.push(handler);
  return () => {
    const index = handlers.indexOf(handler);
    if (index >= 0) {
      handlers.splice(index, 1);
    }
  };
}
