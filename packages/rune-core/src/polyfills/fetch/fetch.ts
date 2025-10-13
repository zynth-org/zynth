import { Headers } from "./Headers";
import { Request } from "./Request";
import { Response } from "./Response";
import { coerceBody, getGlobalObject } from "./utils";
import type { FetchBridge, FetchPayload, RequestInit, FetchResult } from "./types";

export async function fetch(
  input: string | Request,
  init?: RequestInit
): Promise<Response> {
  const request = input instanceof Request ? input : new Request(input, init);
  const globalObject = getGlobalObject();
  const bridge = globalObject.__modules as FetchBridge | undefined;

  if (!bridge || typeof bridge.call !== "function") {
    throw new Error("[fetch] Native modules bridge not available");
  }

  const payload: FetchPayload = {
    url: request.url,
    method: request.method,
    headers: request.headers.toJSON(),
    timeout: request.timeout,
  };
  const body = coerceBody(init?.body ?? request.getBodyForPayload());
  if (body !== undefined) {
    payload.body = body;
  }

  const result = await Promise.resolve(
    bridge.call("Fetch", "request", payload)
  );

  if (result && result.error) {
    const message = result.message ? `: ${result.message}` : "";
    throw new Error(`[fetch] ${result.error}${message}`);
  }

  const data = result?.result as FetchResult | undefined;
  if (!data) {
    throw new Error("[fetch] Invalid native response");
  }

  return new Response(data.body, {
    status: data.status,
    statusText: data.statusText,
    ok: data.ok,
    headers: data.headers,
    url: data.url,
    redirected: data.redirected,
  });
}

export { Headers, Request, Response };
