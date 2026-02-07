import { callNative, isNativeAvailable } from "./native";
import type {
  DocumentPickerAsset,
  DocumentPickerOptions,
  DocumentPickerResult,
} from "./types";

type NativeDocumentPickerResult = {
  requestId?: string;
  cancelled?: boolean;
  assets?: unknown;
  error?: string;
};

type NativeEventSubscription = { remove(): void };

type ZynthNativeEmitterBridge = {
  addListener(
    eventName: string,
    callback: (payload: unknown) => void
  ): NativeEventSubscription;
};

function getGlobalObject(): Record<string, unknown> {
  if (typeof globalThis !== "undefined") {
    return globalThis as Record<string, unknown>;
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

function getNativeEmitter(): ZynthNativeEmitterBridge | null {
  const globalObj = getGlobalObject() as { ZynthNativeEmitter?: unknown };
  const emitter = globalObj.ZynthNativeEmitter;
  if (!emitter || typeof emitter !== "object") {
    return null;
  }
  const typed = emitter as Partial<ZynthNativeEmitterBridge>;
  if (typeof typed.addListener !== "function") {
    return null;
  }
  return typed as ZynthNativeEmitterBridge;
}

function createRequestId(): string {
  return `docpick-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function normalizeAssets(value: unknown): DocumentPickerAsset[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const assets: DocumentPickerAsset[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") {
      continue;
    }
    const record = item as Record<string, unknown>;
    const uri = typeof record.uri === "string" ? record.uri : null;
    if (!uri) {
      continue;
    }
    assets.push({
      uri,
      name: typeof record.name === "string" ? record.name : null,
      mimeType: typeof record.mimeType === "string" ? record.mimeType : null,
      size: typeof record.size === "number" ? record.size : null,
    });
  }
  return assets;
}

function normalizeResult(payload: NativeDocumentPickerResult): DocumentPickerResult {
  const cancelled = payload.cancelled === true;
  return {
    cancelled,
    assets: cancelled ? [] : normalizeAssets(payload.assets),
  };
}

export const DocumentPicker = {
  async getDocumentAsync(
    options?: DocumentPickerOptions
  ): Promise<DocumentPickerResult> {
    if (!isNativeAvailable()) {
      return { cancelled: true, assets: [] };
    }

    const requestId = createRequestId();

    return new Promise<DocumentPickerResult>((resolve, reject) => {
      const emitter = getNativeEmitter();
      if (!emitter) {
        reject(new Error("Native event emitter not available"));
        return;
      }

      const subscription = emitter.addListener(
        "DocumentPicker.result",
        (payload: unknown) => {
          if (!payload || typeof payload !== "object") {
            return;
          }
          const value = payload as NativeDocumentPickerResult;
          if (value.requestId !== requestId) {
            return;
          }
          subscription.remove();
          if (typeof value.error === "string" && value.error.length > 0) {
            reject(new Error(value.error));
            return;
          }
          resolve(normalizeResult(value));
        }
      );

      void callNative<unknown>("pickDocumentAsync", {
        requestId,
        options: options ?? {},
      }).catch((error: unknown) => {
        subscription.remove();
        reject(error instanceof Error ? error : new Error(String(error)));
      });
    });
  },

  isAvailable(): boolean {
    return isNativeAvailable();
  },
};
