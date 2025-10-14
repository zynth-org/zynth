import { Headers } from "./Headers";
import { Request } from "./Request";
import { Response } from "./Response";
import { coerceBody, getGlobalObject } from "./utils";
import type { FetchBridge, FetchPayload, RequestInit, FetchResult } from "./types";

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
  const payload: FetchPayload = {
    url: request.url,
    requestId,
    method: request.method,
    headers: request.headers.toJSON(),
    timeout: request.timeout,
    stream: supportsStream,
  };
  const body = coerceBody(init?.body ?? request.getBodyForPayload());
  if (body !== undefined) {
    payload.body = body;
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

  const stream = supportsStream && data.streamId
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
