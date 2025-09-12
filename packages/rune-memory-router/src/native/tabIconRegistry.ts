import {
  render,
  getHost,
  getActiveSurface,
  setActiveSurface,
  type HostNode,
} from "@rune/core";
import { Platform, OS } from "@rune/apis";
import { runWithOwner, type Owner } from "solid-js";
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
  props: IconRenderProps;
}

const registry = new Map<string, RegistryEntry>();
const mounted = new Map<number, MountedIcon>();
const surfacesByKey = new Map<string, Set<number>>();

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

function runFactory(
  entry: RegistryEntry,
  props: IconRenderProps
): () => ReturnType<TabIconFactory> {
  if (entry.owner) {
    return () => runWithOwner(entry.owner, () => entry.factory(props));
  }
  return () => entry.factory(props);
}

function mountIcon(
  surfaceId: number,
  entry: RegistryEntry,
  props: IconRenderProps
) {
  const current = mounted.get(surfaceId);
  if (current) {
    current.dispose();
  }

  let disposeFn: () => void = () => undefined;
  runWithSurface(surfaceId, () => {
    disposeFn = render(runFactory(entry, props), createSurfaceContainer(surfaceId));
    flushHostQueue();
  });

  const mountedEntry: MountedIcon = {
    key: entry.routeKey,
    props,
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
    const props = mountedEntry?.props ?? { active: false, color: "#ffffff" };
    mountIcon(surfaceId, entry, props);
  }
}

function renderNativeTabIcon(
  surfaceId: number,
  routeKey: string,
  active: boolean,
  color: string
): boolean {
  const entry = registry.get(routeKey);
  if (!entry) return false;
  mountIcon(surfaceId, entry, { active, color });
  return true;
}

function disposeNativeTabIcon(surfaceId: number) {
  disposeMountedIcon(surfaceId);
}

export function registerNativeTabIcon(entry: RegistryEntry) {
  registry.set(entry.routeKey, entry);
  rerenderMountedIcons(entry.routeKey);
}

export function unregisterNativeTabIcon(routeKey: string) {
  registry.delete(routeKey);
  const surfaces = surfacesByKey.get(routeKey);
  if (surfaces) {
    for (const surfaceId of Array.from(surfaces.values())) {
      disposeMountedIcon(surfaceId);
    }
    surfacesByKey.delete(routeKey);
  }
}

function installGlobalAccessors() {
  if (Platform.OS !== OS.IOS) {
    return;
  }
  const globalObj = globalThis as Record<string, unknown>;
  if (typeof globalObj.__rune_renderTabIcon === "function") {
    return;
  }
  Object.defineProperties(globalObj, {
    __rune_renderTabIcon: {
      value: renderNativeTabIcon,
      enumerable: false,
      configurable: false,
      writable: false,
    },
    __rune_disposeTabIcon: {
      value: disposeNativeTabIcon,
      enumerable: false,
      configurable: false,
      writable: false,
    },
  });
}

installGlobalAccessors();
