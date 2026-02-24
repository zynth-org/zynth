import { getGlobalObject } from "@zynth/core";
import { callNativeSync, isNativeAvailable } from "./native";
import type {
  AesGcmParams,
  AesKeyAlgorithm,
  CryptoAlgorithmIdentifier,
  CryptoArrayBufferView,
  CryptoBufferSource,
  CryptoDigestAlgorithm,
  CryptoKeyFormat,
  CryptoKeyLike,
  CryptoLike,
  DeriveBitsAlgorithm,
  GenerateKeyAlgorithm,
  HkdfParams,
  HmacImportParams,
  HmacKeyAlgorithm,
  HmacSignParams,
  ImportKeyAlgorithm,
  InstallGlobalCryptoOptions,
  KeyUsage,
  Pbkdf2Params,
  SubtleCryptoLike,
  SupportedKeyAlgorithm,
} from "./types";

const RANDOM_VALUES_MAX_BYTES = 65536;
const DATA_INPUT_MAX_BYTES = 16 * 1024 * 1024;
const DERIVED_BITS_MAX_BYTES = 8192;
const BASE64_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
const INTERNAL_CRYPTO_KEY = Symbol.for("zynth.crypto.internal_key");

type MutableCryptoKey = CryptoKeyLike & {
  [INTERNAL_CRYPTO_KEY]: {
    material: Uint8Array;
  };
};

