import { Body } from "./Body";
import { Headers } from "./Headers";
import type { BodyInit, RequestInit } from "./types";
import type { AbortSignal } from "../AbortController";

export class Request extends Body {
  readonly url: string;
  readonly method: string;
  readonly headers: Headers;
  readonly timeout: number;
  readonly signal: AbortSignal | null;
  readonly redirect: "follow" | "error" | "manual";
  private readonly requestBody?: BodyInit;

  constructor(input: string | Request, init?: RequestInit) {
    const source = input instanceof Request ? input : null;
    const url = source ? source.url : String(input);
    const method = (init?.method || source?.method || "GET").toUpperCase();
    const headers = new Headers(init?.headers || source?.headers);
    const timeout = init?.timeout ?? source?.timeout ?? 0;
    const signal = init?.signal ?? source?.signal ?? null;
    const redirect = init?.redirect ?? source?.redirect ?? "follow";
    const body = init?.body ?? source?.getBodyForPayload();

    super(body);
    this.url = url;
    this.method = method;
    this.headers = headers;
    this.timeout = timeout;
    this.signal = signal;
    this.redirect = redirect;
    this.requestBody = body;
  }

  getBodyForPayload(): BodyInit | undefined {
    return this.requestBody;
  }

  clone(): Request {
    if (this.bodyUsed) {
      throw new TypeError("Cannot clone a Request after it is used");
    }
    return new Request(this.url, {
      method: this.method,
      headers: this.headers.clone(),
      body: this.requestBody,
      timeout: this.timeout,
      signal: this.signal ?? undefined,
      redirect: this.redirect,
    });
  }
}
