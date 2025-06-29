import {
  ParentComponent,
  Show,
  createContext,
  createEffect,
  createMemo,
  createRoot,
  createSignal,
  createUniqueId,
  onCleanup,
  onMount,
  useContext,
} from "solid-js";
import {
  getHost,
  render,
  setActiveSurface,
  getActiveSurface,
} from "@rune/core";
import type { HostNode } from "@rune/core";
import type { JSX } from "solid-js";
import type {
  NavigationState,
  RouteNode,
  RouteContextValueInternal,
  ScreenOptions,
  ScreenOptionsInput,
  StackComponentType,
  StackProps,
  ScreenDescriptor,
  RouterContextValue,
} from "../core/types";
import { StackScreen } from "./Screen";
import { Header } from "./Header";
import {
  listRegisteredScreens,
  resolveScreenDescriptor,
  notifyScreenRendered,
} from "../core/actions";
import {
  RouteProvider,
  RouterContext,
  createRouteContextValue,
  useRouterContext,
} from "../core/RouterContext";

const scheduleMicrotask =
  typeof queueMicrotask === "function"
    ? queueMicrotask
    : (callback: () => void) => setTimeout(callback, 0);

const StackIdContext = createContext<string>();

export function useStackId(): string {
  const id = useContext(StackIdContext);
  if (!id) {
    throw new Error("Stack components must be rendered inside a <Stack>");
  }
  return id;
}

const StackBase: ParentComponent<StackProps> = (props) => {
  const stackId = props.id ?? `stack-${createUniqueId()}`;
  const router = useRouterContext();
  const [initialized, setInitialized] = createSignal(false);

  onMount(() => {
    scheduleMicrotask(() => {
      if (initialized()) return;
      const initialRouteName =
        props.initialRouteName ?? firstRegisteredRouteName(stackId);
      if (!initialRouteName) {
        if (process.env.NODE_ENV !== "production") {
          console.warn("[RuneRouter] Stack has no screens to initialize.");
        }
        return;
      }
      const descriptor = resolveScreenDescriptor(initialRouteName);
      if (!descriptor) {
        if (process.env.NODE_ENV !== "production") {
          console.warn(
            `[RuneRouter] No descriptor found for initial route ${initialRouteName}`
          );
        }
        return;
      }
      router.dispatch({
        type: "RESET",
        state: createInitialStackState(stackId, initialRouteName, descriptor),
      });
      setInitialized(true);
    });
  });

  return (
    <StackIdContext.Provider value={stackId}>
      <StackRenderer stackId={stackId} />
      {props.children}
    </StackIdContext.Provider>
  );
};

export const Stack = Object.assign(StackBase, {
  Screen: StackScreen,
  Header,
}) as StackComponentType;

