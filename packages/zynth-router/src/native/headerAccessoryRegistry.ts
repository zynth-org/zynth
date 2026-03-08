import {
  render,
  getHost,
  getActiveSurface,
  setActiveSurface,
  type HostNode,
} from "@zynth/core";
import { Platform, OS } from "@zynth/apis";
import { runWithOwner, type JSX, type Owner } from "solid-js";

export type HeaderAccessoryPosition = "right";

interface RegistryEntry {
  routeKey: string;
  position: HeaderAccessoryPosition;
  factory: () => JSX.Element;
  owner: Owner | null;
}

interface MountedAccessory {
  key: string;
  dispose: () => void;
}

const registry = new Map<string, RegistryEntry>();
const mounted = new Map<number, MountedAccessory>();
const surfacesByKey = new Map<string, Set<number>>();
const pendingByKey = new Map<string, Set<number>>();

function makeKey(routeKey: string, position: HeaderAccessoryPosition): string {
  return `${routeKey}:${position}`;
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

function runFactory(entry: RegistryEntry): JSX.Element {
  if (entry.owner) {
    return runWithOwner(entry.owner, entry.factory);
  }
  return entry.factory();
}

function mountAccessory(surfaceId: number, key: string, entry: RegistryEntry) {
  const current = mounted.get(surfaceId);
  if (current) {
    current.dispose();
  }

  let disposeFn: () => void = () => undefined;
  runWithSurface(surfaceId, () => {
    disposeFn = render(() => runFactory(entry), createSurfaceContainer(surfaceId));
    flushHostQueue();
  });

  mounted.set(surfaceId, {
    key,
    dispose: () => {
      runWithSurface(surfaceId, () => {
        disposeFn();
        flushHostQueue();
      });
    },
  });

  let surfaces = surfacesByKey.get(key);
  if (!surfaces) {
    surfaces = new Set();
    surfacesByKey.set(key, surfaces);
  }
  surfaces.add(surfaceId);
}

function disposeMountedAccessory(surfaceId: number) {
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

function rerenderMountedAccessories(key: string) {
  const entry = registry.get(key);
  if (!entry) return;
  const surfaces = surfacesByKey.get(key);
  if (!surfaces || surfaces.size === 0) return;
  const surfaceIds = Array.from(surfaces.values());
  for (const surfaceId of surfaceIds) {
    mountAccessory(surfaceId, key, entry);
  }
}

function renderNativeHeaderAccessory(
  surfaceId: number,
  routeKey: string,
  position: HeaderAccessoryPosition
) {
  console.log(
    `[headerAccessoryRegistry] render surface=${surfaceId} route=${routeKey} position=${position}`
  );
  const key = makeKey(routeKey, position);
  const entry = registry.get(key);
  if (!entry) {
    let pending = pendingByKey.get(key);
    if (!pending) {
      pending = new Set();
      pendingByKey.set(key, pending);
    }
    pending.add(surfaceId);
    console.warn(
      `[ZynthRouter] Missing header accessory factory for route '${routeKey}' (${position}). Queued surface=${surfaceId}`
    );
    return false;
  }
  mountAccessory(surfaceId, key, entry);
  return true;
}

function disposeNativeHeaderAccessory(surfaceId: number) {
  disposeMountedAccessory(surfaceId);
}

export function registerNativeHeaderAccessory(entry: RegistryEntry) {
  const key = makeKey(entry.routeKey, entry.position);
  registry.set(key, entry);
  rerenderMountedAccessories(key);
  const pending = pendingByKey.get(key);
  if (pending && pending.size > 0) {
    for (const surfaceId of pending.values()) {
      mountAccessory(surfaceId, key, entry);
    }
    pendingByKey.delete(key);
  }
}

export function unregisterNativeHeaderAccessory(
  routeKey: string,
  position: HeaderAccessoryPosition
) {
  const key = makeKey(routeKey, position);
  registry.delete(key);
  pendingByKey.delete(key);
  const surfaces = surfacesByKey.get(key);
  if (surfaces && surfaces.size > 0) {
    for (const surfaceId of Array.from(surfaces.values())) {
      disposeMountedAccessory(surfaceId);
    }
  }
  surfacesByKey.delete(key);
}

function installGlobalAccessors() {
  if (Platform.OS !== OS.IOS) {
    return;
  }
  const globalObj = globalThis as Record<string, unknown>;
  if (typeof globalObj.__zynth_renderHeaderAccessory === "function") {
    return;
  }
  Object.defineProperties(globalObj, {
    __zynth_renderHeaderAccessory: {
      value: renderNativeHeaderAccessory,
      enumerable: false,
      configurable: false,
      writable: false,
    },
    __zynth_disposeHeaderAccessory: {
      value: disposeNativeHeaderAccessory,
      enumerable: false,
      configurable: false,
      writable: false,
    },
  });
}

installGlobalAccessors();