const subtle: SubtleCryptoLike = {
  async digest(algorithm: CryptoAlgorithmIdentifier, data: CryptoBufferSource): Promise<ArrayBuffer> {
    const normalizedAlgorithm = normalizeDigestAlgorithm(algorithm);
    const bytes = toBytes(data);

    assertMaxLength(bytes.byteLength, DATA_INPUT_MAX_BYTES, "digest input");

    if (isNativeAvailable()) {
      const digestBase64 = callNativeSync<string>("digestBase64", {
        algorithm: normalizedAlgorithm,
        dataBase64: bytesToBase64(bytes),
      });
      const digestBytes = base64ToBytes(digestBase64);
      return copyToArrayBuffer(digestBytes);
    }

    const fallback = getFallbackSubtle();
    if (!fallback?.digest) {
      throw new Error("[ZynthCrypto] subtle.digest is unavailable on this platform");
    }

    return fallback.digest(normalizedAlgorithm, bytes);
  },

  async importKey(
    format: CryptoKeyFormat,
    keyData: CryptoBufferSource,
    algorithm: ImportKeyAlgorithm,
    extractable: boolean,
    keyUsages: KeyUsage[]
  ): Promise<CryptoKeyLike> {
    if (format !== "raw") {
      throw new Error("[ZynthCrypto] Only raw key import is supported");
    }

    const material = copyBytes(toBytes(keyData));
    const normalizedAlgorithm = normalizeImportKeyAlgorithm(algorithm, material);
    validateKeyUsages(normalizedAlgorithm.name, keyUsages);
    validateKeyMaterial(normalizedAlgorithm, material);

    return createKey(normalizedAlgorithm, extractable, keyUsages, material);
  },

  async exportKey(format: CryptoKeyFormat, key: CryptoKeyLike): Promise<ArrayBuffer> {
    if (format !== "raw") {
      throw new Error("[ZynthCrypto] Only raw key export is supported");
    }

    const internalKey = asInternalKey(key);
    if (!internalKey.extractable) {
      throw new Error("[ZynthCrypto] Key is not extractable");
    }

    return copyToArrayBuffer(internalKey[INTERNAL_CRYPTO_KEY].material);
  },

  async generateKey(
    algorithm: GenerateKeyAlgorithm,
    extractable: boolean,
    keyUsages: KeyUsage[]
  ): Promise<CryptoKeyLike> {
    const normalized = normalizeGenerateKeyAlgorithm(algorithm);
    validateKeyUsages(normalized.name, keyUsages);

    const materialLengthBytes = normalized.length / 8;
    const bytes = new Uint8Array(materialLengthBytes);
    nativeCrypto.getRandomValues(bytes);

    return createKey(normalized, extractable, keyUsages, bytes);
  },

  async sign(algorithm: HmacSignParams | CryptoAlgorithmIdentifier, key: CryptoKeyLike, data: CryptoBufferSource): Promise<ArrayBuffer> {
    const internalKey = asInternalKey(key);
    if (internalKey.algorithm.name !== "HMAC") {
      throw new Error("[ZynthCrypto] sign currently supports HMAC keys only");
    }
    ensureUsage(internalKey, "sign");
    assertAlgorithmName(algorithm, "HMAC");

    const bytes = toBytes(data);
    assertMaxLength(bytes.byteLength, DATA_INPUT_MAX_BYTES, "sign input");

    if (isNativeAvailable()) {
      const signatureBase64 = callNativeSync<string>("hmacBase64", {
        algorithm: internalKey.algorithm.hash.name,
        keyBase64: bytesToBase64(internalKey[INTERNAL_CRYPTO_KEY].material),
        dataBase64: bytesToBase64(bytes),
      });
      return copyToArrayBuffer(base64ToBytes(signatureBase64));
    }

    const fallback = getFallbackSubtle();
    if (!fallback?.sign) {
      throw new Error("[ZynthCrypto] subtle.sign is unavailable on this platform");
    }
    return (fallback.sign as (a: unknown, b: unknown, c: CryptoBufferSource) => Promise<ArrayBuffer>)(
      algorithm as unknown,
      key as unknown,
      bytes
    );
  },

  async verify(
    algorithm: HmacSignParams | CryptoAlgorithmIdentifier,
    key: CryptoKeyLike,
    signature: CryptoBufferSource,
    data: CryptoBufferSource
  ): Promise<boolean> {
    const internalKey = asInternalKey(key);
    if (internalKey.algorithm.name !== "HMAC") {
      throw new Error("[ZynthCrypto] verify currently supports HMAC keys only");
    }
    ensureUsage(internalKey, "verify");
    assertAlgorithmName(algorithm, "HMAC");

    const expectedSignature = toBytes(signature);
    const dataBytes = toBytes(data);
    assertMaxLength(dataBytes.byteLength, DATA_INPUT_MAX_BYTES, "verify input");

    const computed = new Uint8Array(await subtle.sign({ name: "HMAC" }, key, dataBytes));
    return constantTimeEqual(computed, expectedSignature);
  },

  async deriveBits(algorithm: DeriveBitsAlgorithm, baseKey: CryptoKeyLike, length: number): Promise<ArrayBuffer> {
    const internalKey = asInternalKey(baseKey);
    ensureUsage(internalKey, "deriveBits");

    if (!Number.isInteger(length) || length <= 0 || length % 8 !== 0) {
      throw new Error("[ZynthCrypto] deriveBits length must be a positive multiple of 8");
    }
    const lengthBytes = length / 8;
    if (lengthBytes > DERIVED_BITS_MAX_BYTES) {
      throw new Error(`[ZynthCrypto] deriveBits length exceeds ${DERIVED_BITS_MAX_BYTES} bytes`);
    }

    if (algorithm.name === "HKDF") {
      if (internalKey.algorithm.name !== "HKDF") {
        throw new Error("[ZynthCrypto] HKDF deriveBits requires an HKDF base key");
      }
      const params = normalizeHkdfParams(algorithm);
      const derivedBase64 = callNativeSync<string>("hkdfDeriveBitsBase64", {
        algorithm: params.hash,
        keyBase64: bytesToBase64(internalKey[INTERNAL_CRYPTO_KEY].material),
        saltBase64: bytesToBase64(params.salt),
        infoBase64: bytesToBase64(params.info),
        lengthBytes,
      });
      return copyToArrayBuffer(base64ToBytes(derivedBase64));
    }

    if (algorithm.name === "PBKDF2") {
      if (internalKey.algorithm.name !== "PBKDF2") {
        throw new Error("[ZynthCrypto] PBKDF2 deriveBits requires a PBKDF2 base key");
      }
      const params = normalizePbkdf2Params(algorithm);
      const derivedBase64 = callNativeSync<string>("pbkdf2DeriveBitsBase64", {
        algorithm: params.hash,
        keyBase64: bytesToBase64(internalKey[INTERNAL_CRYPTO_KEY].material),
        saltBase64: bytesToBase64(params.salt),
        iterations: params.iterations,
        lengthBytes,
      });
      return copyToArrayBuffer(base64ToBytes(derivedBase64));
    }

    throw new Error("[ZynthCrypto] Unsupported deriveBits algorithm");
  },

  async encrypt(algorithm: AesGcmParams, key: CryptoKeyLike, data: CryptoBufferSource): Promise<ArrayBuffer> {
    const internalKey = asInternalKey(key);
    if (internalKey.algorithm.name !== "AES-GCM") {
      throw new Error("[ZynthCrypto] encrypt supports AES-GCM keys only");
    }
    ensureUsage(internalKey, "encrypt");

    const params = normalizeAesGcmParams(algorithm);
    const input = toBytes(data);
    assertMaxLength(input.byteLength, DATA_INPUT_MAX_BYTES, "encrypt input");

    const encryptedBase64 = callNativeSync<string>("aesGcmEncryptBase64", {
      keyBase64: bytesToBase64(internalKey[INTERNAL_CRYPTO_KEY].material),
      ivBase64: bytesToBase64(params.iv),
      additionalDataBase64: bytesToBase64(params.additionalData),
      dataBase64: bytesToBase64(input),
      tagLengthBits: params.tagLength,
    });
    return copyToArrayBuffer(base64ToBytes(encryptedBase64));
  },

  async decrypt(algorithm: AesGcmParams, key: CryptoKeyLike, data: CryptoBufferSource): Promise<ArrayBuffer> {
    const internalKey = asInternalKey(key);
    if (internalKey.algorithm.name !== "AES-GCM") {
      throw new Error("[ZynthCrypto] decrypt supports AES-GCM keys only");
    }
    ensureUsage(internalKey, "decrypt");

    const params = normalizeAesGcmParams(algorithm);
    const input = toBytes(data);
    assertMaxLength(input.byteLength, DATA_INPUT_MAX_BYTES, "decrypt input");

    const plainBase64 = callNativeSync<string>("aesGcmDecryptBase64", {
      keyBase64: bytesToBase64(internalKey[INTERNAL_CRYPTO_KEY].material),
      ivBase64: bytesToBase64(params.iv),
      additionalDataBase64: bytesToBase64(params.additionalData),
      dataBase64: bytesToBase64(input),
      tagLengthBits: params.tagLength,
    });
    return copyToArrayBuffer(base64ToBytes(plainBase64));
  },
};

