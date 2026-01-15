const textEncoder = typeof TextEncoder !== "undefined" ? new TextEncoder() : null;
const textDecoder = typeof TextDecoder !== "undefined" ? new TextDecoder() : null;

export function textToBytes(text: string): Uint8Array {
  if (textEncoder) {
    return textEncoder.encode(text);
  }
  const result = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i += 1) {
    result[i] = text.charCodeAt(i) & 0xff;
  }
  return result;
}

export function bytesToText(bytes: Uint8Array): string {
  if (textDecoder) {
    return textDecoder.decode(bytes);
  }
  let result = "";
  for (let i = 0; i < bytes.length; i += 1) {
    result += String.fromCharCode(bytes[i]);
  }
  return result;
}

const BASE64_CHUNK_SIZE = 0x8000;

export function bytesToBase64(bytes: Uint8Array): string {
  if (typeof btoa === "function") {
    let binary = "";
    for (let i = 0; i < bytes.length; i += BASE64_CHUNK_SIZE) {
      const chunk = bytes.subarray(i, i + BASE64_CHUNK_SIZE);
      binary += String.fromCharCode(...chunk);
    }
    return btoa(binary);
  }
  throw new Error("btoa is not available in this runtime.");
}

export function base64ToBytes(base64: string): Uint8Array {
  if (typeof atob === "function") {
    const binary = atob(base64);
    const len = binary.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i += 1) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
  }
  throw new Error("atob is not available in this runtime.");
}

export function concatBytes(chunks: Uint8Array[]): Uint8Array {
  const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const result = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.length;
  }
  return result;
}
