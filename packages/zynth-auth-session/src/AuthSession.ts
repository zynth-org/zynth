import { callNative, isNativeAvailable } from "./native";
import type {
  AuthSessionDismissResult,
  AuthSessionRequest,
  AuthSessionResult,
  MakeRedirectUriOptions,
} from "./types";

type NativeEventSubscription = { remove(): void };

type ZynthNativeEmitterBridge = {
  addListener(eventName: string, callback: (payload: unknown) => void): NativeEventSubscription;
};

type NativeAuthSessionResult = {
  requestId?: string;
  type?: unknown;
  url?: unknown;
  errorCode?: unknown;
  errorMessage?: unknown;
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
  const candidate = emitter as Partial<ZynthNativeEmitterBridge>;
  if (typeof candidate.addListener !== "function") {
    return null;
  }
  return candidate as ZynthNativeEmitterBridge;
}

function createRequestId(): string {
  return `authsession-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function normalizeParams(url: string | undefined): Record<string, string> | undefined {
  if (!url) {
    return undefined;
  }

  const parsed = new URL(url);
  const params: Record<string, string> = {};
  parsed.searchParams.forEach((value, key) => {
    params[key] = value;
  });

  const fragment = parsed.hash.startsWith("#") ? parsed.hash.slice(1) : parsed.hash;
  if (fragment.length > 0) {
    const hashParams = new URLSearchParams(fragment);
    hashParams.forEach((value, key) => {
      params[key] = value;
    });
  }

  return Object.keys(params).length > 0 ? params : undefined;
}

function normalizeResult(payload: NativeAuthSessionResult): AuthSessionResult {
  const type = payload.type;
  if (type !== "success" && type !== "cancel" && type !== "dismiss" && type !== "error") {
    return {
      type: "error",
      errorCode: "E_INVALID_RESULT",
      errorMessage: "Invalid native AuthSession result",
    };
  }

  const url = typeof payload.url === "string" ? payload.url : undefined;
  return {
    type,
    url,
    params: normalizeParams(url),
    errorCode: typeof payload.errorCode === "string" ? payload.errorCode : undefined,
    errorMessage: typeof payload.errorMessage === "string" ? payload.errorMessage : undefined,
  };
}

function validateRequest(request: AuthSessionRequest): void {
  if (!request || typeof request !== "object") {
    throw new Error("[AuthSession] request is required");
  }
  if (typeof request.authUrl !== "string" || request.authUrl.trim().length === 0) {
    throw new Error("[AuthSession] request.authUrl must be a non-empty string");
  }
  if (typeof request.redirectUri !== "string" || request.redirectUri.trim().length === 0) {
    throw new Error("[AuthSession] request.redirectUri must be a non-empty string");
  }
  let authUrl: URL;
  let redirectUrl: URL;
  try {
    authUrl = new URL(request.authUrl);
  } catch {
    throw new Error("[AuthSession] request.authUrl must be a valid URL");
  }
  if (authUrl.protocol.toLowerCase() !== "https:") {
    throw new Error("[AuthSession] request.authUrl must use https");
  }
  try {
    redirectUrl = new URL(request.redirectUri);
  } catch {
    throw new Error("[AuthSession] request.redirectUri must be a valid URL");
  }
  if (!redirectUrl.protocol || redirectUrl.protocol.length === 0) {
    throw new Error("[AuthSession] request.redirectUri must include a scheme");
  }
}

function openWebPopup(request: AuthSessionRequest): AuthSessionResult {
  if (typeof window === "undefined" || typeof window.open !== "function") {
    return {
      type: "error",
      errorCode: "E_UNAVAILABLE",
      errorMessage: "AuthSession is not available on this runtime",
    };
  }

  const popup = window.open(request.authUrl, "_blank", "noopener,noreferrer");
  if (!popup) {
    return {
      type: "error",
      errorCode: "E_OPEN_FAILED",
      errorMessage: "Browser popup was blocked or failed to open",
    };
  }

  return {
    type: "error",
    errorCode: "E_WEB_UNSUPPORTED",
    errorMessage: "Web fallback cannot securely capture redirects in this runtime",
  };
}

function buildUriFromParts(options: MakeRedirectUriOptions): string {
  const scheme = options.scheme?.trim();
  if (!scheme) {
    throw new Error("[AuthSession] makeRedirectUri requires options.scheme when options.native is not provided");
  }

  const host = (options.host ?? "").trim();
  const path = (options.path ?? "").replace(/^\/+/, "");
  const base = host.length > 0 ? `${scheme}://${host}` : `${scheme}:///`;
  const pathname = path.length > 0 ? path : "";

  const url = new URL(pathname.length > 0 ? `${base}${pathname}` : base);
  const queryParams = options.queryParams ?? {};
  for (const key of Object.keys(queryParams)) {
    const value = queryParams[key];
    url.searchParams.set(key, value);
  }
  return url.toString();
}

export const AuthSession = Object.freeze({
  async startAsync(request: AuthSessionRequest): Promise<AuthSessionResult> {
    validateRequest(request);

    if (!isNativeAvailable()) {
      return openWebPopup(request);
    }

    const requestId = createRequestId();

    return new Promise<AuthSessionResult>((resolve, reject) => {
      const emitter = getNativeEmitter();
      if (!emitter) {
        reject(new Error("[AuthSession] Native event emitter not available"));
        return;
      }

      let didSettle = false;
      const timeoutMs = typeof request.timeoutMs === "number" && request.timeoutMs > 0
        ? Math.floor(request.timeoutMs)
        : 0;
      const timer = timeoutMs > 0
        ? setTimeout(() => {
            if (didSettle) return;
            didSettle = true;
            subscription.remove();
            void callNative<unknown>("dismissAuthSession", {});
            resolve({
              type: "error",
              errorCode: "E_TIMEOUT",
              errorMessage: `Auth session timed out after ${timeoutMs}ms`,
            });
          }, timeoutMs)
        : null;

      const subscription = emitter.addListener("AuthSession.result", (payload: unknown) => {
        if (didSettle) {
          return;
        }
        if (!payload || typeof payload !== "object") {
          return;
        }
        const value = payload as NativeAuthSessionResult;
        if (value.requestId !== requestId) {
          return;
        }
        didSettle = true;
        if (timer) clearTimeout(timer);
        subscription.remove();
        resolve(normalizeResult(value));
      });

      void callNative<unknown>("openAuthSession", {
        requestId,
        request,
      }).catch((error: unknown) => {
        if (didSettle) {
          return;
        }
        didSettle = true;
        if (timer) clearTimeout(timer);
        subscription.remove();
        reject(error instanceof Error ? error : new Error(String(error)));
      });
    });
  },

  async dismissAuthSession(): Promise<AuthSessionDismissResult> {
    if (!isNativeAvailable()) {
      return { dismissed: false };
    }

    const result = await callNative<unknown>("dismissAuthSession", {});
    if (!result || typeof result !== "object") {
      return { dismissed: false };
    }

    const value = result as { dismissed?: unknown };
    return { dismissed: value.dismissed === true };
  },

  makeRedirectUri(options: MakeRedirectUriOptions): string {
    if (typeof options.native === "string" && options.native.trim().length > 0) {
      return options.native;
    }
    return buildUriFromParts(options);
  },

  isAvailable(): boolean {
    if (isNativeAvailable()) {
      return true;
    }
    return typeof window !== "undefined" && typeof window.open === "function";
  },
});
