import {
  render,
  getHost,
  getActiveSurface,
  setActiveSurface,
  type HostNode,
} from "@rune/core";
import { Platform, OS } from "@rune/apis";
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
    // If already mounted, just update the signal
    current.setProps(props);
    // CRITICAL: Must flush queue to apply updates immediately to the native view
    runWithSurface(surfaceId, () => {
        flushHostQueue();
    });
    return;
  }

  // Create reactive props for this mount
  const [getProps, setProps] = createSignal(props);

  let disposeFn: () => void = () => undefined;
  
  runWithSurface(surfaceId, () => {
    // render expects a function that returns the JSX. 
    // We wrap runFactory in a reactive tracking function.
    disposeFn = render(() => {
        const currentProps = getProps();
        return runFactory(entry, currentProps)();
    }, createSurfaceContainer(surfaceId));
    flushHostQueue();
  });

  const mountedEntry: MountedIcon = {
    key: entry.routeKey,
    setProps,
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
    // Just re-call mountIcon with current props (or default) to trigger update if needed
    // But since we don't have stored props outside of the signal, this logic is tricky.
    // However, rerenderMountedIcons is usually called when the *factory* changes (e.g. HMR).
    // In that case, we probably DO want to re-mount or at least re-run the factory.
    // Since our render function calls `runFactory(entry, getProps())`, and `entry` is passed by reference/closure?
    // Wait, `runFactory` takes `entry`. If `registry.set` replaced the entry object, the closure in `render`
    // still holds the OLD entry if we aren't careful.
    
    // To support HMR/Factory updates, we need to handle this.
    // But for now, let's focus on the prop update flicker.
    // If the factory changed, we SHOULD probably unmount and remount to be safe.
    
    const mountedEntry = mounted.get(surfaceId);
    if (mountedEntry) {
         // Force dispose and re-mount for factory updates
         mountedEntry.dispose();
         mounted.delete(surfaceId);
    }
    const props = { active: false, color: "#ffffff" }; // Default/Fallback
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
