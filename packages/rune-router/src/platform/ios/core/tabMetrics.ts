import {
  createEffect,
  createMemo,
  createSignal,
  onCleanup,
} from "solid-js";
import { createSafeAreaInsets } from "@rune/safe-area";
import {
  subscribeToNativeRouterEvent,
} from "./actions";
import { ROUTER_EVENT_TAB_METRICS } from "./events";
export interface TabBarMetrics {
  height: number;
  inset: number;
}

const DEFAULT_IOS_TABBAR_HEIGHT = 50;

type Metrics = {
  height: number;
  inset: number;
};

const metricsByNavigator = new Map<string, Metrics>();
const listeners = new Set<() => void>();
let unsubscribeNative: (() => void) | null = null;

function notify(): void {
  for (const listener of listeners) {
    listener();
  }
}

function ensureSubscription(): void {
  if (unsubscribeNative) return;
  unsubscribeNative = subscribeToNativeRouterEvent(
    ROUTER_EVENT_TAB_METRICS,
    ({ navigatorId, height, inset }) => {
      metricsByNavigator.set(navigatorId, { height, inset });
      notify();
    }
  );
}

export function createTabBarMetricsAccessor(
  navigatorId: string | undefined,
  extraHeight = 0
): () => TabBarMetrics {
  ensureSubscription();
  const [tick, setTick] = createSignal(0);

  createEffect(() => {
    const listener = () => setTick((value) => value + 1);
    listeners.add(listener);
    onCleanup(() => listeners.delete(listener));
  });

  return createMemo(() => {
    // Track subscription updates
    tick();
    const safeArea = createSafeAreaInsets().bottom;
    const metrics = navigatorId ? metricsByNavigator.get(navigatorId) : undefined;
    const inset = metrics?.inset ?? safeArea;
    const height = (metrics?.height ?? DEFAULT_IOS_TABBAR_HEIGHT + inset) + extraHeight;
    return { height, inset };
  });
}
