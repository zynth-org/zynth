import {
  createSignal,
  createEffect,
  onCleanup,
  ParentComponent,
} from "solid-js";
import { createSafeAreaInsets } from "@rune/safe-area";
import type {
  LinkingOptions,
  NavigationPersistenceAdapter,
  NavigationState,
  RouteNode,
  RouterAction,
  RouterContextValue,
} from "./core/types";
import {
  RouterContext,
  applyScreenOptions,
  createBeforeRemoveManager,
  createFocusManager,
  registerScreen as registerScreenDescriptor,
} from "./core/RouterContext";
import {
  dispatchNavigationAction,
  getNativeRouterBridge,
  resolveBeforeRemoveRequest,
  subscribeToNativeRouterEvent,
} from "./core/actions";
import {
  ROUTER_EVENT_STATE_CHANGED,
  ROUTER_EVENT_BEFORE_REMOVE,
  type RouterEventPayload,
} from "./core/events";
import { setLinkingOptions } from "./core/linking";
import { emitDevtoolsEvent } from "./core/devtools";

export interface NavigationContainerProps {
  children: any;
  onReady?: (state: NavigationState | null) => void;
  suppressSafeAreaWarning?: boolean;
  initialState?: NavigationState;
  onStateChange?: (state: NavigationState) => void;
  persistence?: NavigationPersistenceAdapter;
  linking?: LinkingOptions;
  enableDevtoolsTimeline?: boolean;
}

let warnedSafeArea = false;

function assertSafeAreaProvider(disableWarning?: boolean): void {
  if (disableWarning || warnedSafeArea) {
    return;
  }

  const snapshot = createSafeAreaInsets();
  if (
    snapshot.top === 0 &&
    snapshot.bottom === 0 &&
    snapshot.left === 0 &&
    snapshot.right === 0
  ) {
    console.warn(
      "[RuneRouter] SafeAreaProvider not detected. Wrap your app with <SafeAreaProvider> and pass getInitialWindowMetrics()."
    );
  }
  warnedSafeArea = true;
}

export const NavigationContainer: ParentComponent<NavigationContainerProps> = (
  props
) => {
  assertSafeAreaProvider(props.suppressSafeAreaWarning);

  const bridge = getNativeRouterBridge();
  const initialState = bridge.getState();
  const [state, setState] = createSignal<NavigationState | null>(initialState);
  const focusManager = createFocusManager();
  const beforeRemoveManager = createBeforeRemoveManager();
  let ready = false;
  let restoringState = false;
  let bootstrappedInitialState = Boolean(initialState);
  const isDevtoolsEnabled = () => props.enableDevtoolsTimeline ?? false;

  const unsubscribeState = subscribeToNativeRouterEvent(
    ROUTER_EVENT_STATE_CHANGED,
    (payload: RouterEventPayload<typeof ROUTER_EVENT_STATE_CHANGED>) => {
      setState(payload.state);
    }
  );

  const unsubscribeBeforeRemove = subscribeToNativeRouterEvent(
    ROUTER_EVENT_BEFORE_REMOVE,
    (payload: RouterEventPayload<typeof ROUTER_EVENT_BEFORE_REMOVE>) => {
      const blocked = beforeRemoveManager.emit(
        payload.action,
        payload.key,
        payload.data
      );
      if (payload.requestId) {
        resolveBeforeRemoveRequest(payload.requestId, blocked);
      }
    }
  );

  onCleanup(() => {
    unsubscribeState();
    unsubscribeBeforeRemove();
    setLinkingOptions(null);
  });

  createEffect(() => {
    setLinkingOptions(props.linking ?? null);
  });

  const dispatch = (action: RouterAction) => {
    if (maybePreventBeforeRemove(action)) {
      return;
    }
    if (isDevtoolsEnabled()) {
      emitDevtoolsEvent({ type: "action", action, timestamp: Date.now() });
    }
    dispatchNavigationAction(action);
  };

  createEffect(() => {
    const next = state();
    focusManager.update(next);
    if (next) {
      props.onStateChange?.(next);
      if (isDevtoolsEnabled()) {
        emitDevtoolsEvent({ type: "state", state: next, timestamp: Date.now() });
      }
      if (props.persistence && !restoringState) {
        void props.persistence.save(next);
      }
    }

    if (!ready && next) {
      ready = true;
      props.onReady?.(next);
    }

    if (next && !bootstrappedInitialState) {
      bootstrappedInitialState = true;
    }
  });

  createEffect(() => {
    const adapter = props.persistence;
    if (!adapter) {
      return;
    }
    let cancelled = false;
    restoringState = true;
    Promise.resolve(adapter.load())
      .then((saved) => {
        if (cancelled || !saved) {
          return;
        }
        dispatchNavigationAction({ type: "RESET", state: saved });
      })
      .finally(() => {
        if (!cancelled) {
          restoringState = false;
        }
      });

    return () => {
      cancelled = true;
      restoringState = false;
    };
  });

  createEffect(() => {
    if (bootstrappedInitialState) {
      return;
    }
    if (!props.initialState) {
      return;
    }
    if (!state()) {
      dispatchNavigationAction({ type: "RESET", state: props.initialState });
      bootstrappedInitialState = true;
    }
  });

  const context: RouterContextValue = {
    state,
    dispatch,
    setOptions: applyScreenOptions,
    registerScreen: (descriptor) => registerScreenDescriptor(descriptor),
    subscribeFocus: (key, handler) => focusManager.subscribe(key, handler),
    addBeforeRemoveListener: (key, handler) =>
      beforeRemoveManager.add(key, handler),
    emitBeforeRemove: (action, key, data) =>
      beforeRemoveManager.emit(action, key, data),
  };

  return (
    <RouterContext.Provider value={context}>
      {props.children}
    </RouterContext.Provider>
  );

  function maybePreventBeforeRemove(action: RouterAction): boolean {
    const currentState = state();
    switch (action.type) {
      case "POP":
      case "REPLACE": {
        const targetKey = action.source ?? getFocusedRouteKey(currentState);
        if (targetKey) {
          return beforeRemoveManager.emit(action, targetKey);
        }
        return false;
      }
      case "RESET": {
        const targetKey = getFocusedRouteKey(currentState);
        if (targetKey) {
          return beforeRemoveManager.emit(action, targetKey);
        }
        return false;
      }
      default:
        return false;
    }
  }
};

function getFocusedRouteKey(state: NavigationState | null): string | undefined {
  let cursor: NavigationState | null | undefined = state;
  while (cursor) {
    const route: RouteNode | undefined = cursor.routes[cursor.index ?? 0];
    if (!route) {
      return undefined;
    }
    if (!route.state) {
      return route.key ?? route.name;
    }
    cursor = route.state;
  }
  return undefined;
}
