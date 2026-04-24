import { platform } from "@zynthjs/apis";
import { NativeEventEmitter } from "@zynthjs/core";
import { createEffect, onCleanup, untrack, type Accessor } from "solid-js";

type ModulesBridge = {
  call(name: string, method: string, args?: any): any;
};

type BackHandlerEntry = {
  handler: () => boolean;
  canGoBack: Accessor<boolean>;
};

const BACK_PRESS_EVENT = "zynth.android.backPress";
const handlers: BackHandlerEntry[] = [];
let subscription: { remove(): void } | null = null;
let lastCanGoBack: boolean | null = null;

function getModulesBridge(): ModulesBridge | null {
  const globalObj = globalThis as Record<string, any>;
  const modules = globalObj.__modules;
  if (!modules || typeof modules.call !== "function") {
    return null;
  }
  return modules as ModulesBridge;
}

function setNativeCanGoBack(canGoBack: boolean) {
  const bridge = getModulesBridge();
  if (!bridge) return;
  bridge.call("BackHandler", "setCanGoBack", { canGoBack });
}

function updateNativeCanGoBack() {
  const next = untrack(() => handlers.some((entry) => entry.canGoBack()));
  if (next === lastCanGoBack) return;
  lastCanGoBack = next;
  setNativeCanGoBack(next);
}

function ensureSubscription() {
  if (platform.current !== "android") return;
  if (subscription) return;

  const emitter = new NativeEventEmitter();
  subscription = emitter.addListener(BACK_PRESS_EVENT, () => {
    for (let index = handlers.length - 1; index >= 0; index -= 1) {
      if (handlers[index]?.handler()) {
        return;
      }
    }
  });
}

export function registerAndroidBackHandler(
  canGoBack: Accessor<boolean>,
  onBack: () => void
) {
  if (platform.current !== "android") return;

  const entry: BackHandlerEntry = {
    canGoBack,
    handler: () => {
      if (!entry.canGoBack()) return false;
      onBack();
      return true;
    },
  };

  handlers.push(entry);
  ensureSubscription();
  updateNativeCanGoBack();

  createEffect(() => {
    canGoBack();
    updateNativeCanGoBack();
  });

  onCleanup(() => {
    const index = handlers.indexOf(entry);
    if (index >= 0) {
      handlers.splice(index, 1);
    }
    updateNativeCanGoBack();

    if (handlers.length === 0) {
      subscription?.remove();
      subscription = null;
      lastCanGoBack = null;
      setNativeCanGoBack(false);
    }
  });
}
