import {
  getHost,
  render,
  setActiveSurface,
  getActiveSurface,
} from "@rune/core";
import { Platform, OS } from "@rune/apis";
import type { HostNode } from "@rune/core";
import { createSignal } from "solid-js";
import { getTabIconFactory } from "./tabIconRegistry";
import { TabIconWrapper } from "./tabIconWrapper";

type MountedIcon = {
  iconId: string;
  dispose: () => void;
  setActive: (value: boolean) => void;
};

const mountedIcons = new Map<number, MountedIcon>();

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
    console.warn(`[RuneAndroidRouter] Icon ${iconId} is not registered.`);
    return false;
  }

  const current = mountedIcons.get(surfaceId);
  if (current?.iconId === iconId) {
    current.setActive(isActive);
    return true;
  }

  current?.dispose();

  console.log(
    "[RuneAndroidRouter/nativeRenderer] renderTabIcon",
    surfaceId,
    iconId
  );
  const [activeState, setActiveState] = createSignal(isActive);
  let disposeFn: () => void = () => {};
  runWithSurface(surfaceId, () => {
    disposeFn = render(
      () => <TabIconWrapper>{factory({ active: activeState() })}</TabIconWrapper>,
      createSurfaceContainer(surfaceId)
    );
    flushHostQueue();
  });
  mountedIcons.set(surfaceId, {
    iconId,
    dispose: () => {
      runWithSurface(surfaceId, () => {
        disposeFn();
        flushHostQueue();
      });
    },
    setActive(value: boolean) {
      if (activeState() === value) return;
      runWithSurface(surfaceId, () => {
        setActiveState(value);
        flushHostQueue();
      });
    },
  });
  return true;
}

function disposeTabIcon(surfaceId: number) {
  const mountedIcon = mountedIcons.get(surfaceId);
  if (!mountedIcon) return;
  mountedIcons.delete(surfaceId);
  try {
    mountedIcon.dispose();
  } catch (error) {
    console.error("[RuneAndroidRouter] disposeTabIcon failed", error);
  }
}

export function installIconRenderer() {
  if (Platform.OS !== OS.ANDROID) {
    return;
  }
  const globalObj = globalThis as Record<string, unknown>;
  const existing = Object.getOwnPropertyDescriptor(globalObj, "__renderTabIcon");
  if (existing && typeof existing.value === "function") {
    return;
  }
  try {
    Object.defineProperties(globalObj, {
      __renderTabIcon: {
        value: renderTabIcon,
        enumerable: false,
        configurable: true,
        writable: false,
      },
      __disposeTabIcon: {
        value: disposeTabIcon,
        enumerable: false,
        configurable: true,
        writable: false,
      },
    });
  } catch (error) {
    console.error(
      "[RuneAndroidRouter] Failed to install tab icon renderer",
      (error as Error)?.message ?? error
    );
  }
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
