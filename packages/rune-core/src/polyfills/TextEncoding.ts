type TextDecoderOptions = {
  fatal?: boolean;
  ignoreBOM?: boolean;
};

type TextDecodeInput = ArrayBuffer | ArrayBufferView;

class TextEncoderPolyfill {
  encode(input: string = ""): Uint8Array {
    const bytes: number[] = [];
    for (const char of input) {
      const codePoint = char.codePointAt(0) ?? 0;
      if (codePoint <= 0x7f) {
        bytes.push(codePoint);
      } else if (codePoint <= 0x7ff) {
        bytes.push(0xc0 | (codePoint >> 6));
        bytes.push(0x80 | (codePoint & 0x3f));
      } else if (codePoint <= 0xffff) {
        bytes.push(0xe0 | (codePoint >> 12));
        bytes.push(0x80 | ((codePoint >> 6) & 0x3f));
        bytes.push(0x80 | (codePoint & 0x3f));
      } else {
        bytes.push(0xf0 | (codePoint >> 18));
        bytes.push(0x80 | ((codePoint >> 12) & 0x3f));
        bytes.push(0x80 | ((codePoint >> 6) & 0x3f));
        bytes.push(0x80 | (codePoint & 0x3f));
      }
    }
    return new Uint8Array(bytes);
  }

  encodeInto(
    source: string,
    destination: Uint8Array
  ): { read: number; written: number } {
    const encoded = this.encode(source);
    const length = Math.min(encoded.length, destination.length);
    destination.set(encoded.subarray(0, length));
    return { read: source.length, written: length };
  }
}

class TextDecoderPolyfill {
  readonly encoding: string;
  readonly fatal: boolean;
  readonly ignoreBOM: boolean;

  constructor(encoding: string = "utf-8", options: TextDecoderOptions = {}) {
    const normalized = encoding.toLowerCase();
    if (normalized !== "utf-8" && normalized !== "utf8") {
      throw new RangeError("Only utf-8 TextDecoder is supported");
    }
    this.encoding = "utf-8";
    this.fatal = Boolean(options.fatal);
    this.ignoreBOM = Boolean(options.ignoreBOM);
  }

  decode(input?: TextDecodeInput): string {
    if (!input) return "";
    const bytes = toUint8Array(input);
    let result = "";
    for (let i = 0; i < bytes.length; i += 1) {
      const byte1 = bytes[i];
      if (byte1 <= 0x7f) {
        result += String.fromCodePoint(byte1);
        continue;
      }

      if (byte1 >= 0xc0 && byte1 <= 0xdf) {
        const byte2 = bytes[i + 1];
        if (!isContinuation(byte2)) {
          result += replacementChar(this.fatal);
          continue;
        }
        const codePoint = ((byte1 & 0x1f) << 6) | (byte2 & 0x3f);
        result += String.fromCodePoint(codePoint);
        i += 1;
        continue;
      }

      if (byte1 >= 0xe0 && byte1 <= 0xef) {
        const byte2 = bytes[i + 1];
        const byte3 = bytes[i + 2];
        if (!isContinuation(byte2) || !isContinuation(byte3)) {
          result += replacementChar(this.fatal);
          continue;
        }
        const codePoint =
          ((byte1 & 0x0f) << 12) | ((byte2 & 0x3f) << 6) | (byte3 & 0x3f);
        result += String.fromCodePoint(codePoint);
        i += 2;
        continue;
      }

      if (byte1 >= 0xf0 && byte1 <= 0xf7) {
        const byte2 = bytes[i + 1];
        const byte3 = bytes[i + 2];
        const byte4 = bytes[i + 3];
        if (
          !isContinuation(byte2) ||
          !isContinuation(byte3) ||
          !isContinuation(byte4)
        ) {
          result += replacementChar(this.fatal);
          continue;
        }
        const codePoint =
          ((byte1 & 0x07) << 18) |
          ((byte2 & 0x3f) << 12) |
          ((byte3 & 0x3f) << 6) |
          (byte4 & 0x3f);
        result += String.fromCodePoint(codePoint);
        i += 3;
        continue;
      }

      result += replacementChar(this.fatal);
    }
    return result;
  }
}

function toUint8Array(input: TextDecodeInput): Uint8Array {
  if (input instanceof ArrayBuffer) {
    return new Uint8Array(input);
  }
  return new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
}

function isContinuation(byte: number | undefined): boolean {
  return typeof byte === "number" && (byte & 0xc0) === 0x80;
}

function replacementChar(fatal: boolean): string {
  if (fatal) {
    throw new TypeError("TextDecoder fatal error");
  }
  return "\uFFFD";
}

const globalObject =
  typeof globalThis !== "undefined"
    ? (globalThis as any)
    : typeof window !== "undefined"
    ? (window as any)
    : ({} as any);

if (globalObject && typeof globalObject.TextEncoder !== "function") {
  // console.log("[RuneCore] Polyfilling TextEncoder");
  globalObject.TextEncoder = TextEncoderPolyfill;
}

if (globalObject && typeof globalObject.TextDecoder !== "function") {
  // console.log("[RuneCore] Polyfilling TextDecoder");
  globalObject.TextDecoder = TextDecoderPolyfill;
}

export {
  TextEncoderPolyfill as TextEncoder,
  TextDecoderPolyfill as TextDecoder,
};
