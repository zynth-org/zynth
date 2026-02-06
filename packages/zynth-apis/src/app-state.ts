import {
  callNativeSync,
  getGlobalObject,
  sharedNativeEventEmitter,
} from "@zynth/core";

const MODULE_NAME = "AppState";
const EVENT_NAME = "zynth.appstate.change";

export type AppStateStatus = "active" | "background" | "inactive";

type AppStatePayload = {
  state?: unknown;
  appState?: unknown;
};

type AppStateConstants = {
  state?: unknown;
  currentState?: unknown;
};

type AppStateListener = (nextState: AppStateStatus) => void;

function normalizeAppState(value: unknown): AppStateStatus | null {
  if (typeof value !== "string") {
    return null;
  }
  const normalized = value.toLowerCase();
  if (
    normalized === "active" ||
    normalized === "background" ||
    normalized === "inactive"
  ) {
    return normalized;
  }
  return null;
}

function readNativeConstants(): AppStateStatus | null {
  const constants = getGlobalObject().NativeConstants as
    | Record<string, unknown>
    | undefined;
  if (!constants) return null;
  const snapshot = constants[MODULE_NAME] as AppStateConstants | undefined;
  if (!snapshot || typeof snapshot !== "object") {
    return null;
  }
  return normalizeAppState(snapshot.state ?? snapshot.currentState);
}

function readFromBridge(): AppStateStatus | null {
  try {
    const result = callNativeSync<AppStatePayload>(MODULE_NAME, "current");
    if (result && typeof result === "object") {
      return normalizeAppState(result.state ?? result.appState);
    }
  } catch (err) {
    return null;
  }
  return null;
}

function readFromDocument(): AppStateStatus | null {
  if (typeof document === "undefined") return null;
  if (document.visibilityState === "hidden") {
    return "background";
  }
  return "active";
}

const listeners = new Set<AppStateListener>();

function emit(nextState: AppStateStatus): void {
  if (nextState === currentState) return;
  currentState = nextState;
  const snapshot = Array.from(listeners);
  for (const listener of snapshot) {
    listener(nextState);
  }
}

sharedNativeEventEmitter.addListener(EVENT_NAME, (payload) => {
  if (typeof payload === "string") {
    const parsed = normalizeAppState(payload);
    if (parsed) emit(parsed);
    return;
  }
  if (!payload || typeof payload !== "object") return;
  const value = payload as AppStatePayload;
  const parsed = normalizeAppState(value.state ?? value.appState);
  if (parsed) emit(parsed);
});

let currentState: AppStateStatus =
  readFromBridge() ?? readNativeConstants() ?? readFromDocument() ?? "active";

if (typeof document !== "undefined" && typeof document.addEventListener === "function") {
  document.addEventListener("visibilitychange", () => {
    const fromDocument = readFromDocument();
    if (fromDocument) emit(fromDocument);
  });
}

// Safety check: The native module might emit the initial "active" event
// before this JS module has fully initialized its listeners.
// Trigger a manual refresh shortly after startup to ensure we catch up.
setTimeout(() => {
  AppState.refresh();
}, 600);

type AppStateSubscription = {
  remove(): void;
};

export const AppState = Object.freeze({
  get currentState(): AppStateStatus {
    return currentState;
  },
  addEventListener(
    type: "change",
    listener: AppStateListener,
  ): AppStateSubscription {
    if (type !== "change") {
      throw new Error(`[AppState] Unsupported event type: ${type}`);
    }
    const initial = AppState.refresh();
    listeners.add(listener);
    listener(initial);
    return {
      remove() {
        listeners.delete(listener);
      },
    };
  },
  subscribe(listener: AppStateListener): () => void {
    const initial = AppState.refresh();
    listeners.add(listener);
    listener(initial);
    return () => listeners.delete(listener);
  },
      refresh(): AppStateStatus {
        const fromBridge = readFromBridge();
        if (fromBridge) {
          emit(fromBridge);
          return currentState;
        }
        // Do NOT fallback to readNativeConstants() here. 
        // Constants are snapshot at startup and are likely stale (inactive).
        // If bridge fails, trust the last event or current state.
        
        const fromDocument = readFromDocument();
        if (fromDocument) {
          emit(fromDocument);
          return currentState;
        }
        return currentState;
      },});