const nativeCrypto: CryptoLike = {
  getRandomValues<T extends CryptoArrayBufferView>(typedArray: T): T {
    assertIntegerTypedArray(typedArray);

    if (typedArray.byteLength > RANDOM_VALUES_MAX_BYTES) {
      throw new Error("[ZynthCrypto] getRandomValues request exceeds 65536 bytes");
    }
    if (typedArray.byteLength === 0) {
      return typedArray;
    }

    if (isNativeAvailable()) {
      const randomBase64 = callNativeSync<string>("getRandomBase64", {
        size: typedArray.byteLength,
      });
      const randomBytes = base64ToBytes(randomBase64);
      if (randomBytes.byteLength !== typedArray.byteLength) {
        throw new Error("[ZynthCrypto] native random source returned unexpected byte length");
      }
      new Uint8Array(typedArray.buffer, typedArray.byteOffset, typedArray.byteLength).set(randomBytes);
      return typedArray;
    }

    const fallbackCrypto = getFallbackCrypto();
    if (!fallbackCrypto?.getRandomValues) {
      throw new Error("[ZynthCrypto] getRandomValues is unavailable on this platform");
    }

    return fallbackCrypto.getRandomValues(typedArray);
  },

  randomUUID(): string {
    if (isNativeAvailable()) {
      return callNativeSync<string>("randomUUID", {});
    }

    const fallbackCrypto = getFallbackCrypto();
    if (fallbackCrypto?.randomUUID) {
      return fallbackCrypto.randomUUID();
    }

    const bytes = new Uint8Array(16);
    nativeCrypto.getRandomValues(bytes);
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const hex = Array.from(bytes, (value) => value.toString(16).padStart(2, "0")).join("");
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  },

  subtle,
};

export const Crypto: CryptoLike = nativeCrypto;

export function installGlobalCrypto(options: InstallGlobalCryptoOptions = {}): CryptoLike {
  const globalObject = getGlobalObject() as Record<string, unknown>;
  const existing = globalObject.crypto;

  if (!options.overrideExisting && isCryptoLike(existing)) {
    return existing;
  }

  Object.defineProperty(globalObject, "crypto", {
    configurable: true,
    enumerable: false,
    writable: false,
    value: nativeCrypto,
  });

  return nativeCrypto;
}

export function isCryptoAvailable(): boolean {
  if (isNativeAvailable()) {
    return true;
  }
  const globalObject = getGlobalObject() as Record<string, unknown>;
  return isCryptoLike(globalObject.crypto);
}

