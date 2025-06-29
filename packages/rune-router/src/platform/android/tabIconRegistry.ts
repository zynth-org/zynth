import type { TabIconFactory } from "./types";

const iconRegistry = new Map<string, TabIconFactory>();

export function registerTabIcon(iconId: string, factory: TabIconFactory): () => void {
  iconRegistry.set(iconId, factory);
  return () => {
    const current = iconRegistry.get(iconId);
    if (current === factory) {
      iconRegistry.delete(iconId);
    }
  };
}

export function getTabIconFactory(iconId: string): TabIconFactory | undefined {
  return iconRegistry.get(iconId);
}
