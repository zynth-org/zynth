import { Platform, OS } from "@rune/apis";
import { createMemo } from "solid-js";
import { createSafeAreaInsets } from "@rune/safe-area";
import type { JSX } from "solid-js";
import * as IOS from "./platform/ios";
import * as Android from "./platform/android";
import type { HeaderMetrics } from "./platform/ios/integration/insets";
import type { TabBarMetrics } from "./platform/ios/core/types";

type RouterRuntime = {
  NavigationContainer: typeof IOS.NavigationContainer;
  Stack: typeof IOS.Stack;
  Tabs: typeof IOS.Tabs;
  useFocusEffect: typeof IOS.useFocusEffect;
  useBeforeRemove: typeof IOS.useBeforeRemove;
  useNavigationEvents: typeof IOS.useNavigationEvents;
  useNavigation: typeof IOS.useNavigation;
  useRoute: typeof IOS.useRoute;
  RouteProvider: typeof IOS.RouteProvider;
  createRouteContextValue: typeof IOS.createRouteContextValue;
  addBackHandler: typeof IOS.addBackHandler;
  useHeaderMetrics: typeof IOS.useHeaderMetrics;
  createTabBarMetrics: typeof IOS.createTabBarMetrics;
  handleLink: typeof IOS.handleLink;
  getPathFromState: typeof IOS.getPathFromState;
  createRouter: typeof IOS.createRouter;
};
const isAndroid = Platform.OS === OS.ANDROID;
const runtime: RouterRuntime = isAndroid ? createAndroidAdapter() : IOS;

export const NavigationContainer = runtime.NavigationContainer;
export const Stack = runtime.Stack;
export const Tabs = runtime.Tabs;
export const useFocusEffect = runtime.useFocusEffect;
export const useBeforeRemove = runtime.useBeforeRemove;
export const useNavigationEvents = runtime.useNavigationEvents;
export const useNavigation = runtime.useNavigation;
export const useRoute = runtime.useRoute;
export const RouteProvider = runtime.RouteProvider;
export const createRouteContextValue = runtime.createRouteContextValue;
export const addBackHandler = runtime.addBackHandler;
export const useHeaderMetrics = runtime.useHeaderMetrics;
export const createTabBarMetrics = runtime.createTabBarMetrics;
export const handleLink = runtime.handleLink;
export const getPathFromState = runtime.getPathFromState;
export const createRouter = runtime.createRouter;

export { createTabGlyphIcon, createTabIcon } from "./platform/ios/tabs/createTabIcon";
export {
  TABS_ROOT_NAVIGATOR_ID,
  TABS_ROOT_ROUTE_KEY,
} from "./platform/ios/core/types";
export type {
  RouteParamList,
  RouteProp,
  NavigationHelpers,
  NavigationState,
  ScreenOptions,
  StackScreenProps,
  TabScreenProps,
  TabsRootNavigatorId,
  TabBarMetrics,
} from "./platform/ios/core/types";

function createAndroidAdapter(): RouterRuntime {
  const TabsImpl =
    typeof Android.createBottomTabs === "function"
      ? Android.createBottomTabs()
      : createUnsupportedComponent("Tabs");

  return {
    NavigationContainer: Android.NavigationContainer,
    Stack: Android.Stack as unknown as RouterRuntime["Stack"],
    Tabs: TabsImpl as RouterRuntime["Tabs"],
    useFocusEffect: createUnsupportedHook("useFocusEffect"),
    useBeforeRemove: createUnsupportedHook("useBeforeRemove"),
    useNavigationEvents: createUnsupportedHook("useNavigationEvents"),
    useNavigation: Android.useNavigation as RouterRuntime["useNavigation"],
    useRoute: createUnsupportedHook("useRoute"),
    RouteProvider: createPassThroughProvider(),
    createRouteContextValue: createAndroidRouteContextValue(),
    addBackHandler: createAndroidBackHandler(),
    useHeaderMetrics: createAndroidHeaderMetricsHook(),
    createTabBarMetrics: createAndroidTabBarMetricsFactory(),
    handleLink: createAndroidHandleLink(),
    getPathFromState: createAndroidGetPathFromState(),
    createRouter: Android.createRouter as unknown as RouterRuntime["createRouter"],
  };
}

