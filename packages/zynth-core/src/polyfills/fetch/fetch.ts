import { Headers } from "./Headers";
import { Request } from "./Request";
import { Response } from "./Response";
import { coerceBody, getGlobalObject, isReadableStreamBody } from "./utils";
import type {
  FetchBridge,
  FetchPayload,
  FetchTlsInit,
  RequestInit,
  FetchResult,
  BodyInit,
  ReadableStreamLike,
  UploadProgress,
} from "./types";

let nextRequestId = 1;

function createAbortError(): Error {
  const error = new Error("Aborted");
  (error as any).name = "AbortError";
  return error;
}

function createStreamError(message: string): Error {
  const error = new Error(message);
  (error as any).name = "StreamError";
  return error;
}

function createNetworkError(message: string): Error {
  const error = new TypeError(message);
  (error as any).name = "TypeError";
  return error;
}

export async function fetch(
  input: string | Request,
  init?: RequestInit
): Promise<Response> {
  const request = input instanceof Request ? input : new Request(input, init);
  const globalObject = getGlobalObject();
  const bridge = globalObject.__modules as FetchBridge | undefined;
  const signal = init?.signal ?? request.signal;

  if (!bridge || typeof bridge.call !== "function") {
    throw new Error("[fetch] Native modules bridge not available");
  }
  if (signal && signal.aborted) {
    throw createAbortError();
  }

  const requestId = nextRequestId++;
  let abortReject: ((error: Error) => void) | null = null;
  let uploadFailureReject: ((error: Error) => void) | null = null;
  let aborted = false;
  const onAbort = () => {
    aborted = true;
    if (abortReject) {
      abortReject(createAbortError());
    }
    try {
      bridge.call("Fetch", "cancel", { id: requestId });
    } catch (_) {}
  };
  if (signal && typeof signal.addEventListener === "function") {
    signal.addEventListener("abort", onAbort);
  }

  const supportsStream = typeof globalObject.ReadableStream === "function";
  const rawBody = init?.body ?? request.getBodyForPayload();
  const streamOverride = init?.stream;
  const wantsStream =
    supportsStream &&
    (typeof streamOverride === "boolean" ? streamOverride : rawBody == null);
  const headers = new Headers(request.headers);
  const redirectMode = init?.redirect ?? request.redirect ?? "follow";
  const payload: FetchPayload = {
    url: request.url,
    requestId,
    method: request.method,
    headers: headers.toJSON(),
    timeout: request.timeout,
    stream: wantsStream,
  };

  const resolvedBody = await resolveBody(rawBody, headers, globalObject);
  const uploadStream = resolvedBody?.uploadStream;
  const uploadTotalBytes = inferUploadTotalBytes(headers, resolvedBody);
  const trustedCertificatesPem = normalizeTrustedCertificates(
    init?.tls?.trustedCertificatesPem
  );
  if (trustedCertificatesPem.length > 0) {
    payload.tls = {
      trustedCertificatesPem,
    };
  }

  if (resolvedBody) {
    payload.body = resolvedBody.body;
    payload.uploadStream = Boolean(uploadStream);
    payload.uploadLength = uploadTotalBytes;
    payload.headers = headers.toJSON();
  }

  // Ensure ArrayBuffer is converted to number[] for bridge compatibility
  if (payload.body instanceof ArrayBuffer) {
    payload.body = Array.from(new Uint8Array(payload.body));
  }

  const emitter = globalObject.ZynthNativeEmitter;
  if (!emitter) {
    throw new Error("[fetch] Native event emitter not available");
  }

  let result: any;
  const responsePromise = new Promise((resolve) => {
    const subscription = emitter.addListener("zynth.fetch.response", (data: any) => {
      if (data && data.requestId === requestId) {
        subscription.remove();
        resolve(data);
      }
    });
    // Add safety timeout or rely on native timeout?
    // Native timeout should trigger an error event.
  });

  const abortPromise =
    signal && typeof signal.addEventListener === "function"
      ? new Promise((_, reject) => {
          abortReject = reject as (error: Error) => void;
        })
      : null;

  const uploadFailurePromise =
    uploadStream != null
      ? new Promise((_, reject) => {
          uploadFailureReject = reject as (error: Error) => void;
        })
      : null;

  try {
    const requestResult = await Promise.resolve(
      bridge.call("Fetch", "request", payload)
    );
    throwIfNativeError(requestResult, "request");

    if (uploadStream) {
      void pumpUploadStreamToNative({
        bridge,
        requestId,
        stream: uploadStream,
        onUploadProgress: init?.onUploadProgress,
        totalBytes: uploadTotalBytes,
      }).catch((error) => {
        try {
          bridge.call("Fetch", "uploadAbort", {
            id: requestId,
            message: error instanceof Error ? error.message : String(error),
          });
        } catch {
          // Ignore bridge failures during abort cleanup.
        }
        if (uploadFailureReject) {
          uploadFailureReject(
            error instanceof Error ? error : new Error(String(error))
          );
        }
      });
    }

    const pending: Promise<unknown>[] = [responsePromise];
    if (abortPromise) {
      pending.push(abortPromise);
    }
    if (uploadFailurePromise) {
      pending.push(uploadFailurePromise);
    }

    result = await Promise.race(pending);
  } finally {
    if (signal && typeof signal.removeEventListener === "function") {
      signal.removeEventListener("abort", onAbort);
    }
  }

  if (result && result.error) {
    if (result.error === "aborted") {
      throw createAbortError();
    }
    const message = result.message ? `: ${result.message}` : "";
    const code = `[fetch] ${result.error}${message}`;
    if (
      result.error === "network_error" ||
      result.error === "invalid_response"
    ) {
      throw createNetworkError(code);
    }
    throw new Error(code);
  }
  if (aborted) {
    throw createAbortError();
  }

  const data = result?.result as FetchResult | undefined;
  if (!data) {
    throw new Error("[fetch] Invalid native response");
  }

  if (redirectMode === "error" && data.redirected) {
    throw createNetworkError("[fetch] Redirected response");
  }

  const stream =
    wantsStream && data.streamId
      ? createStreamFromEmitter(data.streamId, requestId, bridge, globalObject)
      : null;

  const responseBody = normalizeResponseBody(data.body, globalObject);
  return new Response(
    responseBody,
    {
      status: data.status,
      statusText: data.statusText,
      ok: data.ok,
      headers: data.headers,
      url: data.url,
      redirected: data.redirected,
    },
    stream
  );
}

