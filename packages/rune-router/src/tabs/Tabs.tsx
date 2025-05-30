import {
  type Accessor,
  ParentComponent,
  Show,
  createContext,
  createEffect,
  createRoot,
  createSignal,
  createUniqueId,
  onCleanup,
  untrack,
  useContext,
} from "solid-js";
import type {
  RouteContextValueInternal,
  RouterAction,
  ScreenOptions,
  ScreenDescriptor,
  TabsComponentType,
  TabsProps,
} from "../core/types";
import { TabScreen } from "./TabScreen";
import { TabBar } from "./TabBar";
import {
  RouteProvider,
  createRouteContextValue,
  useRoute,
  useRouterContext,
} from "../core/RouterContext";
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
  const tabsId = props.id ?? `tabs-${createUniqueId()}`;
  const router = useRouterContext();
  const routeContext = useRoute();
  const hostRouteKey = routeContext.key;

  const [registeredNames, setRegisteredNames] = createSignal<string[]>([]);
  const [routes, setRoutes] = createSignal<TabRouteRecord[]>([]);
  const [activeKey, setActiveKey] = createSignal<string | null>(null);

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

  const activeRoute = () => {
    const key = activeKey();
    if (!key) return null;
    return routes().find((route) => route.key === key) ?? null;
  };

  const updateActiveRoute = (
    route: TabRouteRecord | undefined,
    syncNative = true
  ) => {
    if (!route) {
      return;
    }
    if (activeKey() === route.key) {
      if (syncNative) {
        selectNativeTab(hostRouteKey, route.name);
      }
      return;
    }
    setActiveKey(route.key);
    if (syncNative) {
      selectNativeTab(hostRouteKey, route.name);
    }
  };

  const handleSelectRoute = (routeName: string, syncNative = true) => {
    const target = routes().find((route) => route.name === routeName);
    updateActiveRoute(target, syncNative);
  };

  createEffect(() => {
    const names = registeredNames();
    const previous = untrack(routes);
    const nextRoutes = buildRouteRecords(names, previous);
    setRoutes(nextRoutes);

    const nextKey = pickActiveKey(
      untrack(activeKey),
      nextRoutes,
      props.initialRouteName
    );
    if (!nextKey) {
      setActiveKey(null);
      return;
    }
    const nextRoute = nextRoutes.find((route) => route.key === nextKey);
    updateActiveRoute(nextRoute, true);
  });

  createEffect(() => {
    const list = routes();
    if (!list.length) {
      removeNativeTabs(hostRouteKey);
      return;
    }
    setNativeTabs(hostRouteKey, {
      navigatorId: tabsId,
      initialRouteName: props.initialRouteName ?? list[0].name,
      tabs: list.map((route) => ({
        name: route.name,
        label: route.tabOptions?.label ?? route.name,
        badge: route.tabOptions?.badge,
        badgeColor: route.tabOptions?.badgeColor,
        activeTintColor: route.tabOptions?.activeTintColor,
        inactiveTintColor: route.tabOptions?.inactiveTintColor,
        icon: route.tabOptions?.icon,
        backgroundColor: route.tabOptions?.tabBarBackgroundColor,
      })),
    });
  });

  createEffect(() => {
    const unsubscribe = subscribeToNativeRouterEvent(
      ROUTER_EVENT_TAB_SELECTED,
      (payload: RouterEventPayload<typeof ROUTER_EVENT_TAB_SELECTED>) => {
        if (payload.navigatorId !== tabsId) {
          return;
        }
        handleSelectRoute(payload.tabName, false);
      }
    );
    onCleanup(unsubscribe);
  });

  onCleanup(() => {
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
        setActiveRoute: (routeName) => handleSelectRoute(routeName, true),
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
  const [scene, setScene] = createSignal<RenderedScene | null>(null);
  const scenes = new Map<string, RenderedScene>();
  let activeScene: RenderedScene | null = null;

  createEffect(() => {
    const routeList = props.routes();
    const current = props.activeRoute() ?? routeList[0];

    const visibleKeys = new Set(routeList.map((route) => route.key));
    for (const [key, storedScene] of scenes.entries()) {
      if (!visibleKeys.has(key)) {
        cleanupScene(storedScene);
        scenes.delete(key);
      }
    }

    if (!current) {
      cleanupScene(activeScene);
      activeScene = null;
      setScene(null);
      return;
    }

    let stored = scenes.get(current.key);
    if (!stored) {
      stored = createScene(current, router.dispatch, router.setOptions);
      scenes.set(current.key, stored);
    } else {
      stored.route = current;
    }

    activeScene = stored;
    setScene(stored);
  });

  onCleanup(() => {
    scenes.forEach((storedScene) => cleanupScene(storedScene));
    scenes.clear();
  });

  return (
    <Show when={scene()} keyed>
      {(currentScene) => {
        const Component = currentScene.descriptor.component;
        return (
          <RouteProvider value={currentScene.context}>
            <Component />
          </RouteProvider>
        );
      }}
    </Show>
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
    next.push({
      key: previousRoute?.key ?? createTabRouteKey(name),
      name: descriptor.name,
      descriptor,
      params: previousRoute?.params ?? descriptor.initialParams,
      tabOptions: previousRoute?.tabOptions ?? staticOptions?.tab,
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