const StackRenderer: ParentComponent<{ stackId: string }> = (props) => {
  const router = useRouterContext();
  const stackState = createMemo(() =>
    findStackState(router.state(), props.stackId)
  );
  const activeRoute = createMemo(() => getActiveRoute(stackState()));
  const surfaceManager = createNativeSurfaceManager(router);
  const hasNativeSurfaces = createMemo(() => {
    const routes = stackState()?.routes ?? [];
    return routes.some(
      (route) => typeof (route.meta as Record<string, unknown> | undefined)?.surfaceId === "number"
    );
  });

  if (process.env.NODE_ENV !== "production") {
    createEffect(() => {
      console.log(
        "[RuneRouter] stack state",
        props.stackId,
        JSON.stringify(stackState(), null, 2)
      );
    });
    createEffect(() => {
      console.log(
        "[RuneRouter] active route",
        props.stackId,
        JSON.stringify(activeRoute(), null, 2)
      );
    });
    createEffect(() => {
      console.log(
        "[RuneRouter] current route",
        props.stackId,
        JSON.stringify(activeRoute(), null, 2)
      );
    });
  }

  const [renderedRoute, setRenderedRoute] = createSignal<RenderedScene | null>(null);
  let currentScene: RenderedScene | null = null;

  createEffect(() => {
    if (!hasNativeSurfaces()) return;
    cleanupScene(currentScene);
    currentScene = null;
    setRenderedRoute(null);
    surfaceManager.sync(stackState());
  });

  createEffect(() => {
    if (!hasNativeSurfaces()) {
      surfaceManager.disposeAll();
    }
  });

  createEffect(() => {
    if (hasNativeSurfaces()) {
      return;
    }
    const current = activeRoute();
    if (!current) {
      cleanupScene(currentScene);
      currentScene = null;
      setRenderedRoute(null);
      return;
    }

    const descriptor = resolveScreenDescriptor(current.name);
    if (!descriptor) {
      cleanupScene(currentScene);
      currentScene = null;
      setRenderedRoute(null);
      return;
    }

    if (currentScene && currentScene.key === current.key) {
      currentScene.context.__updateFromState(current.params as any);
      setRenderedRoute(currentScene);
      return;
    }

    cleanupScene(currentScene);
    const routeContext = createRouteContextValue(
      {
        key: current.key,
        name: current.name,
        params: current.params,
      },
      router.dispatch
    ) as RouteContextValueInternal;
    const disposeOptions = descriptor.options
      ? observeRouteOptions(descriptor.options, (options) => {
          if (options) {
            router.setOptions(current.key, options as ScreenOptions);
          }
        })
      : undefined;
    const staticOptions = getStaticOptions(descriptor.options);
    if (staticOptions) {
      router.setOptions(current.key, staticOptions as ScreenOptions);
    }
    currentScene = {
      key: current.key,
      descriptor,
      context: routeContext,
      disposeOptions,
    };
    setRenderedRoute(currentScene);
  });

  onCleanup(() => {
    cleanupScene(currentScene);
    currentScene = null;
    surfaceManager.disposeAll();
  });

  if (hasNativeSurfaces()) {
    return null;
  }

  return (
    <Show when={renderedRoute()} keyed>
      {(scene) => {
        const Component = scene.descriptor.component;
        return (
          <RouteProvider value={scene.context}>
            <Component />
          </RouteProvider>
        );
      }}
    </Show>
  );
};

interface RenderedScene {
  key: string;
  descriptor: ScreenDescriptor;
  context: RouteContextValueInternal;
  disposeOptions?: () => void;
}

function cleanupScene(scene: RenderedScene | null) {
  scene?.disposeOptions?.();
}

type NativeSurfaceScene = {
  key: string;
  surfaceId: number;
  descriptor: ScreenDescriptor;
  context: RouteContextValueInternal;
  disposeOptions?: () => void;
  disposeRender: () => void;
};

function createNativeSurfaceManager(router: RouterContextValue) {
  const scenes = new Map<string, NativeSurfaceScene>();

  const sync = (state: NavigationState | null) => {
    const routes = state?.routes ?? [];
    const activeIndex = state?.index ?? 0;
    const activeKey = routes[activeIndex]?.key ?? routes[activeIndex]?.name;
    const keep = new Set<string>();

    for (const route of routes) {
      const surfaceId = (route.meta as Record<string, unknown> | undefined)?.surfaceId;
      if (typeof surfaceId !== "number") {
        continue;
      }
      const key = route.key ?? route.name;
      keep.add(key);

      const existing = scenes.get(key);
      if (existing) {
        existing.context.__updateFromState(route.params as any);
        continue;
      }

      const descriptor = resolveScreenDescriptor(route.name);
      if (!descriptor) {
        continue;
      }

      const routeContext = createRouteContextValue(
        {
          key,
          name: route.name,
          params: route.params,
        },
        router.dispatch
      ) as RouteContextValueInternal;
      const disposeOptions = descriptor.options
        ? observeRouteOptions(descriptor.options, (options) => {
            if (options) {
              router.setOptions(key, options as ScreenOptions);
            }
          })
        : undefined;
      const staticOptions = getStaticOptions(descriptor.options);
      if (staticOptions) {
        router.setOptions(key, staticOptions as ScreenOptions);
      }

      const disposeRender = renderOnSurface(surfaceId, () => {
        const Component = descriptor.component;
        return (
          <RouterContext.Provider value={router}>
            <RouteProvider value={routeContext}>
              <Component />
            </RouteProvider>
          </RouterContext.Provider>
        );
      });
      registerNativeSurfaceDisposer(surfaceId, disposeRender);

      scenes.set(key, {
        key,
        surfaceId,
        descriptor,
        context: routeContext,
        disposeOptions,
        disposeRender,
      });
    }

    for (const [key, scene] of Array.from(scenes.entries())) {
      if (!keep.has(key)) {
        disposeNativeScene(scene);
        scenes.delete(key);
      }
    }

    if (activeKey) {
      const activeScene = scenes.get(activeKey);
      if (activeScene) {
        setActiveSurface(activeScene.surfaceId);
      }
    }
  };

  const disposeAll = () => {
    for (const scene of scenes.values()) {
      disposeNativeScene(scene);
    }
    scenes.clear();
  };

  return {
    sync,
    disposeAll,
  };

  function disposeNativeScene(scene: NativeSurfaceScene) {
    scene.disposeOptions?.();
    scene.disposeRender();
    unregisterNativeSurfaceDisposer(scene.surfaceId);
  }
}

