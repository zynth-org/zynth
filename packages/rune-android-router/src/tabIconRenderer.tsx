import { getHost, render, setActiveSurface } from "@rune/core";
import type { HostNode } from "@rune/core";
import { getTabIconFactory } from "./tabIconRegistry";
import { TabIconWrapper } from "./tabIconWrapper";

const mountedIcons = new Map<number, () => void>();

function createSurfaceContainer(rootId: number): HostNode {
  return { id: rootId, type: "root" };
}

function renderTabIcon(surfaceId: number, iconId: string) {
  const factory = getTabIconFactory(iconId);
  if (!factory) {
    console.warn(`[RuneAndroidRouter] Icon ${iconId} is not registered.`);
    return false;
  }

  mountedIcons.get(surfaceId)?.();

  console.log(
    "[RuneAndroidRouter/nativeRenderer] renderTabIcon",
    surfaceId,
    iconId
  );
  setActiveSurface(surfaceId);
  const dispose = render(
    () => <TabIconWrapper>{factory()}</TabIconWrapper>,
    createSurfaceContainer(surfaceId)
  );
  flushHostQueue();
  mountedIcons.set(surfaceId, () => {
    setActiveSurface(surfaceId);
    dispose();
    flushHostQueue();
  });
  return true;
}

function disposeTabIcon(surfaceId: number) {
  const dispose = mountedIcons.get(surfaceId);
  if (!dispose) return;
  mountedIcons.delete(surfaceId);
  try {
    setActiveSurface(surfaceId);
    dispose();
  } catch (error) {
    console.error("[RuneAndroidRouter] disposeTabIcon failed", error);
  }
}

export function installIconRenderer() {
  const globalObj = globalThis as Record<string, unknown>;
  if (typeof globalObj.__renderTabIcon === "function") {
    return;
  }
  Object.defineProperties(globalObj, {
    __renderTabIcon: {
      value: renderTabIcon,
      enumerable: false,
      configurable: false,
      writable: false,
    },
    __disposeTabIcon: {
      value: disposeTabIcon,
      enumerable: false,
      configurable: false,
      writable: false,
    },
  });
}

installIconRenderer();

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
