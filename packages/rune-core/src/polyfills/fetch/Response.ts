import { Body } from "./Body";
import { Headers } from "./Headers";

export class Response extends Body {
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
    }
  ) {
    super(body ? new Uint8Array(body) : null);
    this.status = init.status;
    this.statusText = init.statusText;
    this.ok = init.ok;
    this.headers = new Headers(init.headers);
    this.url = init.url;
    this.redirected = init.redirected;
  }
}
