declare const __ZYNTH_PLATFORM__: string;

const isWebPlatform = __ZYNTH_PLATFORM__ === "web";

export function registerWebAdapter(loader: () => Promise<unknown>): void {
  if (!isWebPlatform) {
    return;
  }
  const registry = ((globalThis as any).__zynth_web_registry_promises ??=
    []) as Promise<unknown>[];
  registry.push(loader());
}
