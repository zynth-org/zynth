import { callNative, isNativeAvailable } from "./native";
import type {
  ExportFileOptions,
  ExportFileResult,
  OpenFileOptions,
  ShareFilesOptions,
} from "./types";

type NativeEventSubscription = { remove(): void };

type ZynthNativeEmitterBridge = {
  addListener(
    eventName: string,
    callback: (payload: unknown) => void
  ): NativeEventSubscription;
};

type NativeExportResult = {
  requestId?: string;
  cancelled?: boolean;
  destinationUri?: string;
  error?: string;
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
  const typed = emitter as Partial<ZynthNativeEmitterBridge>;
  if (typeof typed.addListener !== "function") {
    return null;
  }
  return typed as ZynthNativeEmitterBridge;
}

function createRequestId(): string {
  return `file-intents-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function assertUri(uri: string, field: string): void {
  if (typeof uri !== "string" || uri.trim().length === 0) {
    throw new Error(`[FileIntents] ${field} must be a non-empty string`);
  }
  const trimmed = uri.trim();
  if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) {
    throw new Error(`[FileIntents] ${field} must reference local file/content data, not network URLs`);
  }
}

function normalizeFiles(input: ShareFilesOptions): Array<{ uri: string; mimeType?: string; filename?: string }> {
  const files = Array.isArray(input.files) ? input.files : [];
  if (files.length > 32) {
    throw new Error("[FileIntents] shareAsync supports up to 32 files per request");
  }
  return files
    .filter((file) => file && typeof file.uri === "string" && file.uri.trim().length > 0)
    .map((file) => ({
      uri: file.uri.trim(),
      mimeType: file.mimeType ?? undefined,
      filename: file.filename ?? undefined,
    }));
}

function normalizeExportResult(payload: NativeExportResult): ExportFileResult {
  return {
    cancelled: payload.cancelled === true,
    destinationUri:
      typeof payload.destinationUri === "string" && payload.destinationUri.length > 0
        ? payload.destinationUri
        : undefined,
  };
}

export const FileIntents = {
  isAvailable(): boolean {
    return isNativeAvailable();
  },

  async openAsync(options: OpenFileOptions): Promise<void> {
    assertUri(options.uri, "options.uri");
    await callNative("openAsync", {
      uri: options.uri.trim(),
      mimeType: options.mimeType ?? undefined,
      filename: options.filename ?? undefined,
    });
  },

  async shareAsync(options: ShareFilesOptions): Promise<void> {
    const files = normalizeFiles(options);
    if (files.length === 0 && (!options.text || options.text.trim().length === 0)) {
      throw new Error("[FileIntents] shareAsync requires at least one file or non-empty text");
    }

    await callNative("shareAsync", {
      files,
      text: options.text ?? undefined,
      subject: options.subject ?? undefined,
    });
  },

  async exportAsync(options: ExportFileOptions): Promise<ExportFileResult> {
    assertUri(options.uri, "options.uri");
    const requestId = createRequestId();

    return new Promise<ExportFileResult>((resolve, reject) => {
      const emitter = getNativeEmitter();
      if (!emitter) {
        reject(new Error("[FileIntents] Native event emitter not available"));
        return;
      }

      const subscription = emitter.addListener("FileIntents.result", (payload: unknown) => {
        if (!payload || typeof payload !== "object") return;
        const value = payload as NativeExportResult;
        if (value.requestId !== requestId) return;

        subscription.remove();
        if (typeof value.error === "string" && value.error.length > 0) {
          reject(new Error(value.error));
          return;
        }
        resolve(normalizeExportResult(value));
      });

      void callNative("exportAsync", {
        requestId,
        uri: options.uri.trim(),
        mimeType: options.mimeType ?? undefined,
        suggestedName: options.suggestedName ?? undefined,
        target: options.target,
      }).catch((error: unknown) => {
        subscription.remove();
        reject(error instanceof Error ? error : new Error(String(error)));
      });
    });
  },
};
