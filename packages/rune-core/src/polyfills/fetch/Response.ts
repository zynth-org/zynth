import { Body } from "./Body";
import { Headers } from "./Headers";

export class Response extends Body {
  body: any | null;
  readonly status: number;
  readonly statusText: string;
  readonly ok: boolean;
  readonly headers: Headers;
  readonly url: string;
  readonly redirected: boolean;

  constructor(
    body: ArrayBuffer | null,
    init: {
      status: number;
      statusText: string;
      ok: boolean;
      headers?: Record<string, string>;
      url: string;
      redirected: boolean;
    },
    stream?: any | null
  ) {
    super(body ? new Uint8Array(body) : null, stream ?? null);
    this.body = stream ?? null;
    this.status = init.status;
    this.statusText = init.statusText;
    this.ok = init.ok;
    this.headers = new Headers(init.headers);
    this.url = init.url;
    this.redirected = init.redirected;
  }

  clone(): Response {
    if (this.bodyUsed) {
      throw new TypeError("Cannot clone a Response after it is used");
    }
    if (this.hasStream()) {
      const stream = this.body;
      if (!stream || typeof stream.tee !== "function") {
        throw new TypeError("Cannot clone a streaming Response body");
      }
      const [a, b] = stream.tee();
      this.body = a;
      this.setStream(a);
      return new Response(null, {
        status: this.status,
        statusText: this.statusText,
        ok: this.ok,
        headers: this.headers.toJSON(),
        url: this.url,
        redirected: this.redirected,
      }, b);
    }
    return new Response(this.cloneBuffer(), {
      status: this.status,
      statusText: this.statusText,
      ok: this.ok,
      headers: this.headers.toJSON(),
      url: this.url,
      redirected: this.redirected,
    });
  }
}