export { Headers, Request, Response };

function normalizeTrustedCertificates(
  value: FetchTlsInit["trustedCertificatesPem"] | undefined
): string[] {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed.length > 0 ? [trimmed] : [];
  }
  if (!Array.isArray(value)) {
    return [];
  }
  const output: string[] = [];
  for (const entry of value) {
    if (typeof entry !== "string") {
      continue;
    }
    const trimmed = entry.trim();
    if (trimmed.length > 0) {
      output.push(trimmed);
    }
  }
  return output;
}

type UploadPumpArgs = {
  bridge: FetchBridge;
  requestId: number;
  stream: ReadableStreamLike<Uint8Array>;
  onUploadProgress?: (progress: UploadProgress) => void;
  totalBytes: number | null;
};

async function pumpUploadStreamToNative(args: UploadPumpArgs): Promise<void> {
  const reader = args.stream.getReader();
  let bytesSent = 0;

  try {
    while (true) {
      const step = await reader.read();
      if (step.done) {
        break;
      }

      const chunk = normalizeUploadChunk(step.value);
      if (chunk.byteLength === 0) {
        continue;
      }

      const chunkPayload = Array.from(chunk);
      const chunkResult = await Promise.resolve(
        args.bridge.call("Fetch", "uploadChunk", {
          id: args.requestId,
          chunk: chunkPayload,
        })
      );
      throwIfNativeError(chunkResult, "uploadChunk");

      bytesSent += chunk.byteLength;
      args.onUploadProgress?.({
        requestId: args.requestId,
        bytesSent,
        bytesTotal: args.totalBytes,
        chunkBytes: chunk.byteLength,
        phase: "enqueue",
      });
    }

    const completeResult = await Promise.resolve(
      args.bridge.call("Fetch", "uploadComplete", { id: args.requestId })
    );
    throwIfNativeError(completeResult, "uploadComplete");
    args.onUploadProgress?.({
      requestId: args.requestId,
      bytesSent,
      bytesTotal: args.totalBytes,
      chunkBytes: 0,
      phase: "complete",
    });
  } finally {
    reader.releaseLock?.();
  }
}

function createStreamFromEmitter(
  streamId: number,
  requestId: number,
  bridge: FetchBridge,
  globalObject: any
): any {
  const emitter = globalObject.ZynthNativeEmitter;
  if (!emitter || typeof emitter.addListener !== "function") {
    throw createStreamError("Native event emitter not available");
  }
  let started = false;

  return new globalObject.ReadableStream({
    start(controller: any) {
      const subscription = emitter.addListener(
        "zynth.fetch.stream",
        (payload: any) => {
          if (!payload || payload.id !== streamId) return;
          if (payload.type === "chunk" && payload.chunk) {
            controller.enqueue(new Uint8Array(payload.chunk));
          } else if (payload.type === "end") {
            subscription.remove();
            controller.close();
          } else if (payload.type === "error") {
            subscription.remove();
            controller.error(
              createStreamError(payload.message || "Stream error")
            );
          }
        }
      );
    },
    pull() {
      if (started) return;
      started = true;
      try {
        bridge.call("Fetch", "streamStart", { id: streamId, requestId });
      } catch (_) {}
    },
    cancel() {
      try {
        bridge.call("Fetch", "cancel", { id: requestId });
      } catch (_) {}
    },
  });
}

