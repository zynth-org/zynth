import { Blob } from "./Blob";

type FormDataEntry = {
  name: string;
  value: string | Blob;
  filename?: string;
};

declare const global: any;

class FormDataPolyfill {
  private readonly items: FormDataEntry[] = [];

  append(name: string, value: string | Blob, filename?: string): void {
    const entry: FormDataEntry = {
      name: String(name),
      value: value instanceof Blob ? value : String(value),
      filename: filename ? String(filename) : undefined,
    };
    this.items.push(entry);
  }

  set(name: string, value: string | Blob, filename?: string): void {
    this.delete(name);
    this.append(name, value, filename);
  }

  get(name: string): string | Blob | null {
    const entry = this.items.find((item) => item.name === name);
    return entry ? entry.value : null;
  }

  getAll(name: string): Array<string | Blob> {
    return this.items.filter((item) => item.name === name).map((item) => item.value);
  }

  has(name: string): boolean {
    return this.items.some((item) => item.name === name);
  }

  delete(name: string): void {
    for (let i = this.items.length - 1; i >= 0; i -= 1) {
      if (this.items[i].name === name) {
        this.items.splice(i, 1);
      }
    }
  }

  forEach(callback: (value: string | Blob, name: string) => void): void {
    for (const entry of this.items) {
      callback(entry.value, entry.name);
    }
  }

  *entriesIterator(): IterableIterator<[string, string | Blob]> {
    for (const entry of this.items) {
      yield [entry.name, entry.value];
    }
  }

  entries(): IterableIterator<[string, string | Blob]> {
    return this.entriesIterator();
  }

  keys(): IterableIterator<string> {
    const self = this;
    return (function* () {
      for (const entry of self.items) {
        yield entry.name;
      }
    })();
  }

  values(): IterableIterator<string | Blob> {
    const self = this;
    return (function* () {
      for (const entry of self.items) {
        yield entry.value;
      }
    })();
  }

  [Symbol.iterator](): IterableIterator<[string, string | Blob]> {
    return this.entries();
  }

  async toPayload(): Promise<{ body: Uint8Array; contentType: string }> {
    const boundary = `----rune-formdata-${Math.random().toString(16).slice(2)}`;
    const encoder = new TextEncoder();
    const chunks: Uint8Array[] = [];

    for (const entry of this.items) {
      const headers: string[] = [];
      if (entry.value instanceof Blob) {
        const filename = entry.filename ?? "blob";
        headers.push(
          `Content-Disposition: form-data; name=\"${entry.name}\"; filename=\"${filename}\"`
        );
        const type = entry.value.type || "application/octet-stream";
        headers.push(`Content-Type: ${type}`);
        const headerBlock = `--${boundary}\r\n${headers.join("\r\n")}\r\n\r\n`;
        chunks.push(encoder.encode(headerBlock));
        const buffer = await entry.value.arrayBuffer();
        chunks.push(new Uint8Array(buffer));
        chunks.push(encoder.encode("\r\n"));
      } else {
        headers.push(`Content-Disposition: form-data; name=\"${entry.name}\"`);
        const headerBlock = `--${boundary}\r\n${headers.join("\r\n")}\r\n\r\n`;
        chunks.push(encoder.encode(headerBlock));
        chunks.push(encoder.encode(String(entry.value)));
        chunks.push(encoder.encode("\r\n"));
      }
    }

    chunks.push(encoder.encode(`--${boundary}--\r\n`));

    const body = concatChunks(chunks);
    return {
      body,
      contentType: `multipart/form-data; boundary=${boundary}`,
    };
  }
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

if (globalObject && typeof globalObject.FormData !== "function") {
  console.log("[RuneCore] Polyfilling FormData");
  globalObject.FormData = FormDataPolyfill;
}

export { FormDataPolyfill as FormData };
