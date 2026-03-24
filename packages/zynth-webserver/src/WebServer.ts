import { callNative, isNativeAvailable } from "./native";
import type {
  WebServerActiveUpload,
  WebServerEvent,
  WebServerInfo,
  WebServerManagedTlsCertificate,
  WebServerManagedTlsCertificateInfo,
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
  tlsEnabled?: boolean;
  tlsCertificate?: string | null;
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

type NativeManagedTlsCertificateInfo = {
  alias: string;
  certificatePath: string;
  fingerprintSha256: string;
  updatedAt: number;
  existed: boolean;
};

type NativeManagedTlsCertificate = {
  alias: string;
  certificatePath: string;
  certificatePem: string;
  fingerprintSha256: string;
  updatedAt: number;
};

const DEFAULT_HOST = "0.0.0.0";
const DEFAULT_UPLOAD_PATH = "/__zynth/upload";
const DEFAULT_EVENTS_PATH = "/__zynth/events";
const DEFAULT_SIGNAL_PATH = "/__zynth/signal";
const DEFAULT_REPLY_PATH = "/__zynth/reply";
const DEFAULT_POLL_INTERVAL_MS = 500;
const DEFAULT_MAX_EVENTS = 50;
const DEFAULT_SERVER_AUTH_HEADER = "X-Zynth-Server-Token";
const DEFAULT_SERVER_AUTH_QUERY_KEY = "token";
const DEFAULT_MANAGED_TLS_ALIAS = "default";
const DEFAULT_MANAGED_TLS_ROTATE_MS = 30 * 24 * 60 * 60 * 1000;

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

function isDevelopmentRuntime(): boolean {
  const globalObject = getGlobalObject();
  if (globalObject.__DEV__ === true) {
    return true;
  }
  const processValue = globalObject.process as
    | { env?: { NODE_ENV?: unknown } }
    | undefined;
  if (processValue && typeof processValue === "object") {
    const env = processValue.env?.NODE_ENV;
    if (typeof env === "string" && env.toLowerCase() !== "production") {
      return true;
    }
  }
  return false;
}

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

function normalizeNativeFilePath(value: string | undefined): string | null {
  const candidate = resolveOptionalPath(value);
  if (!candidate) {
    return null;
  }
  if (!candidate.startsWith("file://")) {
    return candidate;
  }
  try {
    const parsed = new URL(candidate);
    if (parsed.protocol === "file:") {
      return decodeURIComponent(parsed.pathname);
    }
  } catch {
    // Fallback below.
  }
  return decodeURIComponent(candidate.replace(/^file:\/\//, ""));
}

function normalizeManagedTlsCertificateInfo(
  value: unknown
): WebServerManagedTlsCertificateInfo {
  if (!value || typeof value !== "object") {
    throw new Error("Invalid managed TLS certificate payload");
  }
  const record = value as Record<string, unknown>;
  const alias =
    typeof record.alias === "string" && record.alias.trim().length > 0
      ? record.alias.trim()
      : DEFAULT_MANAGED_TLS_ALIAS;
  const certificatePath =
    typeof record.certificatePath === "string" ? record.certificatePath.trim() : "";
  const fingerprintSha256 =
    typeof record.fingerprintSha256 === "string"
      ? record.fingerprintSha256.trim()
      : "";
  const updatedAt =
    typeof record.updatedAt === "number" && Number.isFinite(record.updatedAt)
      ? Math.round(record.updatedAt)
      : Date.now();
  const existed = record.existed === true;
  if (!certificatePath || !fingerprintSha256) {
    throw new Error("Invalid managed TLS certificate payload");
  }
  return {
    alias,
    certificatePath,
    fingerprintSha256,
    updatedAt,
    existed,
  };
}

function normalizeManagedTlsCertificate(
  value: unknown
): WebServerManagedTlsCertificate {
  if (!value || typeof value !== "object") {
    throw new Error("Invalid managed TLS certificate payload");
  }
  const record = value as Record<string, unknown>;
  const alias =
    typeof record.alias === "string" && record.alias.trim().length > 0
      ? record.alias.trim()
      : DEFAULT_MANAGED_TLS_ALIAS;
  const certificatePath =
    typeof record.certificatePath === "string" ? record.certificatePath.trim() : "";
  const certificatePem =
    typeof record.certificatePem === "string" ? record.certificatePem.trim() : "";
  const fingerprintSha256 =
    typeof record.fingerprintSha256 === "string"
      ? record.fingerprintSha256.trim()
      : "";
  const updatedAt =
    typeof record.updatedAt === "number" && Number.isFinite(record.updatedAt)
      ? Math.round(record.updatedAt)
      : Date.now();
  if (!certificatePath || !certificatePem || !fingerprintSha256) {
    throw new Error("Invalid managed TLS certificate payload");
  }
  return {
    alias,
    certificatePath,
    certificatePem,
    fingerprintSha256,
    updatedAt,
  };
}

async function resolveTlsCertificatePath(
  options?: WebServerStartOptions
): Promise<string | null> {
  const directPath = normalizeNativeFilePath(options?.tls?.certificatePath);
  if (directPath) {
    return directPath;
  }
  const managed = options?.tls?.managed;
  const inlinePem = resolveOptionalString(options?.tls?.certificatePem);
  if (!managed && !inlinePem) {
    return null;
  }
  const alias = resolveAlias(managed?.alias);
  const rotateAfterMs = normalizeRotateAfterMs(managed?.rotateAfterMs);
  const providedPem =
    resolveOptionalString(managed?.pem) ??
    (typeof managed?.getPem === "function"
      ? resolveOptionalString(await managed.getPem())
      : null) ??
    inlinePem;
  const generateIfMissing = managed?.autoGenerate !== false && !providedPem;
  const commonName = resolveOptionalString(managed?.commonName) ?? "localhost";
  const validDays = normalizeValidDays(managed?.validDays);
  const created = await callNative<NativeManagedTlsCertificateInfo>(
    "upsertManagedTlsCertificate",
    {
      alias,
      pem: providedPem,
      rotateAfterMs,
      generateIfMissing,
      commonName,
      validDays,
    }
  );
  return normalizeManagedTlsCertificateInfo(created).certificatePath;
}

function resolveOptionalString(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function resolveAlias(value: unknown): string {
  const alias = resolveOptionalString(value);
  return alias ?? DEFAULT_MANAGED_TLS_ALIAS;
}

function normalizeRotateAfterMs(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    return DEFAULT_MANAGED_TLS_ROTATE_MS;
  }
  return Math.round(value);
}

function normalizeValidDays(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    return 365;
  }
  const rounded = Math.round(value);
  if (rounded > 3650) {
    return 3650;
  }
  return rounded;
}

async function normalizeStartOptions(
  options?: WebServerStartOptions
): Promise<NativeWebServerStartArgs> {
  const tlsEnabled = options?.tls?.enabled === true;
  const tlsCertificate = tlsEnabled ? await resolveTlsCertificatePath(options) : null;
  if (tlsEnabled && !tlsCertificate) {
    throw new Error(
      "tls.certificatePath is required when tls.enabled=true unless managed TLS is configured"
    );
  }

  const allowInsecureHttp =
    options?.security?.allowInsecureHttp ??
    (isDevelopmentRuntime() || tlsEnabled);
  if (!tlsEnabled && !allowInsecureHttp) {
    throw new Error(
      "WebServer insecure HTTP is blocked in this runtime. Set security.allowInsecureHttp=true only when you explicitly accept insecure transport."
    );
  }

  const uploadEnabled = options?.upload?.enabled !== false;
  const eventsEnabled = options?.events?.enabled !== false;
  const serverAuthToken = options?.security?.authToken ?? options?.upload?.authToken;
  const serverAuthHeader =
    options?.security?.authTokenHeader ??
    options?.upload?.authTokenHeader ??
    DEFAULT_SERVER_AUTH_HEADER;
  const serverAuthQueryKey =
    options?.security?.authTokenQueryParam ??
    options?.upload?.authTokenQueryParam ??
    DEFAULT_SERVER_AUTH_QUERY_KEY;

  return {
    host: options?.host ?? DEFAULT_HOST,
    port: options?.port,
    tlsEnabled,
    tlsCertificate,
    documentRoot: normalizeNativeFilePath(options?.documentRoot),
    indexHtml: options?.indexHtml ?? null,
    uploadPath: uploadEnabled
      ? resolvePath(options?.upload?.path, DEFAULT_UPLOAD_PATH)
      : null,
    uploadDir: uploadEnabled
      ? normalizeNativeFilePath(options?.upload?.directory)
      : null,
    uploadMetadataPath: uploadEnabled
      ? normalizeNativeFilePath(options?.upload?.metadataPath)
      : null,
    uploadAuthToken: serverAuthToken ?? null,
    uploadAuthHeader: serverAuthToken ? serverAuthHeader : null,
    uploadAuthQueryKey: serverAuthToken ? serverAuthQueryKey : null,
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
    const args = await normalizeStartOptions(options);
    return callNative<WebServerInfo>("start", args);
  },
  async upsertManagedTlsCertificate(options?: {
    alias?: string;
    pem?: string;
    rotateAfterMs?: number;
    generateIfMissing?: boolean;
    commonName?: string;
    validDays?: number;
  }): Promise<WebServerManagedTlsCertificateInfo> {
    await ensureAvailable();
    const pem = resolveOptionalString(options?.pem);
    if (!pem && options?.generateIfMissing !== true) {
      throw new Error("pem is required unless generateIfMissing=true");
    }
    const result = await callNative<unknown>("upsertManagedTlsCertificate", {
      alias: resolveAlias(options?.alias),
      pem,
      rotateAfterMs: normalizeRotateAfterMs(options?.rotateAfterMs),
      generateIfMissing: options?.generateIfMissing === true,
      commonName: resolveOptionalString(options?.commonName) ?? "localhost",
      validDays: normalizeValidDays(options?.validDays),
    });
    return normalizeManagedTlsCertificateInfo(result);
  },
  async getManagedTlsCertificate(
    alias = DEFAULT_MANAGED_TLS_ALIAS
  ): Promise<WebServerManagedTlsCertificate | null> {
    await ensureAvailable();
    const result = await callNative<NativeManagedTlsCertificate | null>(
      "getManagedTlsCertificate",
      {
        alias: resolveAlias(alias),
      }
    );
    return result ? normalizeManagedTlsCertificate(result) : null;
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
  async setSignal(key: string, payload: unknown): Promise<void> {
    await ensureAvailable();
    const normalizedKey = key.trim();
    if (!normalizedKey) {
      throw new Error("WebServer.setSignal requires a non-empty key");
    }
    const payloadJson = JSON.stringify(payload ?? null);
    const ok = await callNative<boolean>("setSignal", {
      key: normalizedKey,
      payloadJson,
    });
    if (!ok) {
      throw new Error(`Failed to store signal for key "${normalizedKey}"`);
    }
  },
  async getSignal<T = unknown>(key: string, consume = true): Promise<T | null> {
    if (!isNativeAvailable()) {
      return null;
    }
    const normalizedKey = key.trim();
    if (!normalizedKey) {
      return null;
    }
    const result = await callNative<T | null>("getSignal", {
      key: normalizedKey,
      consume,
    });
    return result ?? null;
  },
  getSignalPath(): string {
    return DEFAULT_SIGNAL_PATH;
  },
  async setReply(key: string, payload: unknown): Promise<void> {
    await WebServer.setSignal(key, payload);
  },
  async getReply<T = unknown>(key: string, consume = true): Promise<T | null> {
    return WebServer.getSignal<T>(key, consume);
  },
  getReplyPath(): string {
    return DEFAULT_REPLY_PATH;
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
