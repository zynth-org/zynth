import type { NavigationState, RouterAction } from "./types";

export type RouterDevtoolsEvent =
  | { type: "state"; state: NavigationState; timestamp: number }
  | { type: "action"; action: RouterAction; timestamp: number };

interface RouterDevtoolsBridge {
  emit(event: RouterDevtoolsEvent): void;
}

function getGlobalObject(): any {
  if (typeof globalThis !== "undefined") return globalThis;
  if (typeof window !== "undefined") return window;
  if (typeof global !== "undefined") return global;
  return {};
}

function getDevtoolsBridge(): RouterDevtoolsBridge | null {
  const g = getGlobalObject();
  return g.__RUNE_ROUTER_DEVTOOLS__ ?? null;
}

export function emitDevtoolsEvent(event: RouterDevtoolsEvent): void {
  getDevtoolsBridge()?.emit(event);
}
