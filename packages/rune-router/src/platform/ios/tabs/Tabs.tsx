import { View } from "@rune/components";
import type { Style } from "@rune/core";
import {
  type Accessor,
  type JSX,
  ParentComponent,
  Show,
  For,
  createContext,
  createEffect,
  createMemo,
  createRoot,
  createSignal,
  createUniqueId,
  onCleanup,
  untrack,
  useContext,
} from "solid-js";
import { Platform, OS } from "@rune/apis";
import { TABS_ROOT_NAVIGATOR_ID, TABS_ROOT_ROUTE_KEY } from "../core/types";
import type {
  RouteContextValueInternal,
  RouterAction,
  ScreenOptions,
  ScreenDescriptor,
  TabIconDescriptor,
  TabsComponentType,
  TabsProps,
} from "../core/types";
import { TabScreen } from "./TabScreen";
import { TabBar } from "./TabBar";
import {
  RouteProvider,
  RouteContext,
  createRouteContextValue,
  useRouterContext,
} from "../core/RouterContext";
import { registerTabIcon, getTabIconFactory } from "./tabIconRegistry";
import {
  updateTabIconActiveState,
  removeTabIconState,
} from "./tabIconRenderer";
import {
  resolveScreenDescriptor,
  removeNativeTabs,
  selectNativeTab,
  setNativeTabs,
  subscribeToNativeRouterEvent,
} from "../core/actions";
import {
  ROUTER_EVENT_TAB_SELECTED,
  type RouterEventPayload,
} from "../core/events";

interface TabsContextValue {
  id: string;
  lazy?: boolean;
  registerScreen: (name: string) => () => void;
  routes: Accessor<TabRouteRecord[]>;
  activeRoute: Accessor<TabRouteRecord | null>;
  setActiveRoute: (routeName: string) => void;
}

const TabsContext = createContext<TabsContextValue>();

export function useTabsId(): string {
  const ctx = useContext(TabsContext);
  if (!ctx) {
    throw new Error("Tabs components must be rendered inside <Tabs>");
  }
  return ctx.id;
}

export function useTabsContext(): TabsContextValue {
  const ctx = useContext(TabsContext);
  if (!ctx) {
    throw new Error("Tabs components must be rendered inside <Tabs>");
  }
  return ctx;
}

