type AbortListener = () => void;

declare const global: any;

class AbortSignalPolyfill {
  aborted = false;
  onabort: AbortListener | null = null;
  private listeners = new Set<AbortListener>();

  addEventListener(_type: "abort", listener: AbortListener): void {
    this.listeners.add(listener);
  }

  removeEventListener(_type: "abort", listener: AbortListener): void {
    this.listeners.delete(listener);
  }

  dispatchEvent(): boolean {
    if (this.onabort) {
      try {
        this.onabort();
      } catch (_) {}
    }
    for (const listener of Array.from(this.listeners)) {
      try {
        listener();
      } catch (_) {}
    }
    return true;
  }
}

class AbortControllerPolyfill {
  readonly signal: AbortSignalPolyfill;

  constructor() {
    this.signal = new AbortSignalPolyfill();
  }

  abort(): void {
    if (this.signal.aborted) {
      return;
    }
    this.signal.aborted = true;
    this.signal.dispatchEvent();
  }
}

const globalObject =
  typeof globalThis !== "undefined"
    ? (globalThis as any)
    : typeof window !== "undefined"
    ? (window as any)
    : typeof global !== "undefined"
    ? (global as any)
    : ({} as any);

if (globalObject && typeof globalObject.AbortController !== "function") {
  // console.log("[ZynthCore] Polyfilling AbortController");
  globalObject.AbortController = AbortControllerPolyfill;
  globalObject.AbortSignal = AbortSignalPolyfill;
}

export {
  AbortControllerPolyfill as AbortController,
  AbortSignalPolyfill as AbortSignal,
};
