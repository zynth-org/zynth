import type { BodyInit, FetchPayload, ReadableStreamLike } from "./types";

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
  if (body instanceof ArrayBuffer) {
    return bytesToNumberArray(new Uint8Array(body));
  }
  if (body instanceof Uint8Array) {
    return bytesToNumberArray(body);
  }
  return undefined;
}

function bytesToNumberArray(bytes: Uint8Array): number[] {
  const values = new Array<number>(bytes.byteLength);
  for (let index = 0; index < bytes.byteLength; index += 1) {
    values[index] = bytes[index];
  }
  return values;
}

export function isReadableStreamBody(
  body: BodyInit,
  globalObject: any
): body is ReadableStreamLike<Uint8Array> {
  if (!body || typeof body !== "object") {
    return false;
  }
  const bodyWithReader = body as { getReader?: unknown };
  if (typeof bodyWithReader.getReader !== "function") {
    return false;
  }
  const ReadableStreamCtor = globalObject?.ReadableStream;
  if (typeof ReadableStreamCtor === "function") {
    return body instanceof ReadableStreamCtor;
  }
  return true;
}
