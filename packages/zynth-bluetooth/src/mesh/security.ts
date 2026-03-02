import { base64ToBytes, bytesToBase64 } from "./protocol";
import type { MeshRelayEnvelope, MeshSecurityConfig, MeshSession } from "./types";

const HKDF_SALT = new TextEncoder().encode("zynth-mesh-noise-psk-sim-v1");

type CryptoKeyLike = unknown;

type SubtleLike = {
  importKey(
    format: "raw",
    keyData: ArrayBufferView | ArrayBuffer,
    algorithm: { name: string },
    extractable: boolean,
    keyUsages: string[]
  ): Promise<CryptoKeyLike>;
  deriveBits(
    algorithm: {
      name: string;
      hash: string;
      salt: ArrayBufferView | ArrayBuffer;
      info: ArrayBufferView | ArrayBuffer;
    },
    baseKey: CryptoKeyLike,
    length: number
  ): Promise<ArrayBuffer>;
  encrypt(
    algorithm: {
      name: string;
      iv: ArrayBufferView | ArrayBuffer;
      additionalData?: ArrayBufferView | ArrayBuffer;
      tagLength?: number;
    },
    key: CryptoKeyLike,
    data: ArrayBufferView | ArrayBuffer
  ): Promise<ArrayBuffer>;
  decrypt(
    algorithm: {
      name: string;
      iv: ArrayBufferView | ArrayBuffer;
      additionalData?: ArrayBufferView | ArrayBuffer;
      tagLength?: number;
    },
    key: CryptoKeyLike,
    data: ArrayBufferView | ArrayBuffer
  ): Promise<ArrayBuffer>;
};

type CryptoLike = {
  subtle: SubtleLike;
  getRandomValues<T extends ArrayBufferView>(array: T): T;
};

let hasWarnedMissingCrypto = false;

function asArrayBuffer(value: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(value.byteLength);
  copy.set(value);
  return copy.buffer;
}

function concatBytes(parts: ReadonlyArray<Uint8Array>): Uint8Array {
  let total = 0;
  for (const part of parts) {
    total += part.byteLength;
  }
  const result = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.byteLength;
  }
  return result;
}

function metadataAAD(envelope: MeshRelayEnvelope): Uint8Array {
  const payload = `${envelope.protoVersion}|${envelope.messageId}|${envelope.originId}|${envelope.recipientId ?? "*"}|${envelope.timestamp}`;
  return new TextEncoder().encode(payload);
}

function isValidAesKeyLength(length: number): boolean {
  return length === 16 || length === 24 || length === 32;
}

function normalizeToAes256(raw: Uint8Array): Uint8Array {
  if (isValidAesKeyLength(raw.byteLength)) {
    return raw;
  }

  // Deterministic 32-byte mixer fallback for invalid lengths.
  const out = new Uint8Array(32);
  if (raw.byteLength === 0) {
    return out;
  }
  for (let index = 0; index < out.byteLength; index += 1) {
    const source = raw[index % raw.byteLength];
    const mixed = (source + ((index * 131) & 0xff) + ((index * 17) & 0xff)) & 0xff;
    out[index] = mixed;
  }
  return out;
}

function getOptionalCrypto(): CryptoLike | null {
  const candidate = (globalThis as { crypto?: unknown }).crypto;
  if (!candidate || typeof candidate !== "object") {
    return null;
  }

  const record = candidate as Record<string, unknown>;
  const subtle = record.subtle;
  const getRandomValues = record.getRandomValues;
  if (typeof getRandomValues !== "function" || !subtle || typeof subtle !== "object") {
    return null;
  }

  const subtleRecord = subtle as Record<string, unknown>;
  if (
    typeof subtleRecord.importKey !== "function" ||
    typeof subtleRecord.deriveBits !== "function" ||
    typeof subtleRecord.encrypt !== "function" ||
    typeof subtleRecord.decrypt !== "function"
  ) {
    return null;
  }

  return candidate as CryptoLike;
}

function warnCryptoUnavailableOnce(): void {
  if (hasWarnedMissingCrypto) {
    return;
  }
  hasWarnedMissingCrypto = true;
  console.warn(
    "[BluetoothMesh] Security is enabled but globalThis.crypto with subtle crypto is unavailable. Falling back to plaintext mesh payloads."
  );
}

export class MeshSecurityEngine {
  private config: MeshSecurityConfig;

  constructor(config: MeshSecurityConfig) {
    this.config = config;
  }

  public updateConfig(config: MeshSecurityConfig): void {
    this.config = config;
  }

  public isEnabled(): boolean {
    return this.config.enabled;
  }

  public canUseCrypto(): boolean {
    return getOptionalCrypto() != null;
  }

