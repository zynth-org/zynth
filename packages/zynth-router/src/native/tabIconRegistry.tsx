import {
  render,
  getHost,
  createPortalSurfaceHandle,
} from "@zynthjs/core";
import { runWithOwner, createSignal, type Owner } from "solid-js";
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

import { View } from "@zynthjs/components";

function mountIcon(
  surfaceId: number,
  entry: RegistryEntry,
  props: IconRenderProps
) {
  const current = mounted.get(surfaceId);

  // If already mounted, just update the signals.
  if (current) {
    current.setProps(props);
    return;
  }

  let disposeFn: () => void = () => undefined;
  const portal = createPortalSurfaceHandle(surfaceId);

  const [active, setActive] = createSignal(props.active);
  const [color, setColor] = createSignal(props.color);

  portal.run(() => {
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
            entry.owner
              ? runWithOwner(entry.owner, () =>
                  entry.factory({
                    active: active(),
                    color,
                  })
                )
              : entry.factory({ active: active(), color })
          }
        </View>
      );
    }, portal.root);
    flushHostQueue();
  });

  const mountedEntry: MountedIcon = {
    key: entry.routeKey,
    getProps: () => ({ active: active(), color: color() }),
    setProps: (nextProps: IconRenderProps) => {
      setActive(nextProps.active);
      setColor(nextProps.color);
    },
    dispose: () => {
      portal.run(() => {
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
