import type { ScreenOptions, TabBarOptions, TabOptions } from "./types";

const MODULE_NAME = "RuneAndroidRouter";

interface ModulesBridge {
  call(moduleName: string, method: string, payload?: any): Promise<any>;
}

function getModulesBridge(): ModulesBridge | null {
  const globalObj = globalThis as Record<string, any>;
  const modules = globalObj.__modules;
  if (!modules || typeof modules.call !== "function") {
    const isDevEnvironment =
      ((globalThis as any)?.process?.env?.NODE_ENV ?? "development") !==
      "production";
    if (isDevEnvironment) {
      console.warn("[RuneAndroidRouter] __modules bridge not available");
    }
    return null;
  }
  return modules as ModulesBridge;
}

async function callNative<T = any>(
  method: string,
  payload?: Record<string, any>
): Promise<T | null> {
  const modules = getModulesBridge();
  if (!modules) {
    return null;
  }
  try {
    return await modules.call(MODULE_NAME, method, payload ?? {});
  } catch (error) {
    console.error(`[RuneAndroidRouter] ${method} failed`, error);
    return null;
  }
}

export interface NativeScreenRegistration {
  name: string;
  options?: ScreenOptions;
}

export interface NativeTabDefinition {
  name: string;
  options?: ScreenOptions;
  tab?: TabOptions;
}

export interface RegisterTabsPayload {
  navigatorId?: string;
  initialRouteName?: string;
  tabBarOptions?: TabBarOptions;
  tabs: NativeTabDefinition[];
}

export function registerScreensNative(screens: NativeScreenRegistration[]) {
  return callNative("registerScreens", { screens });
}

export function resetStackNative(initialRouteName?: string) {
  return callNative("reset", { initialRouteName });
}

export function navigateNative(name: string, params?: any) {
  return callNative("navigate", { name, params: params ?? null });
}

export function goBackNative() {
  return callNative("goBack");
}

export function setOptionsNative(options: ScreenOptions, routeName?: string) {
  return callNative("setOptions", { routeName, options });
}

export function registerTabsNative(payload: RegisterTabsPayload) {
  return callNative("registerTabs", payload);
}

export function switchTabNative(name: string) {
  return callNative("switchTab", { name });
}

export function setTabOptionsNative(name: string, options?: TabOptions) {
  return callNative("setTabOptions", { name, options });
}

export function notifyScreenRenderedNative(rootId: number) {
  return callNative("screenRendered", { rootId });
}
