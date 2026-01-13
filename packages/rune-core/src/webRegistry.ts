declare const __RUNE_PLATFORM__: string;

const isWebPlatform = __RUNE_PLATFORM__ === "web";

export function registerWebAdapter(loader: () => Promise<unknown>): void {
  if (!isWebPlatform) {
    return;
  }
  const registry = ((globalThis as any).__rune_web_registry_promises ??=
    []) as Promise<unknown>[];
  registry.push(loader());
}