const TabsBase: ParentComponent<TabsProps> = (props) => {
  const parentRoute = useContext(RouteContext);
  const isRootTabs = !parentRoute;
  const tabsId =
    props.id ??
    (isRootTabs ? TABS_ROOT_NAVIGATOR_ID : `tabs-${createUniqueId()}`);
  const router = useRouterContext();
  const hostRouteKey = parentRoute?.key ?? TABS_ROOT_ROUTE_KEY;

  const [registeredNames, setRegisteredNames] = createSignal<string[]>([]);
  const [activeKey, setActiveKey] = createSignal<string | null>(null);
  const [lastNativeConfig, setLastNativeConfig] = createSignal<string | null>(
    null
  );
  let lastSelectedRouteName: string | null = props.initialRouteName ?? null;

  const registerScreen = (name: string) => {
    setRegisteredNames((prev) => {
      if (prev.includes(name)) {
        return prev;
      }
      return [...prev, name];
    });
    return () => {
      setRegisteredNames((prev) => prev.filter((value) => value !== name));
    };
  };

  const routes = createMemo<TabRouteRecord[]>((prev = []) => {
    const names = registeredNames();
    return buildRouteRecords(names, prev);
  });

  const activeRoute = () => {
    const key = activeKey();
    if (!key) return null;
    return routes().find((route) => route.key === key) ?? null;
  };

  const updateActiveRoute = (
    route: TabRouteRecord | undefined,
    fromNative = false
  ) => {
    if (!route) {
      return;
    }
    const alreadyActive = activeKey() === route.key;
    if (!alreadyActive) {
      setActiveKey(route.key);
    }
    lastSelectedRouteName = route.name;

    const list = routes();
    list.forEach((r, index) => {
      if (r.tabOptions?.icon) {
        const iconId = `${tabsId}:${index}:${r.name}`;
        // console.log(`[Tabs] Updating icon ${iconId} active=${r.key === route.key}`);
        updateTabIconActiveState(iconId, r.key === route.key);
      }
    });

    if (!fromNative) {
      selectNativeTab(hostRouteKey, route.name);
    }
  };

  const handleSelectRoute = (routeName: string) => {
    const target = routes().find((route) => route.name === routeName);
    updateActiveRoute(target);
  };

  createEffect(() => {
    if (untrack(activeKey)) return;
    const list = routes();
    if (!list.length) return;

    const nextKey = pickActiveKey(null, list, props.initialRouteName);
    if (nextKey) {
      const route = list.find((r) => r.key === nextKey);
      updateActiveRoute(route);
    }
  });

  const iconDisposers = new Map<string, () => void>();

  createEffect(() => {
    const list = routes();
    const activeIds = new Set<string>();

    list.forEach((route, index) => {
      const icon = route.tabOptions?.icon;
      if (typeof icon === "function") {
        if (!supportsNativeTabIconSurfaces()) return;

        const iconId = `${tabsId}:${index}:${route.name}`;
        activeIds.add(iconId);

        const currentFactory = getTabIconFactory(iconId);
        if (currentFactory !== icon) {
          if (iconDisposers.has(iconId)) {
            iconDisposers.get(iconId)!();
          }
          const unregister = registerTabIcon(iconId, icon);
          iconDisposers.set(iconId, () => {
            unregister();
            removeTabIconState(iconId);
          });
        } else {
          // console.log(`[Tabs] Icon factory matches for ${iconId}`);
        }
      }
    });

    for (const [id, dispose] of iconDisposers) {
      if (!activeIds.has(id)) {
        dispose();
        iconDisposers.delete(id);
      }
    }
  });

  createEffect(() => {
    const list = routes();
    if (!list.length) {
      removeNativeTabs(hostRouteKey);
      return;
    }

    const initialName =
      lastSelectedRouteName ?? props.initialRouteName ?? list[0].name;

    const nativeConfig = {
      navigatorId: tabsId,
      initialRouteName: initialName,
      tabs: list.map((route, index) => {
        let iconDescriptor: TabIconDescriptor | undefined;
        const icon = route.tabOptions?.icon;

        if (typeof icon === "function") {
          if (supportsNativeTabIconSurfaces()) {
            iconDescriptor = { runeId: `${tabsId}:${index}:${route.name}` };
          }
        } else if (icon) {
          iconDescriptor = { ...icon };
        }

        return {
          key: route.key,
          name: route.name,
          label: route.tabOptions?.label ?? route.name,
          badge: route.tabOptions?.badge,
          badgeColor: route.tabOptions?.badgeColor,
          activeTintColor: route.tabOptions?.activeTintColor,
          inactiveTintColor: route.tabOptions?.inactiveTintColor,
          icon: iconDescriptor,
          backgroundColor: route.tabOptions?.tabBarBackgroundColor,
        };
      }),
    };

    const serialized = JSON.stringify(nativeConfig);
    if (serialized !== lastNativeConfig()) {
      setNativeTabs(hostRouteKey, nativeConfig);
      setLastNativeConfig(serialized);
    }
  });

  createEffect(() => {
    const unsubscribe = subscribeToNativeRouterEvent(
      ROUTER_EVENT_TAB_SELECTED,
      (payload: RouterEventPayload<typeof ROUTER_EVENT_TAB_SELECTED>) => {
        if (payload.navigatorId !== tabsId) {
          return;
        }
        const target = routes().find((route) => route.name === payload.tabName);
        updateActiveRoute(target, true);
      }
    );
    onCleanup(unsubscribe);
  });

  onCleanup(() => {
    iconDisposers.forEach((dispose) => dispose());
    iconDisposers.clear();
    removeNativeTabs(hostRouteKey);
  });

  return (
    <TabsContext.Provider
      value={{
        id: tabsId,
        lazy: props.lazy,
        registerScreen,
        routes,
        activeRoute,
        setActiveRoute: handleSelectRoute,
      }}
    >
      <TabsRenderer routes={routes} activeRoute={activeRoute} />
      <TabBar />
      {props.children}
    </TabsContext.Provider>
  );
};

export const Tabs = Object.assign(TabsBase, {
  Screen: TabScreen,
  TabBar,
}) as TabsComponentType;

const TabsRenderer: ParentComponent<{
  routes: Accessor<TabRouteRecord[]>;
  activeRoute: Accessor<TabRouteRecord | null>;
}> = (props) => {
  const router = useRouterContext();
  const [visited, setVisited] = createSignal<string[]>([]);

  createEffect(() => {
    const current = props.activeRoute();
    if (current) {
      setVisited((prev) => {
        if (prev.includes(current.key)) return prev;
        return [...prev, current.key];
      });
    }
  });

  return (
    <View style={{ flex: 1, width: "100%", height: "100%" }}>
      <For each={visited()}>
        {(key) => {
          const route = () => props.routes().find((r) => r.key === key);
          const isActive = () => props.activeRoute()?.key === key;

          return (
            <Show when={route()}>
              {(validRoute) => (
                <KeepAliveScene
                  route={validRoute()}
                  isActive={isActive()}
                  dispatch={router.dispatch}
                  setOptions={router.setOptions}
                />
              )}
            </Show>
          );
        }}
      </For>
    </View>
  );
};

