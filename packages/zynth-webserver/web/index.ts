import { createSignal } from "solid-js";
import type {
  WebServerActiveUpload,
  WebServerEvent,
  WebServerInfo,
  WebServerManagedTlsCertificate,
  WebServerManagedTlsCertificateInfo,
  WebServerStartOptions,
  WebServerStatus,
  WebServerSubscribeOptions,
  WebServerSubscription,
  WebServerSubscriptionSnapshot,
  WebServerUploadState,
} from "../src/types";
import type { WebServerSignal } from "../src/signal";

const WARN_MSG = "[ZynthWebServer] WebServer is not supported on the web platform.";

const WebServer = {
  async start(_options?: WebServerStartOptions): Promise<WebServerInfo> {
    console.warn(WARN_MSG);
    return {
      host: "localhost",
      port: 0,
      url: "http://localhost:0",
      scheme: "http",
      secureTransport: false,
    };
  },
  async upsertManagedTlsCertificate(_options?: any): Promise<WebServerManagedTlsCertificateInfo> {
    console.warn(WARN_MSG);
    return {
      alias: "default",
      certificatePath: "",
      fingerprintSha256: "",
      updatedAt: Date.now(),
      existed: false,
    };
  },
  async getManagedTlsCertificate(_alias?: string): Promise<WebServerManagedTlsCertificate | null> {
    console.warn(WARN_MSG);
    return null;
  },
  async stop(): Promise<void> {
    console.warn(WARN_MSG);
  },
  async isRunning(): Promise<boolean> {
    console.warn(WARN_MSG);
    return false;
  },
  async getInfo(): Promise<WebServerInfo | null> {
    console.warn(WARN_MSG);
    return null;
  },
  async getUploadState(): Promise<WebServerUploadState> {
    console.warn(WARN_MSG);
    return {
      activeCount: 0,
      totalStarted: 0,
      totalCompleted: 0,
      totalFailed: 0,
      totalBytesReceived: 0,
      activeUploads: [],
    };
  },
  async drainEvents(_maxEvents = 50): Promise<WebServerEvent[]> {
    console.warn(WARN_MSG);
    return [];
  },
  async setSignal(_key: string, _payload: unknown): Promise<void> {
    console.warn(WARN_MSG);
  },
  async getSignal<T = unknown>(_key: string, _consume = true): Promise<T | null> {
    console.warn(WARN_MSG);
    return null;
  },
  getSignalPath(): string {
    return "/__zynth/signal";
  },
  async setReply(_key: string, _payload: unknown): Promise<void> {
    console.warn(WARN_MSG);
  },
  async getReply<T = unknown>(_key: string, _consume = true): Promise<T | null> {
    console.warn(WARN_MSG);
    return null;
  },
  getReplyPath(): string {
    return "/__zynth/reply";
  },
  subscribe(
    listener: (snapshot: WebServerSubscriptionSnapshot) => void,
    options?: WebServerSubscribeOptions
  ): WebServerSubscription {
    console.warn(WARN_MSG);

    // Minimal subscription logic that just emits once if requested
    if (options?.emitImmediately !== false) {
      setTimeout(() => {
        listener({
          timestamp: Date.now(),
          running: false,
          info: null,
          uploadState: {
            activeCount: 0,
            totalStarted: 0,
            totalCompleted: 0,
            totalFailed: 0,
            totalBytesReceived: 0,
            activeUploads: [],
          },
          events: [],
        });
      }, 0);
    }

    return {
      remove() {
        // no-op
      },
    };
  },
  isAvailable(): boolean {
    return false;
  },
};

export function createWebServerSignal(): WebServerSignal {
  const [status] = createSignal<WebServerStatus>("idle");
  const [info] = createSignal<WebServerInfo | null>(null);
  const [error] = createSignal<Error | null>(null);

  return {
    status,
    info,
    error,
    start: async (options) => WebServer.start(options),
    stop: async () => WebServer.stop(),
    pollEvents: async (maxEvents) => WebServer.drainEvents(maxEvents),
    getUploadState: async () => WebServer.getUploadState(),
    setSignal: async (key, payload) => WebServer.setSignal(key, payload),
    getSignal: async (key, consume) => WebServer.getSignal(key, consume),
    setReply: async (key, payload) => WebServer.setReply(key, payload),
    getReply: async (key, consume) => WebServer.getReply(key, consume),
    subscribe: (listener, options) => WebServer.subscribe(listener, options),
  };
}

export { WebServer };
export { WebServer as default };
