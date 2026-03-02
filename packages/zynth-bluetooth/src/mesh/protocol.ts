import type { MeshRelayEnvelope } from "./types";

const PROTOCOL_VERSION = 1;
const HEADER_SIZE = 6;

function toUtf8Bytes(value: string): Uint8Array {
  return new TextEncoder().encode(value);
}

function fromUtf8Bytes(value: Uint8Array): string {
  return new TextDecoder().decode(value);
}

export function base64ToBytes(value: string): Uint8Array {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  const clean = value.replace(/=+$/, "");
  const out = new Uint8Array(Math.floor((clean.length * 3) / 4));
  let outIndex = 0;
  let bits = 0;
  let bitCount = 0;

  for (const char of clean) {
    const index = alphabet.indexOf(char);
    if (index < 0) {
      continue;
    }
    bits = (bits << 6) | index;
    bitCount += 6;
    if (bitCount >= 8) {
      bitCount -= 8;
      out[outIndex] = (bits >> bitCount) & 0xff;
      outIndex += 1;
    }
  }

  return out.slice(0, outIndex);
}

export function bytesToBase64(bytes: Uint8Array): string {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  let output = "";
  let index = 0;

  for (; index + 2 < bytes.length; index += 3) {
    const chunk = (bytes[index] << 16) | (bytes[index + 1] << 8) | bytes[index + 2];
    output += alphabet[(chunk >> 18) & 63];
    output += alphabet[(chunk >> 12) & 63];
    output += alphabet[(chunk >> 6) & 63];
    output += alphabet[chunk & 63];
  }

  const remaining = bytes.length - index;
  if (remaining === 1) {
    const chunk = bytes[index] << 16;
    output += alphabet[(chunk >> 18) & 63];
    output += alphabet[(chunk >> 12) & 63];
    output += "==";
  } else if (remaining === 2) {
    const chunk = (bytes[index] << 16) | (bytes[index + 1] << 8);
    output += alphabet[(chunk >> 18) & 63];
    output += alphabet[(chunk >> 12) & 63];
    output += alphabet[(chunk >> 6) & 63];
    output += "=";
  }

  return output;
}

export function normalizeUuid(input: string): string {
  const trimmed = input.trim().toLowerCase();
  if (trimmed.length === 4) {
    return `0000${trimmed}-0000-1000-8000-00805f9b34fb`;
  }
  return trimmed;
}

export function dedupeKey(envelope: MeshRelayEnvelope): string {
  return `${envelope.originId}:${envelope.messageId}`;
}

export function createEnvelopeBase(
  nodeId: string,
  payloadBase64: string,
  timestamp: number,
  ttl: number,
  recipientId?: string,
  roomId?: string
): MeshRelayEnvelope {
  return {
    protoVersion: PROTOCOL_VERSION,
    flags: 0,
    messageId: `${timestamp.toString(36)}-${Math.random().toString(36).slice(2, 10)}`,
    originId: nodeId,
    recipientId: recipientId ?? null,
    roomId: roomId ?? null,
    ttl,
    hopCount: 0,
    timestamp,
    payloadBase64,
    authTagBase64: null,
  };
}

export function encodeEnvelope(envelope: MeshRelayEnvelope): string {
  const json = JSON.stringify(envelope);
  const body = toUtf8Bytes(json);
  const packet = new Uint8Array(HEADER_SIZE + body.byteLength);
  packet[0] = PROTOCOL_VERSION;
  packet[1] = envelope.flags & 0xff;
  packet[2] = envelope.ttl & 0xff;
  packet[3] = envelope.hopCount & 0xff;
  packet[4] = (body.byteLength >> 8) & 0xff;
  packet[5] = body.byteLength & 0xff;
  packet.set(body, HEADER_SIZE);
  return bytesToBase64(packet);
}

export function decodeEnvelope(packetBase64: string): MeshRelayEnvelope {
  const bytes = base64ToBytes(packetBase64);
  if (bytes.byteLength < HEADER_SIZE) {
    throw new Error("E_PROTOCOL_PACKET_TOO_SMALL");
  }
  const version = bytes[0];
  if (version !== PROTOCOL_VERSION) {
    throw new Error("E_PROTOCOL_UNSUPPORTED_VERSION");
  }
  const flags = bytes[1];
  const ttl = bytes[2];
  const hopCount = bytes[3];
  const bodyLength = (bytes[4] << 8) | bytes[5];
  if (bodyLength < 2 || bytes.byteLength < HEADER_SIZE + bodyLength) {
    throw new Error("E_PROTOCOL_BODY_INVALID");
  }

  const body = bytes.slice(HEADER_SIZE, HEADER_SIZE + bodyLength);
  const parsed = JSON.parse(fromUtf8Bytes(body)) as MeshRelayEnvelope;
  return {
    protoVersion: PROTOCOL_VERSION,
    flags,
    ttl,
    hopCount,
    messageId: parsed.messageId,
    originId: parsed.originId,
    recipientId: parsed.recipientId ?? null,
    roomId: parsed.roomId ?? null,
    timestamp: parsed.timestamp,
    payloadBase64: parsed.payloadBase64,
    authTagBase64: parsed.authTagBase64 ?? null,
  };
}

export function chunkPayload(dataBase64: string, maxBytesPerChunk: number): string[] {
  if (maxBytesPerChunk < 32) {
    return [dataBase64];
  }
  const bytes = base64ToBytes(dataBase64);
  if (bytes.byteLength <= maxBytesPerChunk) {
    return [dataBase64];
  }

  const chunks: string[] = [];
  for (let index = 0; index < bytes.byteLength; index += maxBytesPerChunk) {
    chunks.push(bytesToBase64(bytes.slice(index, Math.min(index + maxBytesPerChunk, bytes.byteLength))));
  }
  return chunks;
}

export function assembleChunks(chunks: ReadonlyArray<string>): string {
  if (chunks.length === 0) {
    return "";
  }
  if (chunks.length === 1) {
    return chunks[0];
  }

  let totalBytes = 0;
  const decoded = chunks.map((chunk) => {
    const bytes = base64ToBytes(chunk);
    totalBytes += bytes.byteLength;
    return bytes;
  });

  const all = new Uint8Array(totalBytes);
  let offset = 0;
  for (const part of decoded) {
    all.set(part, offset);
    offset += part.byteLength;
  }
  return bytesToBase64(all);
}
