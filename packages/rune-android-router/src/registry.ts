import type { ScreenRegistration } from "./types";

const registry = new Map<string, ScreenRegistration>();
const listeners = new Set<() => void>();

function notify() {
  listeners.forEach((listener) => {
    try {
      listener();
    } catch (error) {
      console.error("[RuneAndroidRouter] registry listener failed", error);
    }
  });
}

export function registerScreenDefinition(
  definition: ScreenRegistration
): () => void {
  registry.set(definition.name, definition);
  notify();
  return () => {
    const current = registry.get(definition.name);
    if (current === definition) {
      registry.delete(definition.name);
      notify();
    }
  };
}

export function listScreenDefinitions(): ScreenRegistration[] {
  return Array.from(registry.values());
}

export function findScreenDefinition(
  name: string
): ScreenRegistration | undefined {
  return registry.get(name);
}

export function subscribeScreenRegistry(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
