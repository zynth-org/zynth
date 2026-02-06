import { addDevtoolsListener, emitDevtoolsEvent } from "@zynth/core";
import { Automation } from "./automation";
import type { AutomationReadOptions } from "./types";

type RequestPayload = {
  requestId?: string;
  action?: string;
  target?: {
    runtimeId?: string;
    appId?: string;
    platform?: string;
  };
  options?: AutomationReadOptions;
};

declare const __DEV__: boolean | undefined;

let installed = false;
let runtimeId = "";
let appId = "unknown";
let platform = "unknown";

function isDevEnabled(): boolean {
  if (typeof __DEV__ !== "undefined") return Boolean(__DEV__);
  return true;
}

function getGlobalObject(): Record<string, unknown> {
  return globalThis as Record<string, unknown>;
}

function resolvePlatform(): string {
  const value = getGlobalObject().__ZYNTH_PLATFORM;
  return typeof value === "string" && value.length > 0 ? value.toLowerCase() : "unknown";
}

function resolveAppId(): string {
  const value = getGlobalObject().__ZYNTH_APP_ID;
  if (typeof value === "string" && value.trim().length > 0) {
    return value.trim();
  }
  return "unknown";
}

function randomId(prefix: string): string {
  const rand = Math.random().toString(36).slice(2, 10);
  return `${prefix}_${Date.now().toString(36)}_${rand}`;
}

function matchesTarget(target: RequestPayload["target"]): boolean {
  if (!target) return true;
  if (target.runtimeId && target.runtimeId !== runtimeId) return false;
  if (target.appId && target.appId !== appId) return false;
  if (target.platform && target.platform.toLowerCase() !== platform) return false;
  return true;
}

function emitReady(): void {
  emitDevtoolsEvent({
    topic: "automation/ready",
    level: "info",
    tag: "automation",
    data: {
      runtimeId,
      appId,
      platform,
      capabilities: {
        read: true,
        configure: true,
      },
    },
  });
}

function emitResponse(payload: Record<string, unknown>): void {
  emitDevtoolsEvent({
    topic: "automation/response",
    level: "info",
    tag: "automation",
    data: payload,
  });
}

function handleRequest(data: RequestPayload): void {
  const requestId = typeof data.requestId === "string" ? data.requestId : "";
  if (!requestId) return;
  if (!matchesTarget(data.target)) return;
  if (data.action !== "read") {
    emitResponse({
      requestId,
      runtimeId,
      appId,
      platform,
      ok: false,
      error: "unsupported_action",
      action: data.action ?? null,
    });
    return;
  }
  try {
    const snapshot = Automation.readSync(data.options);
    emitResponse({
      requestId,
      runtimeId,
      appId,
      platform,
      ok: true,
      snapshot,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : `Unknown automation error: ${String(error)}`;
    emitResponse({
      requestId,
      runtimeId,
      appId,
      platform,
      ok: false,
      error: message,
    });
  }
}

export function installAutomationDevtoolsBridge(): void {
  if (installed) return;
  if (!isDevEnabled()) return;
  installed = true;
  runtimeId = randomId("runtime");
  appId = resolveAppId();
  platform = resolvePlatform();

  addDevtoolsListener((event) => {
    if (event.topic === "automation/discover") {
      emitReady();
      return;
    }
    if (event.topic !== "automation/request") return;
    const data = (event.data ?? {}) as RequestPayload;
    handleRequest(data);
  });

  emitReady();
}