function normalizeResponseBody(
  body: FetchResult["body"],
  globalObject: any
): ArrayBuffer | null {
  if (!body) return null;
  if (body instanceof ArrayBuffer) return body;
  if (body instanceof Uint8Array) {
    const copy = new Uint8Array(body.byteLength);
    copy.set(body);
    return copy.buffer;
  }
  if (Array.isArray(body)) {
    const bytes = new Uint8Array(body.length);
    for (let i = 0; i < body.length; i += 1) {
      bytes[i] = Number(body[i]) & 0xff;
    }
    return bytes.buffer;
  }
  if (typeof body === "string") {
    return new TextEncoder().encode(body).buffer;
  }
  const ArrayBufferCtor = globalObject.ArrayBuffer;
  if (ArrayBufferCtor && (body as any) instanceof ArrayBufferCtor) {
    return body as ArrayBuffer;
  }
  return null;
}

function normalizeUploadChunk(value: unknown): Uint8Array {
  if (value instanceof Uint8Array) {
    return value;
  }
  if (value instanceof ArrayBuffer) {
    return new Uint8Array(value);
  }
  if (Array.isArray(value)) {
    const chunk = new Uint8Array(value.length);
    for (let i = 0; i < value.length; i += 1) {
      chunk[i] = Number(value[i]) & 0xff;
    }
    return chunk;
  }
  throw new Error("Upload stream chunk must be Uint8Array-compatible");
}

type ResolvedBody = {
  body?: FetchPayload["body"];
  uploadStream?: ReadableStreamLike<Uint8Array>;
  uploadLength?: number | null;
};

async function resolveBody(
  body: BodyInit,
  headers: Headers,
  globalObject: any
): Promise<ResolvedBody | null> {
  if (body == null) {
    return null;
  }

  if (isReadableStreamBody(body, globalObject)) {
    return {
      uploadStream: body,
      uploadLength: null,
    };
  }

  const FormDataCtor = globalObject.FormData as any;
  const BlobCtor = globalObject.Blob as any;
  const URLSearchParamsCtor = globalObject.URLSearchParams as any;

  if (FormDataCtor && body instanceof FormDataCtor) {
    const payload = await (body as any).toPayload();
    if (!headers.has("content-type")) {
      headers.set("content-type", payload.contentType);
    }
    const buffer = payload.body.buffer.slice(0);
    return { body: buffer, uploadLength: buffer.byteLength };
  }

  if (URLSearchParamsCtor && body instanceof URLSearchParamsCtor) {
    const encoded = (body as any).toString();
    if (!headers.has("content-type")) {
      headers.set(
        "content-type",
        "application/x-www-form-urlencoded;charset=UTF-8"
      );
    }
    return { body: encoded, uploadLength: encoded.length };
  }

  if (BlobCtor && body instanceof BlobCtor) {
    const buffer = await (body as any).arrayBuffer();
    const type = (body as any).type as string | undefined;
    if (type && !headers.has("content-type")) {
      headers.set("content-type", type);
    }
    return { body: buffer, uploadLength: buffer.byteLength };
  }

  const raw = coerceBody(body);
  if (raw !== undefined) {
    return {
      body: raw,
      uploadLength: inferBodyLength(raw),
    };
  }

  return null;
}

function inferUploadTotalBytes(
  headers: Headers,
  resolvedBody: ResolvedBody | null
): number | null {
  const explicitHeader = headers.get("content-length");
  if (explicitHeader) {
    const parsed = Number.parseInt(explicitHeader, 10);
    if (Number.isFinite(parsed) && parsed >= 0) {
      return parsed;
    }
  }
  if (!resolvedBody) {
    return null;
  }
  return resolvedBody.uploadLength ?? null;
}

function inferBodyLength(body: FetchPayload["body"]): number | null {
  if (typeof body === "string") {
    return body.length;
  }
  if (body instanceof ArrayBuffer) {
    return body.byteLength;
  }
  if (body instanceof Uint8Array) {
    return body.byteLength;
  }
  if (Array.isArray(body)) {
    return body.length;
  }
  return null;
}

function throwIfNativeError(result: unknown, context: string): void {
  if (!result || typeof result !== "object") {
    return;
  }
  const record = result as Record<string, unknown>;
  const error = record.error;
  if (typeof error !== "string") {
    return;
  }
  const message =
    typeof record.message === "string" && record.message.length > 0
      ? `: ${record.message}`
      : "";
  throw new Error(`[fetch] ${context} ${error}${message}`);
}
