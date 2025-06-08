import {
  getHost,
  render,
  setActiveSurface,
  getActiveSurface,
} from "@rune/core";
import type { HostNode } from "@rune/core";
import { getTabIconFactory } from "./tabIconRegistry";
import { TabIconWrapper } from "./tabIconWrapper";

type MountedIcon = {
  iconId: string;
  dispose: () => void;
  setActive: (value: boolean) => void;
  targetActive?: boolean | null;
};

const mountedIcons = new Map<number, MountedIcon>();
const iconActiveStates = new Map<string, boolean>();

function runWithSurface<T>(surfaceId: number, work: () => T): T {
  const previousSurface = getActiveSurface();
  const shouldSwitch = surfaceId !== previousSurface;
  if (shouldSwitch) {
    setActiveSurface(surfaceId);
  }
  try {
    return work();
  } finally {
    if (shouldSwitch) {
      setActiveSurface(previousSurface);
    }
  }
}

function createSurfaceContainer(rootId: number): HostNode {
  return { id: rootId, type: "root" };
}

function renderTabIcon(
  surfaceId: number,
  iconId: string,
  isActive: boolean = false
) {
  const factory = getTabIconFactory(iconId);
  if (!factory) {
    console.warn(`[RuneRouter] Icon ${iconId} is not registered.`);
    return false;
  }

  let effectiveActive = isActive;
  if (iconActiveStates.has(iconId)) {
    effectiveActive = iconActiveStates.get(iconId)!;
  }

  const current = mountedIcons.get(surfaceId);
  if (current?.iconId === iconId) {
    current.setActive(effectiveActive);
    return true;
  }

  current?.dispose();

  let disposeFn: () => void = () => {};
  let currentActive = effectiveActive;
  let isMounted = true;

  const doRender = (active: boolean) => {
    if (!isMounted) return;
    runWithSurface(surfaceId, () => {
      disposeFn();
      disposeFn = render(
        () => <TabIconWrapper>{factory({ active })}</TabIconWrapper>,
        createSurfaceContainer(surfaceId)
      );
      flushHostQueue();
    });
  };

  doRender(effectiveActive);

  mountedIcons.set(surfaceId, {
    iconId,
    targetActive: effectiveActive,
    dispose: () => {
      isMounted = false;
      runWithSurface(surfaceId, () => {
        disposeFn();
        flushHostQueue();
      });
    },
    setActive(value: boolean) {
      if (currentActive === value) return;
      currentActive = value;
      doRender(value);
    },
  });
  return true;
}

export function updateTabIconActiveState(iconId: string, isActive: boolean) {
  // console.log(`[RuneRouter] updateTabIconActiveState: ${iconId} -> ${isActive}`);
  iconActiveStates.set(iconId, isActive);
  for (const mounted of mountedIcons.values()) {
    if (mounted.iconId === iconId) {
      mounted.targetActive = isActive;
      mounted.setActive(isActive);
    }
  }
}

export function removeTabIconState(iconId: string) {
  iconActiveStates.delete(iconId);
}

function disposeTabIcon(surfaceId: number) {
  const mountedIcon = mountedIcons.get(surfaceId);
  if (!mountedIcon) return;
  mountedIcons.delete(surfaceId);
  try {
    mountedIcon.dispose();
  } catch (error) {
    console.error("[RuneRouter] disposeTabIcon failed", error);
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
