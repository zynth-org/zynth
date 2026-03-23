export type WebServerStatus =
  | "idle"
  | "starting"
  | "running"
  | "stopped"
  | "error";

export type WebServerUploadOptions = {
  enabled?: boolean;
  path?: string;
  directory?: string;
  maxBytes?: number;
  metadataPath?: string;
  authToken?: string;
  authTokenHeader?: string;
  authTokenQueryParam?: string;
};

export type WebServerEventsOptions = {
  enabled?: boolean;
  path?: string;
};

export type WebServerSecurityOptions = {
  allowInsecureHttp?: boolean;
  authToken?: string;
  authTokenHeader?: string;
  authTokenQueryParam?: string;
};

export type WebServerTlsOptions = {
  enabled?: boolean;
  certificatePath?: string;
  certificatePem?: string;
  managed?: {
    alias?: string;
    rotateAfterMs?: number;
    pem?: string;
    getPem?: () => string | Promise<string>;
    autoGenerate?: boolean;
    commonName?: string;
    validDays?: number;
  };
};

export type WebServerManagedTlsCertificateInfo = {
  alias: string;
  certificatePath: string;
  fingerprintSha256: string;
  updatedAt: number;
  existed: boolean;
};

export type WebServerStartOptions = {
  host?: string;
  port?: number;
  documentRoot?: string;
  indexHtml?: string;
  upload?: WebServerUploadOptions;
  events?: WebServerEventsOptions;
  security?: WebServerSecurityOptions;
  tls?: WebServerTlsOptions;
};

export type WebServerInfo = {
  host: string;
  port: number;
  url: string;
  scheme: "http" | "https";
  secureTransport: boolean;
  documentRoot?: string | null;
  uploadPath?: string | null;
  uploadMetadataPath?: string | null;
  eventsPath?: string | null;
  signalPath?: string | null;
  replyPath?: string | null;
};

export type WebServerUploadLifecycleEventType =
  | "upload_started"
  | "upload_progress"
  | "upload_completed"
  | "upload_failed";

export type WebServerEventType =
  | WebServerUploadLifecycleEventType
  | "upload_metadata"
  | "message";

export type WebServerUploadLifecyclePayload = {
  uploadId: number;
  phase: "started" | "progress" | "completed" | "failed";
  name: string;
  path: string;
  bytesReceived: number;
  totalBytes: number;
  method: string;
  remoteAddress: string;
  contentType: string;
  reason: string;
  statusCode: number;
  metadata: Record<string, unknown> | unknown;
};

export type WebServerUploadMetadataPayload = {
  method: string;
  remoteAddress: string;
  metadata: Record<string, unknown> | unknown;
};

export type WebServerEvent = {
  type: WebServerEventType;
  payload:
    | WebServerUploadLifecyclePayload
    | WebServerUploadMetadataPayload
    | unknown;
  rawPayload: string;
};

export type WebServerActiveUpload = {
  uploadId: number;
  name: string;
  path: string;
  bytesReceived: number;
  totalBytes: number;
  startedAt: number;
  updatedAt: number;
};

export type WebServerUploadState = {
  activeCount: number;
  totalStarted: number;
  totalCompleted: number;
  totalFailed: number;
  totalBytesReceived: number;
  activeUploads: WebServerActiveUpload[];
};

export type WebServerSubscriptionSnapshot = {
  timestamp: number;
  running: boolean;
  info: WebServerInfo | null;
  uploadState: WebServerUploadState;
  events: WebServerEvent[];
};

export type WebServerSubscribeOptions = {
  pollIntervalMs?: number;
  maxEvents?: number;
  emitImmediately?: boolean;
  includeUploadState?: boolean;
};

export type WebServerSubscription = {
  remove: () => void;
};
