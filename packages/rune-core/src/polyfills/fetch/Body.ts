import type { BodyInit } from "./types";

export class Body {
  protected bodyBuffer: ArrayBuffer | null;
  bodyUsed: boolean = false;

  constructor(body?: BodyInit) {
    if (body == null) {
      this.bodyBuffer = null;
    } else if (typeof body === "string") {
      this.bodyBuffer = new TextEncoder().encode(body).buffer;
    } else if (body instanceof ArrayBuffer) {
      this.bodyBuffer = body;
    } else if (body instanceof Uint8Array) {
      const copy = new Uint8Array(body.byteLength);
      copy.set(body);
      this.bodyBuffer = copy.buffer;
    } else {
      this.bodyBuffer = null;
    }
  }

  async arrayBuffer(): Promise<ArrayBuffer> {
    this.bodyUsed = true;
    return this.bodyBuffer ? this.bodyBuffer.slice(0) : new ArrayBuffer(0);
  }

  async text(): Promise<string> {
    const buffer = await this.arrayBuffer();
    return new TextDecoder().decode(buffer);
  }

  async json(): Promise<any> {
    const text = await this.text();
    return JSON.parse(text);
  }
}
