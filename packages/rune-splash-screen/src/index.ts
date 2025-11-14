type ModulesBridge = {
  call?(
    name: string,
    method: string,
    args?: unknown
  ): Promise<unknown> | unknown;
  callSync?(name: string, method: string, args?: unknown): unknown;
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

function isErrorResult(value: unknown): value is { error: string } {
  if (!value || typeof value !== "object") return false;
  return typeof (value as { error?: unknown }).error === "string";
}

async function callBridge(
  method: "preventAutoHide" | "hide"
): Promise<boolean> {
  const bridge = getModulesBridge();
  if (!bridge || !bridge.call) {
    console.warn("[RuneSplashScreen] Native modules bridge not available.");
    return false;
  }

  try {
    if (method === "preventAutoHide" && bridge.callSync) {
      try {
        const result = bridge.callSync("RuneSplashScreen", method, {});
        if (isErrorResult(result)) {
          throw new Error(result.error);
        }
        return true;
      } catch (error) {
        console.warn(
          "[RuneSplashScreen] callSync preventAutoHide failed; falling back to async.",
          error
        );
      }
    }
    const result = await bridge.call("RuneSplashScreen", method, {});
    if (isErrorResult(result)) {
      throw new Error(result.error);
    }
    return true;
  } catch (error) {
    console.error(`[RuneSplashScreen] Failed to ${method}():`, error);
    return false;
  }
}

export const SplashScreen = {
  preventAutoHideAsync(): Promise<boolean> {
    return callBridge("preventAutoHide");
  },
  hideAsync(): Promise<boolean> {
    return callBridge("hide");
  },
};
