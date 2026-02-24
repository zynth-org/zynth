export type AuthSessionRequest = {
  authUrl: string;
  redirectUri: string;
  preferEphemeralSession?: boolean;
  timeoutMs?: number;
  allowInsecureWebPopupFallback?: boolean;
};

export type AuthSessionResultType = "success" | "cancel" | "dismiss" | "error";

export type AuthSessionErrorCode =
  | "E_UNAVAILABLE"
  | "E_OPEN_FAILED"
  | "E_WEB_UNSUPPORTED"
  | "E_WEB_FALLBACK_OPENED"
  | "E_INVALID_RESULT"
  | "E_TIMEOUT"
  | "E_CRYPTO_UNAVAILABLE"
  | "E_PKCE_GENERATION_FAILED"
  | "E_STATE_GENERATION_FAILED"
  | "E_STATE_MISMATCH"
  | "E_AUTH_CODE_MISSING"
  | "E_AUTH_FAILED";

export type AuthSessionResult = {
  type: AuthSessionResultType;
  url?: string;
  params?: Record<string, string>;
  errorCode?: AuthSessionErrorCode | string;
  errorMessage?: string;
};

export type AuthSessionDismissResult = {
  dismissed: boolean;
};

export type MakeRedirectUriOptions = {
  native?: string;
  scheme?: string;
  host?: string;
  path?: string;
  queryParams?: Record<string, string>;
};

export type AuthSessionPkceCodeChallengeMethod = "S256";

export type AuthSessionPkcePair = {
  codeVerifier: string;
  codeChallenge: string;
  codeChallengeMethod: AuthSessionPkceCodeChallengeMethod;
};

export type CreatePkceOptions = {
  verifierByteLength?: number;
};

export type CreateStateOptions = {
  byteLength?: number;
};

export type BuildAuthorizationUrlOptions = {
  authorizationEndpoint: string;
  clientId: string;
  redirectUri: string;
  responseType?: "code";
  scopes?: ReadonlyArray<string>;
  state?: string;
  codeChallenge?: string;
  codeChallengeMethod?: AuthSessionPkceCodeChallengeMethod;
  extraParams?: Record<string, string>;
};

export type ValidateAuthSessionResponseOptions = {
  result: AuthSessionResult;
  expectedState?: string;
  requireCode?: boolean;
};

export type ValidateAuthSessionResponseResult =
  | {
      ok: true;
      code?: string;
      state?: string;
      params: Record<string, string>;
      url?: string;
    }
  | {
      ok: false;
      errorCode: AuthSessionErrorCode;
      errorMessage: string;
      params?: Record<string, string>;
      url?: string;
    };
