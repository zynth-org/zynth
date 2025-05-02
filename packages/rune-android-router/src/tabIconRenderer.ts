import { render, setActiveSurface } from "@rune/core";
import type { HostNode } from "@rune/core";
import { getTabIconFactory } from "./tabIconRegistry";

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

  setActiveSurface(surfaceId);
  const dispose = render(factory, createSurfaceContainer(surfaceId));
  mountedIcons.set(surfaceId, () => {
    setActiveSurface(surfaceId);
    dispose();
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

function installIconRenderer() {
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
