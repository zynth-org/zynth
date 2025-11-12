type BlobPart = ArrayBuffer | ArrayBufferView | Blob | string;

type BlobOptions = {
  type?: string;
};

declare const global: any;

class BlobPolyfill {
  readonly size: number;
  readonly type: string;
  private readonly parts: Array<BlobPart>;

  constructor(parts: BlobPart[] = [], options: BlobOptions = {}) {
    this.parts = parts.slice();
    this.type = (options.type || "").toLowerCase();
    this.size = computeSize(this.parts);
  }

  async arrayBuffer(): Promise<ArrayBuffer> {
    const chunks = await Promise.all(this.parts.map(partToBytes));
    const merged = concatChunks(chunks);
    const copy = new Uint8Array(merged.byteLength);
    copy.set(merged);
    return copy.buffer;
  }

  async text(): Promise<string> {
    const buffer = await this.arrayBuffer();
    return new TextDecoder().decode(buffer);
  }

  slice(start?: number, end?: number, contentType?: string): BlobPolyfill {
    const size = this.size;
    const relativeStart = start ?? 0;
    const relativeEnd = end ?? size;
    const clampedStart = Math.max(
      relativeStart < 0 ? size + relativeStart : relativeStart,
      0
    );
    const clampedEnd = Math.min(
      relativeEnd < 0 ? size + relativeEnd : relativeEnd,
      size
    );
    const span = Math.max(clampedEnd - clampedStart, 0);

    return new BlobPolyfill([this.sliceBytes(clampedStart, span)], {
      type: contentType,
    });
  }

  private sliceBytes(start: number, length: number): Uint8Array {
    const encoder = new TextEncoder();
    const chunks: Uint8Array[] = [];
    for (const part of this.parts) {
      if (length <= 0) break;
      const bytes = partToBytesSync(part, encoder);
      if (bytes.length === 0) continue;
      if (start >= bytes.length) {
        start -= bytes.length;
        continue;
      }
      const slice = bytes.subarray(start, start + length);
      chunks.push(slice);
      length -= slice.length;
      start = 0;
    }
    return concatChunks(chunks);
  }
}

function computeSize(parts: BlobPart[]): number {
  const encoder = new TextEncoder();
  let size = 0;
  for (const part of parts) {
    size += partToBytesSync(part, encoder).byteLength;
  }
  return size;
}

async function partToBytes(part: BlobPart): Promise<Uint8Array> {
  if (typeof part === "string") {
    return new TextEncoder().encode(part);
  }
  if (part instanceof BlobPolyfill) {
    const buffer = await part.arrayBuffer();
    return new Uint8Array(buffer);
  }
  if (part instanceof ArrayBuffer) {
    return new Uint8Array(part);
  }
  if (ArrayBuffer.isView(part)) {
    return new Uint8Array(part.buffer, part.byteOffset, part.byteLength);
  }
  return new Uint8Array(0);
}

function partToBytesSync(part: BlobPart, encoder: TextEncoder): Uint8Array {
  if (typeof part === "string") {
    return encoder.encode(part);
  }
  if (part instanceof BlobPolyfill) {
    return new Uint8Array(0);
  }
  if (part instanceof ArrayBuffer) {
    return new Uint8Array(part);
  }
  if (ArrayBuffer.isView(part)) {
    return new Uint8Array(part.buffer, part.byteOffset, part.byteLength);
  }
  return new Uint8Array(0);
}

function concatChunks(chunks: Uint8Array[]): Uint8Array {
  let total = 0;
  for (const chunk of chunks) {
    total += chunk.byteLength;
  }
  const merged = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return merged;
}

const globalObject =
  typeof globalThis !== "undefined"
    ? (globalThis as any)
    : typeof window !== "undefined"
    ? (window as any)
    : typeof global !== "undefined"
    ? (global as any)
    : ({} as any);

if (globalObject && typeof globalObject.Blob !== "function") {
  // console.log("[RuneCore] Polyfilling Blob");
  globalObject.Blob = BlobPolyfill;
}

export { BlobPolyfill as Blob };