function getFallbackCrypto(): CryptoLike | undefined {
  const globalObject = getGlobalObject() as Record<string, unknown>;
  return globalObject.crypto as CryptoLike | undefined;
}

function getFallbackSubtle(): SubtleCryptoLike | undefined {
  const fallback = getFallbackCrypto();
  return fallback?.subtle;
}

function isCryptoLike(value: unknown): value is CryptoLike {
  if (!value || typeof value !== "object") {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.getRandomValues === "function" &&
    typeof candidate.randomUUID === "function" &&
    typeof candidate.subtle === "object" &&
    candidate.subtle !== null
  );
}

function asInternalKey(key: CryptoKeyLike): MutableCryptoKey {
  if (!key || typeof key !== "object") {
    throw new TypeError("[ZynthCrypto] Invalid CryptoKey");
  }
  const mutableKey = key as MutableCryptoKey;
  const internal = mutableKey[INTERNAL_CRYPTO_KEY];
  if (!internal || !(internal.material instanceof Uint8Array)) {
    throw new TypeError("[ZynthCrypto] Unsupported CryptoKey instance");
  }
  return mutableKey;
}

function createKey(
  algorithm: SupportedKeyAlgorithm,
  extractable: boolean,
  usages: ReadonlyArray<KeyUsage>,
  material: Uint8Array
): CryptoKeyLike {
  const key: MutableCryptoKey = {
    type: "secret",
    extractable,
    algorithm,
    usages: Object.freeze([...usages]),
    [INTERNAL_CRYPTO_KEY]: {
      material: copyBytes(material),
    },
  };

  return Object.freeze(key);
}

function ensureUsage(key: CryptoKeyLike, usage: KeyUsage): void {
  if (!key.usages.includes(usage)) {
    throw new Error(`[ZynthCrypto] Key does not allow '${usage}' usage`);
  }
}

function validateKeyUsages(algorithmName: string, usages: ReadonlyArray<KeyUsage>): void {
  const allowed = getAllowedUsages(algorithmName);
  for (const usage of usages) {
    if (!allowed.has(usage)) {
      throw new Error(`[ZynthCrypto] Key usage '${usage}' is not valid for ${algorithmName}`);
    }
  }
}

function getAllowedUsages(algorithmName: string): Set<KeyUsage> {
  switch (algorithmName) {
    case "HMAC":
      return new Set<KeyUsage>(["sign", "verify"]);
    case "AES-GCM":
      return new Set<KeyUsage>(["encrypt", "decrypt", "wrapKey", "unwrapKey"]);
    case "PBKDF2":
    case "HKDF":
      return new Set<KeyUsage>(["deriveBits", "deriveKey"]);
    default:
      return new Set<KeyUsage>();
  }
}

function validateKeyMaterial(algorithm: SupportedKeyAlgorithm, material: Uint8Array): void {
  if (material.byteLength === 0) {
    throw new Error("[ZynthCrypto] key material cannot be empty");
  }

  if (algorithm.name === "AES-GCM") {
    const bits = material.byteLength * 8;
    if (bits !== 128 && bits !== 192 && bits !== 256) {
      throw new Error("[ZynthCrypto] AES-GCM key length must be 128, 192, or 256 bits");
    }
  }

  if (algorithm.name === "HMAC" && algorithm.length !== material.byteLength * 8) {
    throw new Error("[ZynthCrypto] HMAC key length does not match key material");
  }
}

function normalizeImportKeyAlgorithm(algorithm: ImportKeyAlgorithm, material: Uint8Array): SupportedKeyAlgorithm {
  switch (algorithm.name) {
    case "HMAC": {
      const hash = normalizeDigestAlgorithm(algorithm.hash);
      const length = algorithm.length ?? material.byteLength * 8;
      validateHmacLength(length);
      return {
        name: "HMAC",
        hash: { name: hash },
        length,
      };
    }
    case "PBKDF2":
      return { name: "PBKDF2" };
    case "HKDF":
      return { name: "HKDF" };
    case "AES-GCM": {
      const bits = material.byteLength * 8;
      if (bits !== 128 && bits !== 192 && bits !== 256) {
        throw new Error("[ZynthCrypto] AES-GCM key length must be 128, 192, or 256 bits");
      }
      return { name: "AES-GCM", length: bits };
    }
    default:
      throw new Error(`[ZynthCrypto] Unsupported import algorithm: ${(algorithm as { name: string }).name}`);
  }
}

