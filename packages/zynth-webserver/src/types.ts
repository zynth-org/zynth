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
};

export type WebServerEventsOptions = {
  enabled?: boolean;
  path?: string;
};

export type WebServerStartOptions = {
  host?: string;
  port?: number;
  documentRoot?: string;
  indexHtml?: string;
  upload?: WebServerUploadOptions;
  events?: WebServerEventsOptions;
};

export type WebServerInfo = {
  host: string;
  port: number;
  url: string;
  documentRoot?: string | null;
  uploadPath?: string | null;
  eventsPath?: string | null;
};

export type WebServerEventType = "upload" | "message";

export type WebServerEvent = {
  type: WebServerEventType;
  payload: unknown;
  rawPayload: string;
};