const KeepAliveScene: ParentComponent<{
  route: TabRouteRecord;
  isActive: boolean;
  dispatch: (action: RouterAction) => void;
  setOptions: (key: string, options: ScreenOptions) => void;
}> = (props) => {
  const scene = createScene(props.route, props.dispatch, props.setOptions);

  onCleanup(() => {
    cleanupScene(scene);
  });

  const Component = scene.descriptor.component;
  const sceneStyle = (): Style & { zIndex?: number } => ({
    display: props.isActive ? "flex" : "none",
    flex: 1,
    width: "100%",
    height: "100%",
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: props.isActive ? 1 : 0,
  });

  return (
    <View style={sceneStyle()}>
      <RouteProvider value={scene.context}>
        <Component />
      </RouteProvider>
    </View>
  );
};

interface TabRouteRecord {
  key: string;
  name: string;
  descriptor: ScreenDescriptor;
  params?: Record<string, unknown>;
  tabOptions?: ScreenOptions["tab"];
}

interface RenderedScene {
  route: TabRouteRecord;
  descriptor: ScreenDescriptor;
  context: RouteContextValueInternal;
  disposeOptions?: () => void;
}

function createScene(
  route: TabRouteRecord,
  dispatch: (action: RouterAction) => void,
  setOptions: (key: string, options: ScreenOptions) => void
): RenderedScene {
  const context = createRouteContextValue(
    {
      key: route.key,
      name: route.name,
      params: route.params,
    },
    (action) => {
      if (action.type === "SET_PARAMS" && action.source === route.key) {
        route.params = {
          ...(route.params ?? {}),
          ...action.payload,
        };
        return;
      }
      dispatch(action);
    }
  ) as RouteContextValueInternal;

  const disposeOptions = route.descriptor.options
    ? observeRouteOptions(route.descriptor.options, (options) => {
        if (options) {
          setOptions(route.key, options);
        }
      })
    : undefined;

  return {
    route,
    descriptor: route.descriptor,
    context,
    disposeOptions,
  };
}

function cleanupScene(scene: RenderedScene | null) {
  scene?.disposeOptions?.();
}

function buildRouteRecords(
  names: string[],
  previous: TabRouteRecord[]
): TabRouteRecord[] {
  if (names.length === 0) {
    return [];
  }
  const previousByName = new Map(previous.map((route) => [route.name, route]));
  const next: TabRouteRecord[] = [];

  for (const name of names) {
    const descriptor = resolveScreenDescriptor(name);
    if (!descriptor) {
      continue;
    }
    const previousRoute = previousByName.get(name);
    const staticOptions = getStaticOptions(descriptor.options);
    const stableKey =
      previousRoute?.key ?? createTabRouteKey(`${name}-${next.length}`);
    next.push({
      key: stableKey,
      name: descriptor.name,
      descriptor,
      params: previousRoute?.params ?? descriptor.initialParams,
      tabOptions: staticOptions?.tab,
    });
  }

  return next;
}

function pickActiveKey(
  currentKey: string | null,
  routes: TabRouteRecord[],
  preferredName?: string
): string | null {
  if (currentKey && routes.some((route) => route.key === currentKey)) {
    return currentKey;
  }
  if (!routes.length) {
    return null;
  }
  const nextName =
    (preferredName &&
      routes.find((route) => route.name === preferredName)?.name) ??
    routes[0].name;
  const next = routes.find((route) => route.name === nextName) ?? routes[0];
  return next.key;
}

let routeKeyCounter = 0;
function createTabRouteKey(name: string): string {
  routeKeyCounter += 1;
  return `${name}-${routeKeyCounter.toString(36)}`;
}

function getStaticOptions(
  options?: ScreenDescriptor["options"]
): ScreenOptions | undefined {
  if (!options || typeof options === "function") {
    return undefined;
  }
  return options as ScreenOptions;
}

function supportsNativeTabIconSurfaces(): boolean {
  if (Platform.OS === OS.ANDROID) return true;
  return (globalThis as any).__IOS_TAB_ICON_SURFACES__ === true;
}

function observeRouteOptions(
  options: ScreenDescriptor["options"],
  callback: (options?: ScreenOptions) => void
): () => void {
  return createRoot((dispose) => {
    createEffect(() => {
      const next = typeof options === "function" ? options() : options;
      callback(next as ScreenOptions | undefined);
    });
    return dispose;
  });
}