function normalizeGenerateKeyAlgorithm(algorithm: GenerateKeyAlgorithm): HmacKeyAlgorithm | AesKeyAlgorithm {
  switch (algorithm.name) {
    case "HMAC": {
      const hash = normalizeDigestAlgorithm(algorithm.hash);
      const length = algorithm.length ?? defaultHmacLength(hash);
      validateHmacLength(length);
      return {
        name: "HMAC",
        hash: { name: hash },
        length,
      };
    }
    case "AES-GCM": {
      const length = algorithm.length;
      if (length !== 128 && length !== 192 && length !== 256) {
        throw new Error("[ZynthCrypto] AES-GCM generated key length must be 128, 192, or 256 bits");
      }
      return { name: "AES-GCM", length };
    }
    default:
      throw new Error(`[ZynthCrypto] Unsupported generateKey algorithm: ${(algorithm as { name: string }).name}`);
  }
}

function defaultHmacLength(hash: CryptoDigestAlgorithm): number {
  switch (hash) {
    case "SHA-1":
      return 160;
    case "SHA-256":
      return 256;
    case "SHA-384":
      return 384;
    case "SHA-512":
      return 512;
  }
}

function validateHmacLength(length: number): void {
  if (!Number.isInteger(length) || length <= 0 || length % 8 !== 0) {
    throw new Error("[ZynthCrypto] HMAC key length must be a positive multiple of 8");
  }
}

function normalizeDigestAlgorithm(algorithm: CryptoAlgorithmIdentifier): CryptoDigestAlgorithm {
  const rawName =
    typeof algorithm === "string"
      ? algorithm
      : typeof algorithm === "object" && algorithm !== null
        ? algorithm.name
        : "";

  const normalized = rawName.trim().toUpperCase();
  switch (normalized) {
    case "SHA-1":
    case "SHA-256":
    case "SHA-384":
    case "SHA-512":
      return normalized;
    default:
      throw new Error(`[ZynthCrypto] Unsupported digest algorithm: ${rawName}`);
  }
}

function assertAlgorithmName(algorithm: HmacSignParams | CryptoAlgorithmIdentifier, expectedName: string): void {
  const rawName =
    typeof algorithm === "string"
      ? algorithm
      : typeof algorithm === "object" && algorithm !== null
        ? algorithm.name
        : "";
  if (rawName.toUpperCase() !== expectedName) {
    throw new Error(`[ZynthCrypto] Unsupported algorithm: ${rawName}`);
  }
}

function normalizeHkdfParams(params: HkdfParams): {
  hash: CryptoDigestAlgorithm;
  salt: Uint8Array;
  info: Uint8Array;
} {
  const hash = normalizeDigestAlgorithm(params.hash);
  const salt = toBytes(params.salt);
  const info = toBytes(params.info);
  assertMaxLength(salt.byteLength, DATA_INPUT_MAX_BYTES, "HKDF salt");
  assertMaxLength(info.byteLength, DATA_INPUT_MAX_BYTES, "HKDF info");
  return { hash, salt, info };
}

function normalizePbkdf2Params(params: Pbkdf2Params): {
  hash: CryptoDigestAlgorithm;
  salt: Uint8Array;
  iterations: number;
} {
  if (!Number.isInteger(params.iterations) || params.iterations <= 0) {
    throw new Error("[ZynthCrypto] PBKDF2 iterations must be a positive integer");
  }
  const hash = normalizeDigestAlgorithm(params.hash);
  const salt = toBytes(params.salt);
  assertMaxLength(salt.byteLength, DATA_INPUT_MAX_BYTES, "PBKDF2 salt");
  return {
    hash,
    salt,
    iterations: params.iterations,
  };
}

function normalizeAesGcmParams(params: AesGcmParams): {
  iv: Uint8Array;
  additionalData: Uint8Array;
  tagLength: number;
} {
  if (params.name !== "AES-GCM") {
    throw new Error("[ZynthCrypto] AES-GCM parameters are required");
  }

  const iv = toBytes(params.iv);
  const additionalData = params.additionalData ? toBytes(params.additionalData) : new Uint8Array(0);
  const tagLength = params.tagLength ?? 128;

  if (iv.byteLength < 12 || iv.byteLength > 16) {
    throw new Error("[ZynthCrypto] AES-GCM iv length must be between 12 and 16 bytes");
  }
  if (tagLength !== 128) {
    throw new Error("[ZynthCrypto] AES-GCM currently supports tagLength 128 bits only");
  }

  return {
    iv,
    additionalData,
    tagLength,
  };
}

