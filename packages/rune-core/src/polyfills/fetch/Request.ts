import { Body } from "./Body";
import { Headers } from "./Headers";
import type { BodyInit, RequestInit } from "./types";

export class Request extends Body {
  readonly url: string;
  readonly method: string;
  readonly headers: Headers;
  readonly timeout: number;
  private readonly requestBody?: BodyInit;

  constructor(input: string | Request, init?: RequestInit) {
    const source = input instanceof Request ? input : null;
    const url = source ? source.url : String(input);
    const method = (init?.method || source?.method || "GET").toUpperCase();
    const headers = new Headers(init?.headers || source?.headers);
    const timeout = init?.timeout ?? source?.timeout ?? 0;
    const body = init?.body ?? source?.getBodyForPayload();

    super(body);
    this.url = url;
    this.method = method;
    this.headers = headers;
    this.timeout = timeout;
    this.requestBody = body;
  }

  getBodyForPayload(): BodyInit | undefined {
    return this.requestBody;
  }
}
