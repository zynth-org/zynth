import type {
  NavigationState,
  RouterAction,
  ScreenDescriptor,
  ScreenOptions,
  TabIconDescriptor,
} from "./types";
import type {
  RouterEventListener,
  RouterEventName,
} from "./events";
import { addRouterEventListener } from "./events";

export interface NativeRouterBridge {
  getState(): NavigationState | null;
  dispatch(action: RouterAction): void;
  setOptions(key: string, options: ScreenOptions): void;
  registerScreens?(screens: RegisteredScreenSummary[]): void;
  addListener?<Name extends RouterEventName>(
    eventName: Name,
    listener: RouterEventListener<Name>
  ): () => void;
  resolveBeforeRemove?(requestId: string, cancelled: boolean): void;
  configureTabs?(routeKey: string, config: NativeTabBarConfig): void;
  removeTabs?(routeKey: string): void;
  selectTab?(routeKey: string, tabName: string): void;
}

export interface RegisteredScreenSummary {
  name: string;
  navigatorId: string;
  type: "stack" | "tab";
  memoryPolicy?: ScreenDescriptor["memoryPolicy"];
}

export interface NativeTabBarItem {
  key?: string;
  name: string;
  label?: string;
  badge?: string | number;
  badgeColor?: string;
  activeTintColor?: string;
  inactiveTintColor?: string;
  backgroundColor?: string;
  icon?: TabIconDescriptor;
}

export interface NativeTabBarConfig {
  navigatorId: string;
  initialRouteName?: string;
  tabs: NativeTabBarItem[];
}

declare global {
  interface Window {
    __RUNE_ROUTER__?: NativeRouterBridge;
  }
  interface Global {
    __RUNE_ROUTER__?: NativeRouterBridge;
  }
}

const descriptorRegistry = new Map<string, ScreenDescriptor>();
let summaries: RegisteredScreenSummary[] = [];

const noop = () => {};

const fallbackBridge: NativeRouterBridge = {
  getState() {
    return null;
  },
  dispatch(action) {
    if (process.env.NODE_ENV !== "production") {
      console.warn(
        `[RuneRouter] Native bridge not installed. Ignoring action ${action.type}.`
      );
    }
  },
  setOptions(key) {
    if (process.env.NODE_ENV !== "production") {
      console.warn(
        `[RuneRouter] Cannot set options for ${key} because native bridge is missing.`
      );
    }
  },
  registerScreens() {
    /* no-op in dev fallback */
  },
  addListener(eventName, listener) {
    return addRouterEventListener(eventName, listener as any);
  },
  resolveBeforeRemove(requestId, cancelled) {
    if (process.env.NODE_ENV !== "production") {
      console.warn(
        `[RuneRouter] Received beforeRemove request (${requestId}) but no native bridge is installed; result=${cancelled}`
      );
    }
  },
  configureTabs(_, config) {
    if (process.env.NODE_ENV !== "production") {
      console.warn(
        "[RuneRouter] Cannot configure tabs because native bridge is missing.",
        config
      );
    }
  },
  removeTabs() {
    /* no-op */
  },
  selectTab() {
    /* no-op */
  },
};

function getGlobalObject(): any {
  if (typeof globalThis !== "undefined") return globalThis;
  if (typeof window !== "undefined") return window;
  if (typeof global !== "undefined") return global;
  return {};
}

let cachedBridge: NativeRouterBridge | null = null;

export function getNativeRouterBridge(): NativeRouterBridge {
  if (cachedBridge) {
    return cachedBridge;
  }

  const globalObject = getGlobalObject();
  const bridge: NativeRouterBridge | undefined =
    globalObject.__RUNE_ROUTER__ ??
    installModuleBackedRouterBridge(globalObject) ??
    undefined;

  cachedBridge = bridge ?? fallbackBridge;
  return cachedBridge;
}