function createUnsupportedHook<K extends keyof RouterRuntime>(
  name: K,
  returnValue?: RouterRuntime[K]
): RouterRuntime[K] {
  return ((..._args: any[]) => {
    console.warn(`[RuneRouter] ${String(name)} is not implemented on Android yet.`);
    return returnValue;
  }) as RouterRuntime[K];
}

function createUnsupportedComponent<K extends keyof RouterRuntime>(
  name: K
): RouterRuntime[K] {
  return ((props: { children?: JSX.Element }) => {
    console.warn(`[RuneRouter] ${String(name)} is not implemented on Android yet.`);
    return props.children ?? null;
  }) as RouterRuntime[K];
}

function createPassThroughProvider(): RouterRuntime["RouteProvider"] {
  return ((props) => props.children) as RouterRuntime["RouteProvider"];
}

function createAndroidRouteContextValue(): RouterRuntime["createRouteContextValue"] {
  return ((route: { key: string; name: string; params?: Record<string, unknown> }) => {
    const params = () => (route.params as Record<string, unknown> | undefined) as any;
    return {
      key: route.key,
      name: route.name as any,
      params,
      setParams(next: Record<string, unknown>) {
        console.warn("[RuneRouter] setParams is not implemented on Android yet.", next);
      },
      __updateFromState() {
        /* no-op */
      },
    };
  }) as RouterRuntime["createRouteContextValue"];
}

function createAndroidHandleLink(): RouterRuntime["handleLink"] {
  return ((url: string) => {
    console.warn(`[RuneRouter] handleLink is not implemented on Android yet. Ignoring ${url}.`);
    return false;
  }) as RouterRuntime["handleLink"];
}

function createAndroidGetPathFromState(): RouterRuntime["getPathFromState"] {
  return ((state: unknown) => {
    console.warn("[RuneRouter] getPathFromState is not implemented on Android yet.", state);
    return "";
  }) as RouterRuntime["getPathFromState"];
}

function createAndroidBackHandler(): RouterRuntime["addBackHandler"] {
  const handlers: Array<() => boolean | void> = [];
  let unsubscribeNative: (() => void) | null = null;

  const ensureSubscription = () => {
    if (unsubscribeNative || typeof Android.onBackPress !== "function") {
      return;
    }
    unsubscribeNative = Android.onBackPress(() => {
      for (let index = handlers.length - 1; index >= 0; index -= 1) {
        try {
          if (handlers[index]?.()) {
            return;
          }
        } catch (error) {
          console.error("[RuneRouter] back handler threw", error);
        }
      }
    });
  };

  return (handler) => {
    handlers.push(handler);
    ensureSubscription();
    return () => {
      const position = handlers.indexOf(handler);
      if (position >= 0) {
        handlers.splice(position, 1);
      }
      if (handlers.length === 0) {
        unsubscribeNative?.();
        unsubscribeNative = null;
      }
    };
  };
}

function createAndroidHeaderMetricsHook(): RouterRuntime["useHeaderMetrics"] {
  const ANDROID_HEADER_HEIGHT = 56;
  return (extraHeight = 0) =>
    createMemo<HeaderMetrics>(() => {
      const inset = createSafeAreaInsets().top;
      return {
        inset,
        height: ANDROID_HEADER_HEIGHT + inset + extraHeight,
      };
    });
}

function createAndroidTabBarMetricsFactory(): RouterRuntime["createTabBarMetrics"] {
  const ANDROID_TABBAR_HEIGHT = 56;
  return (extraHeight = 0) =>
    createMemo<TabBarMetrics>(() => {
      const inset = createSafeAreaInsets().bottom;
      return {
        inset,
        height: ANDROID_TABBAR_HEIGHT + inset + extraHeight,
      };
    });
}
