import { Crypto, isCryptoAvailable as isZynthCryptoAvailable } from "@zynth/crypto";
import { callNative, isNativeAvailable } from "./native";
import type {
  AuthSessionDismissResult,
  AuthSessionErrorCode,
  AuthSessionPkcePair,
  AuthSessionRequest,
  AuthSessionResult,
  BuildAuthorizationUrlOptions,
  CreatePkceOptions,
  CreateStateOptions,
  MakeRedirectUriOptions,
  ValidateAuthSessionResponseOptions,
  ValidateAuthSessionResponseResult,
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

const PKCE_VERIFIER_MIN_BYTES = 32;
const PKCE_VERIFIER_MAX_BYTES = 96;
const STATE_MIN_BYTES = 16;
const STATE_MAX_BYTES = 64;
const BASE64_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

const CRYPTO_UNAVAILABLE_WARNING =
  "[AuthSession] Crypto is unavailable. PKCE/state helpers require @zynth/crypto with native installation (or a compatible global crypto implementation).";

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

function createError(code: AuthSessionErrorCode, message: string): Error {
  const error = new Error(`[AuthSession] ${message}`) as Error & { code?: AuthSessionErrorCode };
  error.code = code;
  return error;
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
    errorCode: "E_WEB_FALLBACK_OPENED",
    errorMessage:
      "Insecure web popup fallback opened. Redirect capture remains unsupported in this runtime.",
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

function bytesToBase64(bytes: Uint8Array): string {
  if (bytes.byteLength === 0) {
    return "";
  }

  let output = "";
  let index = 0;
  for (; index + 2 < bytes.byteLength; index += 3) {
    const chunk = (bytes[index] << 16) | (bytes[index + 1] << 8) | bytes[index + 2];
    output += BASE64_ALPHABET[(chunk >> 18) & 63];
    output += BASE64_ALPHABET[(chunk >> 12) & 63];
    output += BASE64_ALPHABET[(chunk >> 6) & 63];
    output += BASE64_ALPHABET[chunk & 63];
  }

  const remaining = bytes.byteLength - index;
  if (remaining === 1) {
    const chunk = bytes[index] << 16;
    output += BASE64_ALPHABET[(chunk >> 18) & 63];
    output += BASE64_ALPHABET[(chunk >> 12) & 63];
    output += "==";
  } else if (remaining === 2) {
    const chunk = (bytes[index] << 16) | (bytes[index + 1] << 8);
    output += BASE64_ALPHABET[(chunk >> 18) & 63];
    output += BASE64_ALPHABET[(chunk >> 12) & 63];
    output += BASE64_ALPHABET[(chunk >> 6) & 63];
    output += "=";
  }

  return output;
}

function toBase64Url(bytes: Uint8Array): string {
  return bytesToBase64(bytes).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function assertIntegerInRange(value: number, min: number, max: number, label: string): number {
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new Error(`[AuthSession] ${label} must be an integer between ${min} and ${max}`);
  }
  return value;
}

function ensureCryptoAvailable(): void {
  if (!isZynthCryptoAvailable()) {
    throw createError("E_CRYPTO_UNAVAILABLE", CRYPTO_UNAVAILABLE_WARNING);
  }
}

function getRandomBytes(size: number): Uint8Array {
  ensureCryptoAvailable();
  const output = new Uint8Array(size);
  return Crypto.getRandomValues(output);
}

function assertHttpsUrl(raw: string, fieldName: string): URL {
  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    throw new Error(`[AuthSession] ${fieldName} must be a non-empty string`);
  }
  const url = new URL(trimmed);
  if (url.protocol.toLowerCase() !== "https:") {
    throw new Error(`[AuthSession] ${fieldName} must use https`);
  }
  return url;
}

function parseParams(result: AuthSessionResult): Record<string, string> {
  if (result.params) {
    return result.params;
  }
  const parsed = normalizeParams(result.url);
  return parsed ?? {};
}

function utf8Encode(value: string): Uint8Array {
  if (typeof TextEncoder !== "undefined") {
    return new TextEncoder().encode(value);
  }

  const bytes = new Uint8Array(value.length);
  for (let index = 0; index < value.length; index += 1) {
    bytes[index] = value.charCodeAt(index) & 0xff;
  }
  return bytes;
}

export const AuthSession = Object.freeze({
  async startAsync(request: AuthSessionRequest): Promise<AuthSessionResult> {
    validateRequest(request);

    if (!isNativeAvailable()) {
      if (request.allowInsecureWebPopupFallback === true) {
        return openWebPopup(request);
      }

      return {
        type: "error",
        errorCode: "E_WEB_UNSUPPORTED",
        errorMessage:
          "AuthSession web fallback is disabled by default because redirects cannot be securely captured in this runtime. Set request.allowInsecureWebPopupFallback=true to open an insecure popup fallback.",
      };
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

  isCryptoAvailable(): boolean {
    return isZynthCryptoAvailable();
  },

  getCryptoWarningMessage(): string | null {
    if (isZynthCryptoAvailable()) {
      return null;
    }
    return CRYPTO_UNAVAILABLE_WARNING;
  },

  async createPKCEAsync(options: CreatePkceOptions = {}): Promise<AuthSessionPkcePair> {
    const verifierByteLength = assertIntegerInRange(
      options.verifierByteLength ?? PKCE_VERIFIER_MIN_BYTES,
      PKCE_VERIFIER_MIN_BYTES,
      PKCE_VERIFIER_MAX_BYTES,
      "PKCE verifierByteLength"
    );

    try {
      const verifierBytes = getRandomBytes(verifierByteLength);
      const codeVerifier = toBase64Url(verifierBytes);
      if (codeVerifier.length < 43 || codeVerifier.length > 128) {
        throw new Error("Generated code_verifier length is out of RFC7636 bounds (43-128)");
      }

      const digest = await Crypto.subtle.digest("SHA-256", utf8Encode(codeVerifier));
      const codeChallenge = toBase64Url(new Uint8Array(digest));

      return {
        codeVerifier,
        codeChallenge,
        codeChallengeMethod: "S256",
      };
    } catch (error: unknown) {
      if (error instanceof Error && (error as Error & { code?: AuthSessionErrorCode }).code === "E_CRYPTO_UNAVAILABLE") {
        throw error;
      }
      const detail = error instanceof Error ? error.message : String(error);
      throw createError("E_PKCE_GENERATION_FAILED", `Failed to generate PKCE values: ${detail}`);
    }
  },

  async generateStateAsync(options: CreateStateOptions = {}): Promise<string> {
    const byteLength = assertIntegerInRange(
      options.byteLength ?? PKCE_VERIFIER_MIN_BYTES,
      STATE_MIN_BYTES,
      STATE_MAX_BYTES,
      "state byteLength"
    );

    try {
      return toBase64Url(getRandomBytes(byteLength));
    } catch (error: unknown) {
      if (error instanceof Error && (error as Error & { code?: AuthSessionErrorCode }).code === "E_CRYPTO_UNAVAILABLE") {
        throw error;
      }
      const detail = error instanceof Error ? error.message : String(error);
      throw createError("E_STATE_GENERATION_FAILED", `Failed to generate state: ${detail}`);
    }
  },

  buildAuthorizationUrl(options: BuildAuthorizationUrlOptions): string {
    const endpoint = assertHttpsUrl(options.authorizationEndpoint, "authorizationEndpoint");
    if (!options.clientId || options.clientId.trim().length === 0) {
      throw new Error("[AuthSession] clientId must be a non-empty string");
    }
    if (!options.redirectUri || options.redirectUri.trim().length === 0) {
      throw new Error("[AuthSession] redirectUri must be a non-empty string");
    }

    const responseType = options.responseType ?? "code";
    const url = new URL(endpoint.toString());
    url.searchParams.set("client_id", options.clientId);
    url.searchParams.set("redirect_uri", options.redirectUri);
    url.searchParams.set("response_type", responseType);

    if (options.scopes && options.scopes.length > 0) {
      url.searchParams.set("scope", options.scopes.join(" "));
    }

    if (options.state && options.state.length > 0) {
      url.searchParams.set("state", options.state);
    }

    if (options.codeChallenge && options.codeChallenge.length > 0) {
      url.searchParams.set("code_challenge", options.codeChallenge);
      url.searchParams.set("code_challenge_method", options.codeChallengeMethod ?? "S256");
    }

    const extraParams = options.extraParams ?? {};
    for (const key of Object.keys(extraParams)) {
      url.searchParams.set(key, extraParams[key]);
    }

    return url.toString();
  },

  validateAuthResponse(options: ValidateAuthSessionResponseOptions): ValidateAuthSessionResponseResult {
    const result = options.result;
    const params = parseParams(result);

    if (result.type !== "success") {
      return {
        ok: false,
        errorCode: "E_AUTH_FAILED",
        errorMessage: result.errorMessage ?? `Auth session did not complete successfully (type=${result.type})`,
        params,
        url: result.url,
      };
    }

    if (typeof options.expectedState === "string" && options.expectedState.length > 0) {
      const actualState = params.state;
      if (actualState !== options.expectedState) {
        return {
          ok: false,
          errorCode: "E_STATE_MISMATCH",
          errorMessage: "OAuth state mismatch detected",
          params,
          url: result.url,
        };
      }
    }

    const requireCode = options.requireCode ?? true;
    const code = params.code;
    if (requireCode && (!code || code.length === 0)) {
      return {
        ok: false,
        errorCode: "E_AUTH_CODE_MISSING",
        errorMessage: "Authorization code is missing from callback",
        params,
        url: result.url,
      };
    }

    return {
      ok: true,
      code,
      state: params.state,
      params,
      url: result.url,
    };
  },
});