function installModuleBackedRouterBridge(
  globalObject: any
): NativeRouterBridge | undefined {
  const modules = globalObject.__modules;
  if (!modules || typeof modules.call !== "function") {
    return undefined;
  }

  const moduleName = "RuneRouter";
  const call = modules.call.bind(modules) as (
    name: string,
    method: string,
    payload?: any
  ) => any;
  const callSync =
    typeof modules.callSync === "function"
      ? (modules.callSync.bind(modules) as (
          name: string,
          method: string,
          payload?: any
        ) => any)
      : null;

  const bridge: NativeRouterBridge = {
    getState() {
      const result = callSync
        ? callSync(moduleName, "getState")
        : call(moduleName, "getState");
      return extractStateFromResult(result);
    },
    dispatch(action) {
      call(moduleName, "dispatch", { action });
    },
    setOptions(key, options) {
      call(moduleName, "setOptions", { key, options });
    },
    registerScreens(screens) {
      call(moduleName, "registerScreens", { screens });
    },
    resolveBeforeRemove(requestId, cancelled) {
      call(moduleName, "resolveBeforeRemove", { requestId, cancelled });
    },
    configureTabs(routeKey, config) {
      call(moduleName, "configureTabs", { routeKey, config });
    },
    removeTabs(routeKey) {
      call(moduleName, "removeTabs", { routeKey });
    },
    selectTab(routeKey, tabName) {
      call(moduleName, "selectTab", { routeKey, tabName });
    },
  };

  Object.defineProperty(globalObject, "__RUNE_ROUTER__", {
    configurable: true,
    enumerable: false,
    writable: false,
    value: bridge,
  });

  return bridge;
}

function extractStateFromResult(result: any): NavigationState | null {
  if (!result) {
    return null;
  }
  if (typeof result === "object") {
    if ("state" in result && result.state) {
      return result.state as NavigationState;
    }
    if ("result" in result && result.result?.state) {
      return result.result.state as NavigationState;
    }
  }
  return null;
}

function syncRegisteredScreens(): void {
  const bridge = getNativeRouterBridge();
  summaries = Array.from(descriptorRegistry.values()).map((descriptor) => ({
    name: descriptor.name,
    navigatorId: descriptor.navigatorId,
    type: descriptor.type,
    memoryPolicy: descriptor.memoryPolicy,
  }));

  if (typeof bridge.registerScreens === "function") {
    bridge.registerScreens(summaries);
  }
}

export function registerScreenDescriptor(
  descriptor: ScreenDescriptor
): () => void {
  descriptorRegistry.set(descriptor.name, descriptor);
  syncRegisteredScreens();
  return () => {
    descriptorRegistry.delete(descriptor.name);
    syncRegisteredScreens();
  };
}

export function resolveScreenDescriptor(
  name: string
): ScreenDescriptor | undefined {
  return descriptorRegistry.get(name);
}

export function listRegisteredScreens(): RegisteredScreenSummary[] {
  return summaries.slice();
}

export function dispatchNavigationAction(action: RouterAction): void {
  getNativeRouterBridge().dispatch(action);
}

export function setNativeScreenOptions(
  key: string,
  options: ScreenOptions
): void {
  getNativeRouterBridge().setOptions(key, options);
}

export function setNativeTabs(
  routeKey: string,
  config: NativeTabBarConfig
): void {
  const bridge = getNativeRouterBridge();
  if (typeof bridge.configureTabs === "function") {
    bridge.configureTabs(routeKey, config);
  }
}

export function removeNativeTabs(routeKey: string): void {
  const bridge = getNativeRouterBridge();
  if (typeof bridge.removeTabs === "function") {
    bridge.removeTabs(routeKey);
  }
}

export function selectNativeTab(routeKey: string, tabName: string): void {
  const bridge = getNativeRouterBridge();
  if (typeof bridge.selectTab === "function") {
    bridge.selectTab(routeKey, tabName);
  }
}

export function subscribeToNativeRouterEvent<Name extends RouterEventName>(
  eventName: Name,
  listener: RouterEventListener<Name>
): () => void {
  const bridge = getNativeRouterBridge();
  if (typeof bridge.addListener === "function") {
    return bridge.addListener(eventName, listener);
  }
  return addRouterEventListener(eventName, listener);
}

export function resolveBeforeRemoveRequest(
  requestId: string,
  cancelled: boolean
): void {
  const bridge = getNativeRouterBridge();
  if (typeof bridge.resolveBeforeRemove === "function") {
    bridge.resolveBeforeRemove(requestId, cancelled);
  }
}
