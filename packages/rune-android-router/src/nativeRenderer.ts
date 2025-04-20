import { render } from "@rune/core";
import { createComponent } from "solid-js";
import {
  RouteProvider,
  createRouteContextValue,
  listRegisteredScreens,
} from "./context";
import type { RouteProp, ScreenDescriptor } from "./types";
import { getNativeRouterDispatch } from "./nativeInterop";

type ScreenInstance = {
  dispose: () => void;
};

const mountedScreens = new Map<number, ScreenInstance>();

const logPrefix = "[nativeRenderer]";

function resolveScreenDescriptor(
  screenName: string
): ScreenDescriptor | undefined {
  const screens = listRegisteredScreens() as ScreenDescriptor[];
  return screens.find((screen) => screen.name === screenName);
}

function disposeScreen(rootId: number) {
  const entry = mountedScreens.get(rootId);
  if (!entry) return;
  try {
    entry.dispose();
  } catch (error) {
    console.error(
      `${logPrefix} Failed to dispose screen for rootId=${rootId}`,
      error
    );
  } finally {
    mountedScreens.delete(rootId);
  }
}

function renderNativeScreen(rootId: number, screenName: string, params: any) {
  console.log(
    `${logPrefix} render request: rootId=${rootId}, screen=${screenName}, params=${JSON.stringify(
      params
    )}`
  );

  const descriptor = resolveScreenDescriptor(screenName);
  if (!descriptor) {
    console.error(
      `${logPrefix} No screen registered with name "${screenName}"`
    );
    return;
  }

  const dispatch = getNativeRouterDispatch();
  if (!dispatch) {
    console.error(
      `${logPrefix} Router dispatch not available. Is NavigationContainer mounted?`
    );
    return;
  }

  const resolvedParams =
    params ?? descriptor.initialParams ?? (undefined as unknown);

  const route: RouteProp = {
    key: `${screenName}-${rootId}-${Date.now().toString(36)}`,
    name: screenName,
    params: resolvedParams,
  };

  const routeContext = createRouteContextValue(route, dispatch);

  disposeScreen(rootId);

  const container = { id: rootId, type: "root" } as any;

  try {
    const tree = () =>
      createComponent(RouteProvider, {
        value: routeContext,
        get children() {
          return createComponent(descriptor.component, {});
        },
      });

    const dispose = render(tree, container) ?? (() => {});
    mountedScreens.set(rootId, { dispose });
    console.log(
      `${logPrefix} ✅ Rendered "${screenName}" into rootId=${rootId}`
    );
  } catch (error) {
    console.error(`${logPrefix} Failed to render "${screenName}"`, error);
    disposeScreen(rootId);
  }
}

function installNativeRenderer() {
  if (typeof globalThis === "undefined") {
    console.warn(`${logPrefix} globalThis unavailable; native renderer inert`);
    return;
  }

  const globalObject = globalThis as Record<string, unknown>;
  (globalObject as any).__renderRouterScreen = (
    rootId: number,
    screenName: string,
    params: any
  ) => renderNativeScreen(rootId, screenName, params);

  (globalObject as any).__disposeRouterScreen = (rootId: number) =>
    disposeScreen(rootId);

  console.log(`${logPrefix} ✅ __renderRouterScreen installed`);
}

installNativeRenderer();
