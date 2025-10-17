import type { BodyInit } from "./types";

export class Body {
  protected bodyBuffer: ArrayBuffer | null;
  protected stream: any | null;
  bodyUsed: boolean = false;

  constructor(body?: BodyInit, stream?: any | null) {
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
    this.stream = stream ?? null;
  }

  async arrayBuffer(): Promise<ArrayBuffer> {
    if (this.bodyUsed) {
      throw new TypeError("Body has already been consumed");
    }
    this.bodyUsed = true;
    if (this.bodyBuffer) {
      return this.bodyBuffer.slice(0);
    }
    if (this.stream) {
      return consumeStreamToArrayBuffer(this.stream);
    }
    return new ArrayBuffer(0);
  }

  async text(): Promise<string> {
    const buffer = await this.arrayBuffer();
    return new TextDecoder().decode(buffer);
  }

  async json(): Promise<any> {
    const text = await this.text();
    return JSON.parse(text);
  }

  protected cloneBuffer(): ArrayBuffer | null {
    if (!this.bodyBuffer) return null;
    return this.bodyBuffer.slice(0);
  }

  protected hasStream(): boolean {
    return Boolean(this.stream);
  }

  protected setStream(stream: any | null): void {
    this.stream = stream ?? null;
  }
}

async function consumeStreamToArrayBuffer(stream: any): Promise<ArrayBuffer> {
  if (!stream || typeof stream.getReader !== "function") {
    return new ArrayBuffer(0);
  }
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    const chunk = value instanceof Uint8Array ? value : new Uint8Array(value);
    chunks.push(chunk);
    total += chunk.byteLength;
  }
  const merged = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return merged.buffer;
}
