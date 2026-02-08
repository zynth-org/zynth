import { callNative, isNativeAvailable } from "./native";
import type {
  WebServerActiveUpload,
  WebServerEvent,
  WebServerInfo,
  WebServerStartOptions,
  WebServerSubscribeOptions,
  WebServerSubscription,
  WebServerSubscriptionSnapshot,
  WebServerUploadState,
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
  uploadMetadataPath?: string | null;
  uploadAuthToken?: string | null;
  uploadAuthHeader?: string | null;
  uploadAuthQueryKey?: string | null;
  maxUploadBytes?: number | null;
  eventsPath?: string | null;
};

const DEFAULT_HOST = "0.0.0.0";
const DEFAULT_UPLOAD_PATH = "/__zynth/upload";
const DEFAULT_EVENTS_PATH = "/__zynth/events";
const DEFAULT_POLL_INTERVAL_MS = 500;
const DEFAULT_MAX_EVENTS = 50;

function resolvePath(value: string | undefined, fallback: string): string {
  if (typeof value !== "string") {
    return fallback;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : fallback;
}

function resolveOptionalPath(value: string | undefined): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
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
    uploadMetadataPath: uploadEnabled
      ? resolveOptionalPath(options?.upload?.metadataPath)
      : null,
    uploadAuthToken: uploadEnabled ? options?.upload?.authToken ?? null : null,
    uploadAuthHeader: uploadEnabled
      ? options?.upload?.authTokenHeader ?? null
      : null,
    uploadAuthQueryKey: uploadEnabled
      ? options?.upload?.authTokenQueryParam ?? null
      : null,
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
    type:
      event.type === "upload_started" ||
      event.type === "upload_progress" ||
      event.type === "upload_completed" ||
      event.type === "upload_failed" ||
      event.type === "upload_metadata"
        ? event.type
        : "message",
    payload,
    rawPayload,
  };
}

function normalizeUploadState(value: unknown): WebServerUploadState {
  const fallback: WebServerUploadState = {
    activeCount: 0,
    totalStarted: 0,
    totalCompleted: 0,
    totalFailed: 0,
    totalBytesReceived: 0,
    activeUploads: [],
  };
  if (!value || typeof value !== "object") {
    return fallback;
  }
  const record = value as Record<string, unknown>;
  const activeUploadsRaw = Array.isArray(record.activeUploads)
    ? record.activeUploads
    : [];

  const activeUploads: WebServerActiveUpload[] = activeUploadsRaw
    .map((upload) => {
      if (!upload || typeof upload !== "object") {
        return null;
      }
      const node = upload as Record<string, unknown>;
      return {
        uploadId:
          typeof node.uploadId === "number" ? Math.round(node.uploadId) : 0,
        name: typeof node.name === "string" ? node.name : "",
        path: typeof node.path === "string" ? node.path : "",
        bytesReceived:
          typeof node.bytesReceived === "number"
            ? Math.round(node.bytesReceived)
            : 0,
        totalBytes:
          typeof node.totalBytes === "number" ? Math.round(node.totalBytes) : 0,
        startedAt:
          typeof node.startedAt === "number" ? Math.round(node.startedAt) : 0,
        updatedAt:
          typeof node.updatedAt === "number" ? Math.round(node.updatedAt) : 0,
      };
    })
    .filter((entry): entry is WebServerActiveUpload => Boolean(entry));

  return {
    activeCount:
      typeof record.activeCount === "number"
        ? Math.round(record.activeCount)
        : activeUploads.length,
    totalStarted:
      typeof record.totalStarted === "number"
        ? Math.round(record.totalStarted)
        : 0,
    totalCompleted:
      typeof record.totalCompleted === "number"
        ? Math.round(record.totalCompleted)
        : 0,
    totalFailed:
      typeof record.totalFailed === "number" ? Math.round(record.totalFailed) : 0,
    totalBytesReceived:
      typeof record.totalBytesReceived === "number"
        ? Math.round(record.totalBytesReceived)
        : 0,
    activeUploads,
  };
}

async function ensureAvailable(): Promise<void> {
  if (!isNativeAvailable()) {
    throw new Error("WebServer is not available on this platform");
  }
}

async function createSnapshot(
  maxEvents: number,
  includeUploadState: boolean
): Promise<WebServerSubscriptionSnapshot> {
  const running = await WebServer.isRunning().catch(() => false);
  const info = await WebServer.getInfo().catch(() => null);
  const events = await WebServer.drainEvents(maxEvents).catch(() => []);
  const uploadState = includeUploadState
    ? await WebServer.getUploadState().catch(() => normalizeUploadState(null))
    : normalizeUploadState(null);

  return {
    timestamp: Date.now(),
    running,
    info,
    uploadState,
    events,
  };
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
  async getUploadState(): Promise<WebServerUploadState> {
    if (!isNativeAvailable()) {
      return normalizeUploadState(null);
    }
    const state = await callNative<unknown>("getUploadState", {});
    return normalizeUploadState(state);
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
  subscribe(
    listener: (snapshot: WebServerSubscriptionSnapshot) => void,
    options?: WebServerSubscribeOptions
  ): WebServerSubscription {
    const pollIntervalMs =
      typeof options?.pollIntervalMs === "number" && options.pollIntervalMs > 0
        ? Math.round(options.pollIntervalMs)
        : DEFAULT_POLL_INTERVAL_MS;
    const maxEvents =
      typeof options?.maxEvents === "number" && options.maxEvents > 0
        ? Math.round(options.maxEvents)
        : DEFAULT_MAX_EVENTS;
    const includeUploadState = options?.includeUploadState !== false;

    let disposed = false;
    let inflight = false;

    const run = async () => {
      if (disposed || inflight) {
        return;
      }
      inflight = true;
      try {
        const snapshot = await createSnapshot(maxEvents, includeUploadState);
        if (!disposed) {
          listener(snapshot);
        }
      } catch {
        // no-op by design for polling subscription
      } finally {
        inflight = false;
      }
    };

    const timer = setInterval(() => {
      void run();
    }, pollIntervalMs);

    if (options?.emitImmediately !== false) {
      void run();
    }

    return {
      remove() {
        if (disposed) {
          return;
        }
        disposed = true;
        clearInterval(timer);
      },
    };
  },
  isAvailable(): boolean {
    return isNativeAvailable();
  },
};

export { WebServer };