function assertIntegerTypedArray(value: unknown): asserts value is CryptoArrayBufferView {
  if (
    value instanceof Int8Array ||
    value instanceof Uint8Array ||
    value instanceof Uint8ClampedArray ||
    value instanceof Int16Array ||
    value instanceof Uint16Array ||
    value instanceof Int32Array ||
    value instanceof Uint32Array ||
    value instanceof BigInt64Array ||
    value instanceof BigUint64Array
  ) {
    return;
  }
  throw new TypeError("[ZynthCrypto] getRandomValues expects an integer TypedArray");
}

function toBytes(data: CryptoBufferSource): Uint8Array {
  if (data instanceof ArrayBuffer) {
    return new Uint8Array(data);
  }
  if (ArrayBuffer.isView(data)) {
    return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  }
  throw new TypeError("[ZynthCrypto] Expected BufferSource data");
}

function copyBytes(bytes: Uint8Array): Uint8Array {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy;
}

function copyToArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = copyBytes(bytes);
  const view = copy.buffer.slice(copy.byteOffset, copy.byteOffset + copy.byteLength);
  return view as ArrayBuffer;
}

function assertMaxLength(length: number, max: number, label: string): void {
  if (length > max) {
    throw new Error(`[ZynthCrypto] ${label} exceeds ${max} bytes`);
  }
}

function bytesToBase64(bytes: Uint8Array): string {
  if (bytes.length === 0) {
    return "";
  }

  let output = "";
  for (let i = 0; i < bytes.length; i += 3) {
    const remaining = bytes.length - i;
    const a = bytes[i];
    const b = remaining > 1 ? bytes[i + 1] : 0;
    const c = remaining > 2 ? bytes[i + 2] : 0;

    const triplet = (a << 16) | (b << 8) | c;

    output += BASE64_ALPHABET[(triplet >> 18) & 0x3f];
    output += BASE64_ALPHABET[(triplet >> 12) & 0x3f];
    output += remaining > 1 ? BASE64_ALPHABET[(triplet >> 6) & 0x3f] : "=";
    output += remaining > 2 ? BASE64_ALPHABET[triplet & 0x3f] : "=";
  }

  return output;
}

function base64ToBytes(base64: string): Uint8Array {
  const clean = base64.replace(/\s+/g, "");
  if (clean.length === 0) {
    return new Uint8Array(0);
  }
  if (clean.length % 4 !== 0) {
    throw new Error("[ZynthCrypto] Invalid base64 length");
  }

  const padding = clean.endsWith("==") ? 2 : clean.endsWith("=") ? 1 : 0;
  const bytesLength = (clean.length * 3) / 4 - padding;
  const out = new Uint8Array(bytesLength);

  let outIndex = 0;
  for (let i = 0; i < clean.length; i += 4) {
    const c0 = decodeBase64Char(clean.charCodeAt(i));
    const c1 = decodeBase64Char(clean.charCodeAt(i + 1));
    const c2 = clean.charCodeAt(i + 2) === 61 ? 0 : decodeBase64Char(clean.charCodeAt(i + 2));
    const c3 = clean.charCodeAt(i + 3) === 61 ? 0 : decodeBase64Char(clean.charCodeAt(i + 3));

    const chunk = (c0 << 18) | (c1 << 12) | (c2 << 6) | c3;

    if (outIndex < bytesLength) out[outIndex++] = (chunk >> 16) & 0xff;
    if (outIndex < bytesLength) out[outIndex++] = (chunk >> 8) & 0xff;
    if (outIndex < bytesLength) out[outIndex++] = chunk & 0xff;
  }

  return out;
}

function decodeBase64Char(code: number): number {
  if (code >= 65 && code <= 90) return code - 65;
  if (code >= 97 && code <= 122) return code - 71;
  if (code >= 48 && code <= 57) return code + 4;
  if (code === 43) return 62;
  if (code === 47) return 63;
  throw new Error("[ZynthCrypto] Invalid base64 data");
}

function constantTimeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.byteLength !== b.byteLength) {
    return false;
  }
  let diff = 0;
  for (let i = 0; i < a.byteLength; i += 1) {
    diff |= a[i] ^ b[i];
  }
  return diff === 0;
}
