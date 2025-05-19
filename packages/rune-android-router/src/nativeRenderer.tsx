import {
  getHost,
  render,
  setActiveSurface,
  getActiveSurface,
} from "@rune/core";
import type { HostNode } from "@rune/core";
import { Dimensions } from "@rune/apis";
import { SafeAreaProvider } from "@rune/safe-area";
import type { InitialWindowMetrics } from "@rune/safe-area";
import { findScreenDefinition } from "./registry";
import type { RouterScreenComponentProps, ScreenOptions } from "./types";
import {
  goBackNative,
  navigateNative,
  notifyScreenRenderedNative,
  setOptionsNative,
} from "./nativeBridge";

const mountedScreens = new Map<number, () => void>();

function parseParams(raw: unknown): any {
  if (raw == null) {
    return undefined;
  }
  if (typeof raw === "string") {
    if (raw === "null") return undefined;
    try {
      return JSON.parse(raw);
    } catch (error) {
      console.warn("[RuneAndroidRouter] Failed to parse params", error);
      return undefined;
    }
  }
  return raw;
}

function createNavigationHelpers(routeName: string) {
  return {
    navigate: (name: string, params?: any) => navigateNative(name, params),
    push: (name: string, params?: any) => navigateNative(name, params),
    goBack: () => goBackNative(),
    setOptions: (options: ScreenOptions) =>
      setOptionsNative(options, routeName),
  };
}

function createSurfaceContainer(rootId: number): HostNode {
  return { id: rootId, type: "root" };
}

function renderScreen(rootId: number, routeName: string, paramsJson?: any) {
  console.log(
    "[RuneAndroidRouter/nativeRenderer] renderScreen",
    rootId,
    routeName,
    paramsJson
  );
  const definition = findScreenDefinition(routeName);
  if (!definition) {
    console.warn(`[RuneAndroidRouter] Screen ${routeName} is not registered.`);
    return false;
  }

  const params = parseParams(paramsJson);
  const navigation = createNavigationHelpers(routeName);
  const props: RouterScreenComponentProps<any> = {
    route: {
      key: routeName,
      name: routeName,
      params,
    },
    navigation,
  };

  const disposePrevious = mountedScreens.get(rootId);
  if (disposePrevious) {
    try {
      disposePrevious();
    } catch (error) {
      console.error(
        "[RuneAndroidRouter] Failed to dispose previous screen",
        error
      );
    }
  }

  const previousSurface = getActiveSurface();
  setActiveSurface(rootId);
  const dispose = render(() => {
    console.log(
      "[RuneAndroidRouter/nativeRenderer] invoking component",
      routeName
    );
    try {
      const componentElement = definition.component(props);
      const element =
        definition.surface === "bottomSheet" ? (
          <SafeAreaProvider initialMetrics={createZeroedWindowMetrics()}>
            {componentElement}
          </SafeAreaProvider>
        ) : (
          componentElement
        );
      console.log(
        "[RuneAndroidRouter/nativeRenderer] component rendered",
        routeName,
        Boolean(element)
      );
      return element;
    } catch (error) {
      console.error(
        "[RuneAndroidRouter/nativeRenderer] component threw",
        routeName,
        JSON.stringify(error)
      );
      throw error;
    }
  }, createSurfaceContainer(rootId));

  flushHostQueue();
  void notifyScreenRenderedNative(rootId);
  mountedScreens.set(rootId, () => {
    console.log(
      "[RuneAndroidRouter/nativeRenderer] disposing previous render for",
      rootId
    );
    setActiveSurface(rootId);
    dispose();
    flushHostQueue();
    setActiveSurface(previousSurface);
  });
  flushHostQueue();
  setActiveSurface(previousSurface);
  return true;
}

function disposeScreen(rootId: number) {
  const dispose = mountedScreens.get(rootId);
  if (!dispose) {
    return;
  }
  mountedScreens.delete(rootId);
  try {
    setActiveSurface(rootId);
    dispose();
    flushHostQueue();
  } catch (error) {
    console.error("[RuneAndroidRouter] disposeScreen failed", error);
  }
}

function getScreenOptions(name: string): ScreenOptions | null {
  return findScreenDefinition(name)?.options ?? null;
}

function installRenderer() {
  const globalObj = globalThis as Record<string, any>;
  if (typeof globalObj.__renderRouterScreen === "function") {
    return;
  }
  Object.defineProperties(globalObj, {
    __renderRouterScreen: {
      value: renderScreen,
      enumerable: false,
      configurable: false,
      writable: false,
    },
    __disposeRouterScreen: {
      value: disposeScreen,
      enumerable: false,
      configurable: false,
      writable: false,
    },
    __getRouterScreenOptions: {
      value: getScreenOptions,
      enumerable: false,
      configurable: false,
      writable: false,
    },
  });
  console.log("[RuneAndroidRouter] Native router renderer installed");
}

installRenderer();

function flushHostQueue() {
  const host = getHost();
  if (host && typeof host.flush === "function") {
    host.flush();
    return;
  }
  const ui = (globalThis as Record<string, any>).__ui;
  if (ui && typeof ui.flush === "function") {
    ui.flush();
  }
}

function createZeroedWindowMetrics(): InitialWindowMetrics {
  const window = Dimensions.get("window");
  return {
    insets: { top: 0, right: 0, bottom: 0, left: 0 },
    frame: {
      x: 0,
      y: 0,
      width: window.width,
      height: window.height,
    },
  };
}
