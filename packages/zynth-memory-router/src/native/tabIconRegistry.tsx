import {
  render,
  getHost,
  getActiveSurface,
  setActiveSurface,
  type HostNode,
} from "@zynth/core";
import { Platform, OS } from "@zynth/apis";
import { runWithOwner, type Owner, createSignal } from "solid-js";
import type { TabIconFactory } from "../types";

interface RegistryEntry {
  routeKey: string;
  factory: TabIconFactory;
  owner: Owner | null;
}

interface IconRenderProps {
  active: boolean;
  color: string;
}

interface MountedIcon {
  key: string;
  dispose: () => void;
  setProps: (props: IconRenderProps) => void;
  getProps: () => IconRenderProps;
}

const registry = new Map<string, RegistryEntry>();
const mounted = new Map<number, MountedIcon>();
const surfacesByKey = new Map<string, Set<number>>();
const pendingByKey = new Map<string, Map<number, IconRenderProps>>();
const pendingWarnedKeys = new Set<string>();

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

function createSurfaceContainer(rootId: number): HostNode {
  return { id: rootId, type: "root" };
}

import { View } from "@zynth/components";

function mountIcon(
  surfaceId: number,
  entry: RegistryEntry,
  props: IconRenderProps
) {
  const current = mounted.get(surfaceId);

  // If already mounted, just update the reactive signals
  if (current) {
    // console.log(`[tabIconRegistry] Updating icon props for surface ${surfaceId}, routeKey=${entry.routeKey}, active=${props.active}, color=${props.color}`);
    current.setProps(props);
    return;
  }

  // console.log(`[tabIconRegistry] Mounting NEW icon for surface ${surfaceId}, routeKey: ${entry.routeKey}, active: ${props.active}, color: ${props.color}`);

  // Create reactive signals for active and color
  const [active, setActive] = createSignal(props.active);
  const [color, setColor] = createSignal(props.color);

  let disposeFn: () => void = () => undefined;

  runWithSurface(surfaceId, () => {
    disposeFn = render(() => {
      return (
        <View
          style={{
            width: "100%",
            height: "100%",
            justifyContent: "center",
            alignItems: "center",
          }}
        >
          {
            (() => {
              // Read signals inside the JSX function to establish tracking
              // When they change, this function re-runs and updates the view
              const currentActive = active();
              const currentColor = color();
              // console.log(
              //   `[tabIconRegistry] render/update executing for surface ${surfaceId}, active=${currentActive}, color=${currentColor}`
              // );

              return entry.owner
                ? runWithOwner(entry.owner, () =>
                    entry.factory({
                      active: currentActive,
                      color: currentColor,
                    })
                  )
                : entry.factory({ active: currentActive, color: currentColor });
            }) as any
          }
        </View>
      );
    }, createSurfaceContainer(surfaceId));
    flushHostQueue();
  });

  const mountedEntry: MountedIcon = {
    key: entry.routeKey,
    getProps: () => ({ active: active(), color: color() }),
    setProps: (nextProps: IconRenderProps) => {
      runWithSurface(surfaceId, () => {
        if (active() !== nextProps.active) {
          // console.log(
          //   `[tabIconRegistry] Setting active: ${active()} -> ${nextProps.active}`
          // );
          setActive(nextProps.active);
        }
        if (color() !== nextProps.color) {
          // console.log(
          //   `[tabIconRegistry] Setting color: ${color()} -> ${nextProps.color}`
          // );
          setColor(nextProps.color);
        }

        // On Android, we MUST flush synchronously while the surface is active.
        // On iOS, synchronous flushing might interfere with native animations (e.g. TabBar transitions),
        // so we defer to the microtask queue to be safe.
        if (Platform.OS === OS.ANDROID) {
          flushHostQueue();
        } else {
          queueMicrotask(() => {
            runWithSurface(surfaceId, () => {
              flushHostQueue();
            });
          });
        }
      });
    },
    dispose: () => {
      runWithSurface(surfaceId, () => {
        disposeFn();
        flushHostQueue();
      });
    },
  };

  mounted.set(surfaceId, mountedEntry);

  let surfaces = surfacesByKey.get(entry.routeKey);
  if (!surfaces) {
    surfaces = new Set();
    surfacesByKey.set(entry.routeKey, surfaces);
  }
  surfaces.add(surfaceId);
}