function renderOnSurface(surfaceId: number, factory: () => JSX.Element) {
  let dispose: () => void = () => {};
  runWithSurface(surfaceId, () => {
    dispose = render(factory as any, createSurfaceContainer(surfaceId));
    flushHostQueue();
    notifyScreenRendered(surfaceId);
  });
  return () => {
    runWithSurface(surfaceId, () => {
      dispose();
      flushHostQueue();
    });
  };
}

function runWithSurface<T>(surfaceId: number, work: () => T): T {
  const previous = getActiveSurface();
  const shouldSwitch = previous !== surfaceId;
  if (shouldSwitch) {
    setActiveSurface(surfaceId);
  }
  try {
    return work();
  } finally {
    if (shouldSwitch) {
      setActiveSurface(previous);
    }
  }
}

function createSurfaceContainer(rootId: number): HostNode {
  return { id: rootId, type: "root" };
}

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

const nativeSurfaceDisposers = new Map<number, () => void>();

function registerNativeSurfaceDisposer(surfaceId: number, dispose: () => void) {
  nativeSurfaceDisposers.set(surfaceId, dispose);
}

function unregisterNativeSurfaceDisposer(surfaceId: number) {
  nativeSurfaceDisposers.delete(surfaceId);
}

function installNativeSurfaceDisposer() {
  const globalObj = globalThis as Record<string, any>;
  if (typeof globalObj.__disposeRouterScreen === "function") {
    return;
  }
  Object.defineProperty(globalObj, "__disposeRouterScreen", {
    value(surfaceId: number) {
      const dispose = nativeSurfaceDisposers.get(surfaceId);
      if (dispose) {
        try {
          dispose();
        } finally {
          nativeSurfaceDisposers.delete(surfaceId);
        }
      }
    },
    enumerable: false,
    configurable: false,
    writable: false,
  });
}

installNativeSurfaceDisposer();

function getStaticOptions(
  options?: ScreenDescriptor["options"]
): ScreenOptions | undefined {
  if (!options || typeof options === "function") {
    return undefined;
  }
  return options as ScreenOptions;
}

function firstRegisteredRouteName(stackId: string): string | undefined {
  const registries = listRegisteredScreens();
  return registries.find((screen) => screen.navigatorId === stackId)?.name;
}

function createInitialStackState(
  stackId: string,
  routeName: string,
  descriptor: ReturnType<typeof resolveScreenDescriptor>
): NavigationState {
  return {
    key: stackId,
    type: "stack",
    index: 0,
    routes: [
      {
        key: `${routeName}-${Date.now().toString(36)}`,
        name: routeName,
        params: descriptor?.initialParams,
      },
    ],
  };
}

function getActiveRoute(state: NavigationState | null): RouteNode | null {
  if (!state || !state.routes.length) {
    return null;
  }
  return state.routes[state.index ?? 0];
}

function findStackState(
  state: NavigationState | null,
  stackId: string
): NavigationState | null {
  if (!state) return null;
  if (state.key === stackId) {
    return state;
  }
  for (const route of state.routes) {
    if (route.state) {
      const match = findStackState(route.state, stackId);
      if (match) {
        return match;
      }
    }
  }
  // Fallback: return the first stack state we encounter so the UI can render
  if (state?.type === "stack") {
    return state;
  }
  return null;
}

function observeRouteOptions(
  options: ScreenOptionsInput,
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