  public async openSession(nodeId: string, peerId: string, nowMs: number): Promise<MeshSession> {
    const keyMaterialBase64 = await this.deriveSessionKeyBase64(nodeId, peerId);
    return {
      peerId,
      createdAt: nowMs,
      lastRekeyAt: nowMs,
      sentCount: 0,
      receivedCount: 0,
      keyMaterialBase64,
      state: "open",
    };
  }

  public shouldRekey(session: MeshSession, nowMs: number): boolean {
    if (!this.config.enabled) {
      return false;
    }
    if (nowMs - session.lastRekeyAt >= this.config.rekeyAfterMs) {
      return true;
    }
    return session.sentCount + session.receivedCount >= this.config.rekeyAfterMessages;
  }

  public async rekeySession(nodeId: string, session: MeshSession, nowMs: number): Promise<MeshSession> {
    const keyMaterialBase64 = await this.deriveSessionKeyBase64(nodeId, session.peerId);
    return {
      ...session,
      keyMaterialBase64,
      lastRekeyAt: nowMs,
      sentCount: 0,
      receivedCount: 0,
      state: "open",
    };
  }

  public async encryptEnvelope(session: MeshSession, envelope: MeshRelayEnvelope): Promise<MeshRelayEnvelope> {
    if (!this.config.enabled) {
      return envelope;
    }

    const cryptoApi = getOptionalCrypto();
    if (cryptoApi == null) {
      warnCryptoUnavailableOnce();
      return envelope;
    }

    const key = await cryptoApi.subtle.importKey(
      "raw",
      asArrayBuffer(normalizeToAes256(base64ToBytes(session.keyMaterialBase64))),
      { name: "AES-GCM" },
      false,
      ["encrypt"]
    );

    const iv = new Uint8Array(12);
    cryptoApi.getRandomValues(iv);
    const plain = base64ToBytes(envelope.payloadBase64);
    const aad = metadataAAD(envelope);

    const encrypted = await cryptoApi.subtle.encrypt(
      {
        name: "AES-GCM",
        iv,
        additionalData: asArrayBuffer(aad),
        tagLength: 128,
      },
      key,
      asArrayBuffer(plain)
    );

    const encryptedBytes = new Uint8Array(encrypted);
    return {
      ...envelope,
      payloadBase64: bytesToBase64(concatBytes([iv, encryptedBytes])),
      authTagBase64: "aes-gcm-128",
    };
  }

  public async decryptEnvelope(session: MeshSession, envelope: MeshRelayEnvelope): Promise<MeshRelayEnvelope> {
    if (!this.config.enabled) {
      return envelope;
    }

    const cryptoApi = getOptionalCrypto();
    if (cryptoApi == null) {
      warnCryptoUnavailableOnce();
      return envelope;
    }

    const packed = base64ToBytes(envelope.payloadBase64);
    if (packed.byteLength <= 12) {
      throw new Error("E_SECURITY_PACKET_INVALID");
    }

    const iv = packed.slice(0, 12);
    const cipher = packed.slice(12);

    const key = await cryptoApi.subtle.importKey(
      "raw",
      asArrayBuffer(normalizeToAes256(base64ToBytes(session.keyMaterialBase64))),
      { name: "AES-GCM" },
      false,
      ["decrypt"]
    );

    const aad = metadataAAD(envelope);
    const plain = await cryptoApi.subtle.decrypt(
      {
        name: "AES-GCM",
        iv,
        additionalData: asArrayBuffer(aad),
        tagLength: 128,
      },
      key,
      asArrayBuffer(cipher)
    );

    return {
      ...envelope,
      payloadBase64: bytesToBase64(new Uint8Array(plain)),
      authTagBase64: null,
    };
  }

  private async deriveSessionKeyBase64(nodeId: string, peerId: string): Promise<string> {
    const cryptoApi = getOptionalCrypto();
    if (cryptoApi == null) {
      warnCryptoUnavailableOnce();
      const identityFallback = normalizeToAes256(base64ToBytes(this.config.identityKeyBase64));
      return bytesToBase64(identityFallback);
    }

    const identity = base64ToBytes(this.config.identityKeyBase64);
    if (identity.byteLength === 0) {
      throw new Error("E_SECURITY_IDENTITY_KEY_INVALID");
    }

    const ikm = await cryptoApi.subtle.importKey(
      "raw",
      asArrayBuffer(identity),
      { name: "HKDF" },
      false,
      ["deriveBits"]
    );

    const ordered = nodeId < peerId ? `${nodeId}|${peerId}` : `${peerId}|${nodeId}`;
    const info = new TextEncoder().encode(`mesh-session|${ordered}|${this.config.handshakeMode}`);

    const bits = await cryptoApi.subtle.deriveBits(
      {
        name: "HKDF",
        hash: "SHA-256",
        salt: asArrayBuffer(HKDF_SALT),
        info: asArrayBuffer(info),
      },
      ikm,
      256
    );

    return bytesToBase64(normalizeToAes256(new Uint8Array(bits)));
  }
}
