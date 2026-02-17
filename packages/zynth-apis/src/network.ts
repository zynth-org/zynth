import { callNativeSync, getGlobalObject, sharedNativeEventEmitter } from "@zynth/core";

const MODULE_NAME = "ZynthNetworkCore";
const EVENT_NAME = "zynth.network.change";

export type NetworkType =
  | "none"
  | "wifi"
  | "cellular"
  | "ethernet"
  | "bluetooth"
  | "vpn"
  | "other"
  | "unknown";

export type NetworkState = Readonly<{
  isConnected: boolean;
  isInternetReachable: boolean;
  type: NetworkType;
  isExpensive: boolean;
}>;

type NetworkPayload = {
  isConnected?: unknown;
  isInternetReachable?: unknown;
  type?: unknown;
  connectionType?: unknown;
  isExpensive?: unknown;
};

type NetworkListener = (state: NetworkState) => void;

const DEFAULT_STATE: NetworkState = Object.freeze({
  isConnected: false,
  isInternetReachable: false,
  type: "unknown",
  isExpensive: false,
});

function normalizeType(value: unknown): NetworkType {
  if (typeof value !== "string") {
    return "unknown";
  }
  const normalized = value.toLowerCase();
  if (
    normalized === "none" ||
    normalized === "wifi" ||
    normalized === "cellular" ||
    normalized === "ethernet" ||
    normalized === "bluetooth" ||
    normalized === "vpn" ||
    normalized === "other" ||
    normalized === "unknown"
  ) {
    return normalized;
  }
  return "unknown";
}

function normalizeBoolean(value: unknown): boolean {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  if (typeof value === "string") {
    const normalized = value.toLowerCase();
    if (normalized === "true" || normalized === "1") return true;
    if (normalized === "false" || normalized === "0") return false;
  }
  return false;
}

function normalizeState(value: unknown): NetworkState | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  const payload = value as NetworkPayload;
  const isConnected = normalizeBoolean(payload.isConnected);
  const isInternetReachable = normalizeBoolean(payload.isInternetReachable);
  const type = normalizeType(payload.type ?? payload.connectionType);
  const isExpensive = normalizeBoolean(payload.isExpensive);

  return Object.freeze({
    isConnected,
    isInternetReachable,
    type,
    isExpensive,
  });
}

function readNativeConstants(): NetworkState | null {
  const constants = getGlobalObject().NativeConstants as
    | Record<string, unknown>
    | undefined;
  if (!constants) return null;
  return normalizeState(constants[MODULE_NAME]);
}

function readFromBridge(): NetworkState | null {
  try {
    const result = callNativeSync<unknown>(MODULE_NAME, "current");
    return normalizeState(result);
  } catch {
    return null;
  }
}

function readWebState(): NetworkState | null {
  if (typeof navigator === "undefined") {
    return null;
  }
  const maybeConnection = (navigator as { connection?: { metered?: boolean } }).connection;
  const isConnected = navigator.onLine ?? true;
  return Object.freeze({
    isConnected,
    isInternetReachable: isConnected,
    type: isConnected ? "unknown" : "none",
    isExpensive: Boolean(maybeConnection?.metered),
  });
}

let currentState: NetworkState =
  readNativeConstants() ?? readFromBridge() ?? readWebState() ?? DEFAULT_STATE;

const listeners = new Set<NetworkListener>();

function emit(nextState: NetworkState): void {
  if (
    currentState.isConnected === nextState.isConnected &&
    currentState.isInternetReachable === nextState.isInternetReachable &&
    currentState.type === nextState.type &&
    currentState.isExpensive === nextState.isExpensive
  ) {
    return;
  }
  currentState = nextState;
  const snapshot = Array.from(listeners);
  for (const listener of snapshot) {
    listener(nextState);
  }
}

sharedNativeEventEmitter.addListener(EVENT_NAME, (payload) => {
  const parsed = normalizeState(payload);
  if (parsed) {
    emit(parsed);
  }
});

if (typeof window !== "undefined" && typeof window.addEventListener === "function") {
  const updateFromWeb = () => {
    const state = readWebState();
    if (state) {
      emit(state);
    }
  };
  window.addEventListener("online", updateFromWeb);
  window.addEventListener("offline", updateFromWeb);
}

type NetworkSubscription = {
  remove(): void;
};

export const Network = Object.freeze({
  get currentState(): NetworkState {
    return currentState;
  },
  addEventListener(
    type: "change",
    listener: NetworkListener
  ): NetworkSubscription {
    if (type !== "change") {
      throw new Error(`[Network] Unsupported event type: ${type}`);
    }
    listeners.add(listener);
    listener(currentState);
    return {
      remove() {
        listeners.delete(listener);
      },
    };
  },
  subscribe(listener: NetworkListener): () => void {
    listeners.add(listener);
    listener(currentState);
    return () => listeners.delete(listener);
  },
  refresh(): NetworkState {
    const next =
      readFromBridge() ?? readNativeConstants() ?? readWebState() ?? currentState;
    emit(next);
    return currentState;
  },
});
