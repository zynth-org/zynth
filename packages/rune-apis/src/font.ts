type ModulesBridge = {
  call?(
    name: string,
    method: string,
    args?: unknown
  ): Promise<unknown> | unknown;
};

function getGlobalObject(): Record<string, unknown> {
  if (typeof globalThis !== "undefined") {
    return globalThis as any;
  }
  try {
    const fallback = Function("return this")();
    if (fallback && typeof fallback === "object") {
      return fallback as Record<string, unknown>;
    }
  } catch {
    // ignore
  }
  return {};
}

function getModulesBridge(): ModulesBridge | null {
  const globalObj = getGlobalObject();
  const maybeBridge = globalObj.__modules;
  if (!maybeBridge || typeof maybeBridge !== "object") {
    return null;
  }
  return maybeBridge as ModulesBridge;
}

export const Font = {
  loadAsync: async (
    fontFamily: string,
    resourceName: string
  ): Promise<void> => {
    const bridge = getModulesBridge();
    if (!bridge || !bridge.call) {
      console.warn(
        "[Rune] Native modules bridge not available. Font loading skipped."
      );
      return;
    }

    try {
      await bridge.call("Font", "loadAsync", {
        fontFamily,
        resourceName,
      });
    } catch (error) {
      console.error(
        `[Rune] Failed to load font '${fontFamily}' (${resourceName}):`,
        error
      );
      throw error;
    }
  },
};
