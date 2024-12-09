export interface RuneHMRServerConfig {
  appRoot: string;
  port: number;
  outDir?: string;
  host?: string;
}

export interface RsbuildConfigOptions {
  appRoot: string;
  outDir: string;
  mode: "development" | "production";
  aliases?: Record<string, string>;
}

export interface AssetManifestEntry {
  url: string;
  path: string;
  size?: number;
  hash?: string;
}

export interface DevClientInfo {
  platform: "ios" | "android";
  version?: string;
  deviceId?: string;
}

export interface HMRMessage {
  type:
    | "update"
    | "error"
    | "bundle-ready"
    | "handshake-request"
    | "ping"
    | "pong";
  timestamp?: number;
  data?: any;
}

export interface ClientMessage {
  event: "rune:hello" | "rune:ping" | "rune:bundle-request";
  data?: any;
}

export interface BundleInfo {
  path: string;
  size: number;
  timestamp: number;
  assets: string[];
}
