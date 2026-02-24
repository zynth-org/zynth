export type AuthSessionRequest = {
  authUrl: string;
  redirectUri: string;
  preferEphemeralSession?: boolean;
  timeoutMs?: number;
};

export type AuthSessionResultType = "success" | "cancel" | "dismiss" | "error";

export type AuthSessionResult = {
  type: AuthSessionResultType;
  url?: string;
  params?: Record<string, string>;
  errorCode?: string;
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
