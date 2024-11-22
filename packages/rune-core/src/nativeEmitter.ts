declare const global: any;

export type NativeEventListener = (payload: unknown) => void;
export type NativeEventSubscription = { remove(): void };

export type RuneNativeEmitterBridge = {
  emit(eventName: string, payload: unknown): void;
  addListener(
    eventName: string,
    callback: NativeEventListener
  ): NativeEventSubscription;
  removeListener(eventName: string, callback: NativeEventListener): void;
};

const listeners = new Map<string, Set<NativeEventListener>>();

function emitToListeners(eventName: string, payload: unknown): void {
  const callbacks = listeners.get(eventName);
  if (!callbacks || callbacks.size === 0) {
    return;
  }

  // Copy to array to prevent mutation during iteration affecting dispatch order.
  const snapshot = Array.from(callbacks);
  for (const listener of snapshot) {
    try {
      listener(payload);
    } catch (error) {
      console.error(
        `[RuneNativeEmitter] listener for ${eventName} threw`,
        error
      );
    }
  }
}

function addListenerInternal(
  eventName: string,
  callback: NativeEventListener
): NativeEventSubscription {
  if (typeof callback !== "function") {
    throw new TypeError("NativeEventEmitter listener must be a function");
  }

  let callbacks = listeners.get(eventName);
  if (!callbacks) {
    callbacks = new Set();
    listeners.set(eventName, callbacks);
  }
  callbacks.add(callback);

  let removed = false;
  return {
    remove() {
      if (removed) return;
      removed = true;
      removeListenerInternal(eventName, callback);
    },
  };
}

function removeListenerInternal(
  eventName: string,
  callback: NativeEventListener
): void {
  const callbacks = listeners.get(eventName);
  if (!callbacks) {
    return;
  }

  callbacks.delete(callback);
  if (callbacks.size === 0) {
    listeners.delete(eventName);
  }
}

const emitterBridge: RuneNativeEmitterBridge = {
  emit: emitToListeners,
  addListener: addListenerInternal,
  removeListener: removeListenerInternal,
};

function getGlobalObject(): any {
  if (typeof globalThis !== "undefined") return globalThis as any;
  if (typeof global !== "undefined") return global as any;
  if (typeof window !== "undefined") return window as any;
  return {};
}

export function ensureNativeEmitter(): RuneNativeEmitterBridge {
  const g = getGlobalObject();
  const existing = g.RuneNativeEmitter as RuneNativeEmitterBridge | undefined;

  if (
    !existing ||
    typeof existing.emit !== "function" ||
    typeof existing.addListener !== "function" ||
    typeof existing.removeListener !== "function"
  ) {
    Object.defineProperty(g, "RuneNativeEmitter", {
      configurable: true,
      enumerable: false,
      writable: true,
      value: emitterBridge,
    });
    return emitterBridge;
  }

  return existing;
}

ensureNativeEmitter();

export class NativeEventEmitter {
  private readonly target: RuneNativeEmitterBridge;

  constructor(target: RuneNativeEmitterBridge = ensureNativeEmitter()) {
    this.target = target;
  }

  addListener(
    eventName: string,
    callback: NativeEventListener
  ): NativeEventSubscription {
    return this.target.addListener(eventName, callback);
  }

  removeListener(eventName: string, callback: NativeEventListener): void {
    this.target.removeListener(eventName, callback);
  }
}

export const sharedNativeEventEmitter = new NativeEventEmitter();