function disposeMountedIcon(surfaceId: number) {
  const mountedEntry = mounted.get(surfaceId);
  if (!mountedEntry) return;

  mounted.delete(surfaceId);
  mountedEntry.dispose();

  const surfaces = surfacesByKey.get(mountedEntry.key);
  if (surfaces) {
    surfaces.delete(surfaceId);
    if (surfaces.size === 0) {
      surfacesByKey.delete(mountedEntry.key);
    }
  }
}

function rerenderMountedIcons(routeKey: string) {
  const entry = registry.get(routeKey);
  if (!entry) return;
  const surfaces = surfacesByKey.get(routeKey);
  if (!surfaces || surfaces.size === 0) return;
  const surfaceIds = Array.from(surfaces.values());
  for (const surfaceId of surfaceIds) {
    const mountedEntry = mounted.get(surfaceId);
    const previousProps = mountedEntry?.getProps();
    if (mountedEntry) {
      mountedEntry.dispose();
      mounted.delete(surfaceId);
    }
    const props = previousProps ?? { active: false, color: "#ffffff" };
    mountIcon(surfaceId, entry, props);
  }
}

export function renderNativeTabIcon(
  surfaceId: number,
  routeKey: string,
  active: boolean,
  color: string
): boolean {
  const entry = registry.get(routeKey);
  if (!entry) {
    let pending = pendingByKey.get(routeKey);
    if (!pending) {
      pending = new Map();
      pendingByKey.set(routeKey, pending);
    }
    pending.set(surfaceId, { active, color });
    if (!pendingWarnedKeys.has(routeKey)) {
      pendingWarnedKeys.add(routeKey);
      console.warn(
        `[tabIconRegistry] queued surface icon before factory registered routeKey=${routeKey} surfaceId=${surfaceId}`
      );
    }
    return false;
  }
  mountIcon(surfaceId, entry, { active, color });
  return true;
}

export function disposeNativeTabIcon(surfaceId: number) {
  disposeMountedIcon(surfaceId);
}

export function registerNativeTabIcon(entry: RegistryEntry) {
  const current = registry.get(entry.routeKey);
  if (
    current &&
    current.factory === entry.factory &&
    current.owner === entry.owner
  ) {
    return;
  }
  registry.set(entry.routeKey, entry);
  rerenderMountedIcons(entry.routeKey);

  const pending = pendingByKey.get(entry.routeKey);
  if (pending && pending.size > 0) {
    for (const [surfaceId, props] of pending.entries()) {
      mountIcon(surfaceId, entry, props);
    }
    pendingByKey.delete(entry.routeKey);
  }
}

export function unregisterNativeTabIcon(routeKey: string) {
  registry.delete(routeKey);
  pendingByKey.delete(routeKey);
  pendingWarnedKeys.delete(routeKey);
  const surfaces = surfacesByKey.get(routeKey);
  if (surfaces) {
    for (const surfaceId of Array.from(surfaces.values())) {
      disposeMountedIcon(surfaceId);
    }
    surfacesByKey.delete(routeKey);
  }
}

function installGlobalAccessors() {
  const globalObj = globalThis as Record<string, unknown>;
  if (typeof globalObj.__zynth_renderTabIcon === "function") {
    return;
  }
  Object.defineProperties(globalObj, {
    __zynth_renderTabIcon: {
      value: renderNativeTabIcon,
      enumerable: false,
      configurable: false,
      writable: false,
    },
    __zynth_disposeTabIcon: {
      value: disposeNativeTabIcon,
      enumerable: false,
      configurable: false,
      writable: false,
    },
  });
}

installGlobalAccessors();
