import type { BodyInit, FetchPayload } from "./types";

declare const global: any;

export function getGlobalObject(): any {
  if (typeof globalThis !== "undefined") return globalThis as any;
  if (typeof window !== "undefined") return window as any;
  if (typeof global !== "undefined") return global as any;
  return {};
}

export function normalizeHeaderName(name: string): string {
  return String(name).toLowerCase();
}

export function coerceBody(body?: BodyInit): FetchPayload["body"] {
  if (body == null) return undefined;
  if (typeof body === "string") return body;
  if (body instanceof ArrayBuffer) return body;
  if (body instanceof Uint8Array) {
    const copy = new Uint8Array(body.byteLength);
    copy.set(body);
    return copy.buffer;
  }
  return undefined;
}
