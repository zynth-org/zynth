import { Headers } from "./Headers";
import { Request } from "./Request";
import { Response } from "./Response";
import { coerceBody, getGlobalObject } from "./utils";
import type { FetchBridge, FetchPayload, RequestInit, FetchResult, BodyInit } from "./types";

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
  let aborted = false;
  const onAbort = () => {
    aborted = true;
    try {
      bridge.call("Fetch", "cancel", { id: requestId });
    } catch (_) {}
  };
  if (signal && typeof signal.addEventListener === "function") {
    signal.addEventListener("abort", onAbort);
  }

  const supportsStream = typeof globalObject.ReadableStream === "function";
  const rawBody = init?.body ?? request.getBodyForPayload();
  const streamOverride = (init as any)?.stream;
  const wantsStream =
    supportsStream && (typeof streamOverride === "boolean" ? streamOverride : rawBody == null);
  const headers = new Headers(request.headers);
  const payload: FetchPayload = {
    url: request.url,
    requestId,
    method: request.method,
    headers: headers.toJSON(),
    timeout: request.timeout,
    stream: wantsStream,
  };

  const resolvedBody = await resolveBody(
    rawBody,
    headers,
    globalObject
  );
  if (resolvedBody) {
    payload.body = resolvedBody.body;
    payload.headers = headers.toJSON();
  }

  let result: any;
  try {
    result = await Promise.resolve(bridge.call("Fetch", "request", payload));
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
    throw new Error(`[fetch] ${result.error}${message}`);
  }
  if (aborted) {
    throw createAbortError();
  }

  const data = result?.result as FetchResult | undefined;
  if (!data) {
    throw new Error("[fetch] Invalid native response");
  }

  const stream = wantsStream && data.streamId
    ? createStreamFromEmitter(data.streamId, requestId, bridge, globalObject)
    : null;

  return new Response(data.body ?? null, {
    status: data.status,
    statusText: data.statusText,
    ok: data.ok,
    headers: data.headers,
    url: data.url,
    redirected: data.redirected,
  }, stream);
}

export { Headers, Request, Response };

function createStreamFromEmitter(
  streamId: number,
  requestId: number,
  bridge: FetchBridge,
  globalObject: any
): any {
  const emitter = globalObject.RuneNativeEmitter;
  if (!emitter || typeof emitter.addListener !== "function") {
    throw createStreamError("Native event emitter not available");
  }

  return new globalObject.ReadableStream({
    start(controller: any) {
      const subscription = emitter.addListener("rune.fetch.stream", (payload: any) => {
        if (!payload || payload.id !== streamId) return;
        if (payload.type === "chunk" && payload.chunk) {
          controller.enqueue(new Uint8Array(payload.chunk));
        } else if (payload.type === "end") {
          subscription.remove();
          controller.close();
        } else if (payload.type === "error") {
          subscription.remove();
          controller.error(createStreamError(payload.message || "Stream error"));
        }
      });
    },
    cancel() {
      try {
        bridge.call("Fetch", "cancel", { id: requestId });
      } catch (_) {}
    },
  });
}

async function resolveBody(
  body: BodyInit,
  headers: Headers,
  globalObject: any
): Promise<{ body: FetchPayload["body"] } | null> {
  if (body == null) {
    return null;
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
    return { body: buffer };
  }

  if (URLSearchParamsCtor && body instanceof URLSearchParamsCtor) {
    const encoded = (body as any).toString();
    if (!headers.has("content-type")) {
      headers.set("content-type", "application/x-www-form-urlencoded;charset=UTF-8");
    }
    return { body: encoded };
  }

  if (BlobCtor && body instanceof BlobCtor) {
    const buffer = await (body as any).arrayBuffer();
    const type = (body as any).type as string | undefined;
    if (type && !headers.has("content-type")) {
      headers.set("content-type", type);
    }
    return { body: buffer };
  }

  const raw = coerceBody(body);
  if (raw !== undefined) {
    return { body: raw };
  }

  return null;
}
