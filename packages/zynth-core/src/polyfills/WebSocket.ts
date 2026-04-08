import { callNative } from "../bridge";
import { ensureNativeEmitter } from "../nativeEmitter";

const SOCKET_EVENT = "zynth.websocket.event";

export type ZynthWebSocketEventType =
  | "open"
  | "message"
  | "error"
  | "close";

export type ZynthWebSocketEvent = {
  type: ZynthWebSocketEventType;
  target: WebSocket;
};

export type ZynthWebSocketMessageEvent = ZynthWebSocketEvent & {
  data: string;
};

export type ZynthWebSocketCloseEvent = ZynthWebSocketEvent & {
  code: number;
  reason: string;
  wasClean: boolean;
};

export type ZynthWebSocketErrorEvent = ZynthWebSocketEvent & {
  message: string;
};

type Listener = (event: ZynthWebSocketEvent) => void;
type ListenerMap = Map<ZynthWebSocketEventType, Set<Listener>>;
type NativeSocketPayload = {
  id?: unknown;
  type?: unknown;
  data?: unknown;
  code?: unknown;
  reason?: unknown;
  wasClean?: unknown;
  message?: unknown;
};

type RuntimeGlobal = Record<string, unknown> & {
  __ZYNTH_HMR_DEBUG?: unknown;
};

declare const __ZYNTH_HMR_DEBUG: boolean | undefined;

const sockets = new Map<number, WebSocket>();
let nextSocketId = 1;
let nativeSubscriptionInstalled = false;

function getGlobalObject(): RuntimeGlobal {
  if (typeof globalThis !== "undefined") {
    return globalThis as RuntimeGlobal;
  }
  return {};
}

function isDebugEnabled(): boolean {
  if (
    typeof __ZYNTH_HMR_DEBUG !== "undefined" &&
    __ZYNTH_HMR_DEBUG === true
  ) {
    return true;
  }
  const flag = getGlobalObject().__ZYNTH_HMR_DEBUG;
  return flag === true || flag === "true" || flag === 1 || flag === "1";
}

function describeMessage(data: unknown): unknown {
  if (typeof data !== "string") return { bytes: 0 };
  try {
    const parsed = JSON.parse(data) as unknown;
    if (parsed && typeof parsed === "object") {
      const record = parsed as Record<string, unknown>;
      return {
        type: record.type,
        hasData: record.data != null,
        bytes: data.length,
      };
    }
  } catch {
    return { bytes: data.length };
  }
  return { bytes: data.length };
}

function debugLog(message: string, ...details: unknown[]): void {
  if (!isDebugEnabled()) return;
  console.log("[Zynth WebSocket]", message, ...details);
}

function installNativeSubscription(): void {
  if (nativeSubscriptionInstalled) return;
  nativeSubscriptionInstalled = true;
  debugLog("install native subscription");
  ensureNativeEmitter().addListener(SOCKET_EVENT, (payload) => {
    if (!payload || typeof payload !== "object") return;
    const data = payload as NativeSocketPayload;
    if (typeof data.id !== "number") return;
    const socket = sockets.get(data.id);
    if (!socket) return;
    socket.handleNativeEvent(data);
  });
}

function dispatchHandler(
  handler: ((event: ZynthWebSocketEvent) => void) | null,
  event: ZynthWebSocketEvent,
): void {
  if (typeof handler !== "function") return;
  try {
    handler(event);
  } catch (error) {
    setTimeout(() => {
      throw error;
    }, 0);
  }
}

/**
 * Browser-compatible WebSocket backed by Zynth native networking.
 *
 * v1 supports text frames and the EventTarget-style API needed by Rsbuild HMR.
 * Binary frames are intentionally unsupported until the native wire contract is
 * expanded for ArrayBuffer/Blob payloads.
 */
export class WebSocket {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;

  readonly CONNECTING = WebSocket.CONNECTING;
  readonly OPEN = WebSocket.OPEN;
  readonly CLOSING = WebSocket.CLOSING;
  readonly CLOSED = WebSocket.CLOSED;

  readonly url: string;
  readonly protocol = "";
  readonly extensions = "";
  readonly bufferedAmount = 0;

  binaryType: "arraybuffer" | "blob" = "arraybuffer";
  readyState = WebSocket.CONNECTING;
  onopen: ((event: ZynthWebSocketEvent) => void) | null = null;
  onmessage: ((event: ZynthWebSocketMessageEvent) => void) | null = null;
  onerror: ((event: ZynthWebSocketErrorEvent) => void) | null = null;
  onclose: ((event: ZynthWebSocketCloseEvent) => void) | null = null;

  private readonly id = nextSocketId++;
  private readonly listeners: ListenerMap = new Map();

