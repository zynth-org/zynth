import { callNative, isNativeAvailable } from "./native";
import type {
  WebServerEvent,
  WebServerInfo,
  WebServerStartOptions,
} from "./types";

type NativeWebServerEvent = {
  type: string;
  payload: string;
};

type NativeWebServerStartArgs = {
  host?: string;
  port?: number;
  documentRoot?: string | null;
  indexHtml?: string | null;
  uploadPath?: string | null;
  uploadDir?: string | null;
  maxUploadBytes?: number | null;
  eventsPath?: string | null;
};

const DEFAULT_HOST = "0.0.0.0";
const DEFAULT_UPLOAD_PATH = "/__zynth/upload";
const DEFAULT_EVENTS_PATH = "/__zynth/events";

function resolvePath(value: string | undefined, fallback: string): string {
  if (typeof value !== "string") {
    return fallback;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : fallback;
}

function normalizeStartOptions(
  options?: WebServerStartOptions
): NativeWebServerStartArgs {
  const uploadEnabled = options?.upload?.enabled !== false;
  const eventsEnabled = options?.events?.enabled !== false;

  return {
    host: options?.host ?? DEFAULT_HOST,
    port: options?.port,
    documentRoot: options?.documentRoot ?? null,
    indexHtml: options?.indexHtml ?? null,
    uploadPath: uploadEnabled
      ? resolvePath(options?.upload?.path, DEFAULT_UPLOAD_PATH)
      : null,
    uploadDir: uploadEnabled ? options?.upload?.directory ?? null : null,
    maxUploadBytes: uploadEnabled ? options?.upload?.maxBytes ?? null : null,
    eventsPath: eventsEnabled
      ? resolvePath(options?.events?.path, DEFAULT_EVENTS_PATH)
      : null,
  };
}

function parseEvent(event: NativeWebServerEvent): WebServerEvent {
  const rawPayload =
    typeof event.payload === "string" ? event.payload : String(event.payload ?? "");
  let payload: unknown = rawPayload;
  if (rawPayload) {
    try {
      payload = JSON.parse(rawPayload);
    } catch {
      payload = rawPayload;
    }
  }
  return {
    type: event.type === "upload" ? "upload" : "message",
    payload,
    rawPayload,
  };
}

async function ensureAvailable(): Promise<void> {
  if (!isNativeAvailable()) {
    throw new Error("WebServer is not available on this platform");
  }
}

const WebServer = {
  async start(options?: WebServerStartOptions): Promise<WebServerInfo> {
    await ensureAvailable();
    const args = normalizeStartOptions(options);
    return callNative<WebServerInfo>("start", args);
  },
  async stop(): Promise<void> {
    await ensureAvailable();
    await callNative<void>("stop", {});
  },
  async isRunning(): Promise<boolean> {
    if (!isNativeAvailable()) {
      return false;
    }
    return callNative<boolean>("isRunning", {});
  },
  async getInfo(): Promise<WebServerInfo | null> {
    if (!isNativeAvailable()) {
      return null;
    }
    return callNative<WebServerInfo | null>("getInfo", {});
  },
  async drainEvents(maxEvents = 50): Promise<WebServerEvent[]> {
    if (!isNativeAvailable()) {
      return [];
    }
    const result = await callNative<NativeWebServerEvent[] | null>(
      "drainEvents",
      { maxEvents }
    );
    if (!Array.isArray(result)) {
      return [];
    }
    return result.map(parseEvent);
  },
  isAvailable(): boolean {
    return isNativeAvailable();
  },
};

export { WebServer };
