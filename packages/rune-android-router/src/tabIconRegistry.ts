import type { JSX } from "solid-js";

type IconFactory = () => JSX.Element;

const iconRegistry = new Map<string, IconFactory>();

export function registerTabIcon(iconId: string, factory: IconFactory): () => void {
  iconRegistry.set(iconId, factory);
  return () => {
    const current = iconRegistry.get(iconId);
    if (current === factory) {
      iconRegistry.delete(iconId);
    }
  };
}

export function getTabIconFactory(iconId: string): IconFactory | undefined {
  return iconRegistry.get(iconId);
}