  constructor(url: string | { toString(): string }, protocols?: string | string[]) {
    installNativeSubscription();
    this.url = String(url);
    sockets.set(this.id, this);
    debugLog("connect", {
      id: this.id,
      url: this.url,
      protocols: Array.isArray(protocols)
        ? protocols
        : typeof protocols === "string"
          ? [protocols]
          : [],
    });
    void callNative("WebSocket", "connect", {
      id: this.id,
      url: this.url,
      protocols: Array.isArray(protocols)
        ? protocols
        : typeof protocols === "string"
          ? [protocols]
          : [],
    }).catch((error) => {
      this.handleNativeEvent({
        id: this.id,
        type: "error",
        message: error instanceof Error ? error.message : String(error),
      });
      this.handleNativeEvent({
        id: this.id,
        type: "close",
        code: 1006,
        reason: "connect failed",
        wasClean: false,
      });
    });
  }

  send(data: string): void {
    if (this.readyState !== WebSocket.OPEN) {
      throw new Error("WebSocket is not open");
    }
    if (typeof data !== "string") {
      throw new TypeError("Zynth WebSocket v1 only supports string payloads");
    }
    debugLog("send", { id: this.id, message: describeMessage(data) });
    void callNative("WebSocket", "send", { id: this.id, data }).catch((error) => {
      this.emitError(error instanceof Error ? error.message : String(error));
    });
  }

  close(code = 1000, reason = ""): void {
    if (
      this.readyState === WebSocket.CLOSING ||
      this.readyState === WebSocket.CLOSED
    ) {
      return;
    }
    this.readyState = WebSocket.CLOSING;
    debugLog("close requested", { id: this.id, code, reason });
    void callNative("WebSocket", "close", { id: this.id, code, reason }).catch(
      (error) => {
        this.emitError(error instanceof Error ? error.message : String(error));
      },
    );
  }

  addEventListener(type: ZynthWebSocketEventType, listener: Listener): void {
    if (typeof listener !== "function") return;
    let listeners = this.listeners.get(type);
    if (!listeners) {
      listeners = new Set();
      this.listeners.set(type, listeners);
    }
    listeners.add(listener);
  }

  removeEventListener(type: ZynthWebSocketEventType, listener: Listener): void {
    this.listeners.get(type)?.delete(listener);
  }

  dispatchEvent(event: ZynthWebSocketEvent): boolean {
    const listeners = this.listeners.get(event.type);
    if (listeners) {
      for (const listener of Array.from(listeners)) {
        listener(event);
      }
    }
    switch (event.type) {
      case "open":
        dispatchHandler(this.onopen, event);
        break;
      case "message":
        dispatchHandler(
          this.onmessage as ((event: ZynthWebSocketEvent) => void) | null,
          event,
        );
        break;
      case "error":
        dispatchHandler(
          this.onerror as ((event: ZynthWebSocketEvent) => void) | null,
          event,
        );
        break;
      case "close":
        dispatchHandler(
          this.onclose as ((event: ZynthWebSocketEvent) => void) | null,
          event,
        );
        break;
    }
    return true;
  }

  handleNativeEvent(payload: NativeSocketPayload): void {
    const type = payload.type;
    if (type === "open") {
      this.readyState = WebSocket.OPEN;
      debugLog("open", { id: this.id, url: this.url });
      this.dispatchEvent({ type: "open", target: this });
      return;
    }
    if (type === "message") {
      debugLog("message", {
        id: this.id,
        message: describeMessage(payload.data),
      });
      this.dispatchEvent({
        type: "message",
        target: this,
        data: typeof payload.data === "string" ? payload.data : "",
      } as ZynthWebSocketMessageEvent);
      return;
    }
    if (type === "error") {
      debugLog("error", {
        id: this.id,
        message: typeof payload.message === "string" ? payload.message : undefined,
      });
      this.emitError(
        typeof payload.message === "string" ? payload.message : "WebSocket error",
      );
      return;
    }
    if (type === "close") {
      this.readyState = WebSocket.CLOSED;
      sockets.delete(this.id);
      debugLog("close", {
        id: this.id,
        code: payload.code,
        reason: payload.reason,
        wasClean: payload.wasClean,
      });
      this.dispatchEvent({
        type: "close",
        target: this,
        code: typeof payload.code === "number" ? payload.code : 1000,
        reason: typeof payload.reason === "string" ? payload.reason : "",
        wasClean:
          typeof payload.wasClean === "boolean" ? payload.wasClean : true,
      } as ZynthWebSocketCloseEvent);
    }
  }

  private emitError(message: string): void {
    this.dispatchEvent({
      type: "error",
      target: this,
      message,
    } as ZynthWebSocketErrorEvent);
  }
}

export function installWebSocket(): void {
  const globalObject = getGlobalObject();
  if (typeof globalObject.WebSocket !== "function") {
    globalObject.WebSocket = WebSocket;
  }
}

installWebSocket();
