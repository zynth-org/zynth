import { callNative, getPlatformName, isNativeAvailable } from "./native";
import type { OpenBrowserOptions, WebBrowserDismissResult, WebBrowserResult } from "./types";

type NativeWebBrowserResult = {
  requestId?: string;
  type?: unknown;
  url?: unknown;
  errorCode?: unknown;
  errorMessage?: unknown;
};

type NativeEventSubscription = { remove(): void };

type ZynthNativeEmitterBridge = {
  addListener(eventName: string, callback: (payload: unknown) => void): NativeEventSubscription;
};

function getGlobalObject(): Record<string, unknown> {
  if (typeof globalThis !== "undefined") {
    return globalThis as Record<string, unknown>;
  }
  return {};
}

function getNativeEmitter(): ZynthNativeEmitterBridge | null {
  const globalObj = getGlobalObject() as { ZynthNativeEmitter?: unknown };
  const emitter = globalObj.ZynthNativeEmitter;
  if (!emitter || typeof emitter !== "object") {
    return null;
  }
  const candidate = emitter as Partial<ZynthNativeEmitterBridge>;
  if (typeof candidate.addListener !== "function") {
    return null;
  }
  return candidate as ZynthNativeEmitterBridge;
}

function createRequestId(): string {
  return `webbrowser-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function normalizeResult(payload: NativeWebBrowserResult): WebBrowserResult {
  const type = payload.type;
  if (type !== "opened" && type !== "cancel" && type !== "dismiss" && type !== "error") {
    return {
      type: "error",
      errorCode: "E_INVALID_RESULT",
      errorMessage: "Invalid native WebBrowser result",
    };
  }

  return {
    type,
    url: typeof payload.url === "string" ? payload.url : undefined,
    errorCode: typeof payload.errorCode === "string" ? payload.errorCode : undefined,
    errorMessage: typeof payload.errorMessage === "string" ? payload.errorMessage : undefined,
  };
}

function validateOpenOptions(options: OpenBrowserOptions): void {
  if (!options || typeof options !== "object") {
    throw new Error("[WebBrowser] options are required");
  }
  if (typeof options.url !== "string" || options.url.trim().length === 0) {
    throw new Error("[WebBrowser] options.url must be a non-empty string");
  }
}

export const WebBrowser = Object.freeze({
  async openBrowserAsync(options: OpenBrowserOptions): Promise<WebBrowserResult> {
    validateOpenOptions(options);

    if (!isNativeAvailable()) {
      if (typeof window === "undefined" || typeof window.open !== "function") {
        return {
          type: "error",
          errorCode: "E_UNAVAILABLE",
          errorMessage: "Web browser is not available on this runtime",
        };
      }

      const popup = window.open(options.url, "_blank", "noopener,noreferrer");
      if (!popup) {
        return {
          type: "error",
          errorCode: "E_OPEN_FAILED",
          errorMessage: "Browser popup was blocked or failed to open",
        };
      }
      return { type: "opened", url: options.url };
    }

    const requestId = createRequestId();
    return new Promise<WebBrowserResult>((resolve, reject) => {
      const emitter = getNativeEmitter();
      if (!emitter) {
        reject(new Error("[WebBrowser] Native event emitter not available"));
        return;
      }

      const subscription = emitter.addListener("WebBrowser.result", (payload: unknown) => {
        if (!payload || typeof payload !== "object") {
          return;
        }
        const value = payload as NativeWebBrowserResult;
        if (value.requestId !== requestId) {
          return;
        }
        subscription.remove();
        resolve(normalizeResult(value));
      });

      void callNative<unknown>("openBrowserAsync", {
        requestId,
        options,
      }).catch((error: unknown) => {
        subscription.remove();
        reject(error instanceof Error ? error : new Error(String(error)));
      });
    });
  },

  async dismissBrowser(): Promise<WebBrowserDismissResult> {
    if (!isNativeAvailable()) {
      return { dismissed: false };
    }

    const result = await callNative<unknown>("dismissBrowser", {});
    if (!result || typeof result !== "object") {
      return { dismissed: false };
    }

    const value = result as { dismissed?: unknown };
    return { dismissed: value.dismissed === true };
  },

  async warmUpAsync(): Promise<void> {
    if (!isNativeAvailable() || getPlatformName() !== "android") {
      return;
    }
    await callNative<unknown>("warmUpAsync", {});
  },

  async coolDownAsync(): Promise<void> {
    if (!isNativeAvailable() || getPlatformName() !== "android") {
      return;
    }
    await callNative<unknown>("coolDownAsync", {});
  },

  isAvailable(): boolean {
    if (isNativeAvailable()) {
      return true;
    }
    return typeof window !== "undefined" && typeof window.open === "function";
  },
});
