export type CryptoDigestAlgorithm = "SHA-1" | "SHA-256" | "SHA-384" | "SHA-512";

export type CryptoAlgorithmIdentifier =
  | CryptoDigestAlgorithm
  | {
      name: string;
    };

export type CryptoArrayBufferView =
  | Int8Array
  | Uint8Array
  | Uint8ClampedArray
  | Int16Array
  | Uint16Array
  | Int32Array
  | Uint32Array
  | BigInt64Array
  | BigUint64Array;

export type CryptoBufferSource = ArrayBuffer | ArrayBufferView;
export type CryptoKeyType = "secret";
export type CryptoKeyFormat = "raw";

export type KeyUsage =
  | "encrypt"
  | "decrypt"
  | "sign"
  | "verify"
  | "deriveBits"
  | "deriveKey"
  | "wrapKey"
  | "unwrapKey";

export type HmacImportParams = {
  name: "HMAC";
  hash: CryptoAlgorithmIdentifier;
  length?: number;
};

export type HmacKeyAlgorithm = {
  name: "HMAC";
  hash: { name: CryptoDigestAlgorithm };
  length: number;
};

export type HmacKeyGenParams = {
  name: "HMAC";
  hash: CryptoAlgorithmIdentifier;
  length?: number;
};

export type HmacSignParams = {
  name: "HMAC";
};

export type AesGcmParams = {
  name: "AES-GCM";
  iv: CryptoBufferSource;
  additionalData?: CryptoBufferSource;
  tagLength?: number;
};

export type AesKeyAlgorithm = {
  name: "AES-GCM";
  length: number;
};

export type AesKeyGenParams = {
  name: "AES-GCM";
  length: number;
};

export type Pbkdf2Params = {
  name: "PBKDF2";
  salt: CryptoBufferSource;
  iterations: number;
  hash: CryptoAlgorithmIdentifier;
};

export type Pbkdf2KeyAlgorithm = {
  name: "PBKDF2";
};

export type HkdfParams = {
  name: "HKDF";
  salt: CryptoBufferSource;
  info: CryptoBufferSource;
  hash: CryptoAlgorithmIdentifier;
};

export type HkdfKeyAlgorithm = {
  name: "HKDF";
};

export type DeriveBitsAlgorithm = HkdfParams | Pbkdf2Params;

export type ImportKeyAlgorithm = HmacImportParams | { name: "HKDF" } | { name: "PBKDF2" } | { name: "AES-GCM" };
export type GenerateKeyAlgorithm = HmacKeyGenParams | AesKeyGenParams;

export type SupportedKeyAlgorithm = HmacKeyAlgorithm | Pbkdf2KeyAlgorithm | HkdfKeyAlgorithm | AesKeyAlgorithm;

export interface CryptoKeyLike {
  type: CryptoKeyType;
  extractable: boolean;
  algorithm: SupportedKeyAlgorithm;
  usages: ReadonlyArray<KeyUsage>;
}

export interface SubtleCryptoLike {
  digest(algorithm: CryptoAlgorithmIdentifier, data: CryptoBufferSource): Promise<ArrayBuffer>;
  importKey(
    format: CryptoKeyFormat,
    keyData: CryptoBufferSource,
    algorithm: ImportKeyAlgorithm,
    extractable: boolean,
    keyUsages: KeyUsage[]
  ): Promise<CryptoKeyLike>;
  exportKey(format: CryptoKeyFormat, key: CryptoKeyLike): Promise<ArrayBuffer>;
  generateKey(
    algorithm: GenerateKeyAlgorithm,
    extractable: boolean,
    keyUsages: KeyUsage[]
  ): Promise<CryptoKeyLike>;
  sign(algorithm: HmacSignParams | CryptoAlgorithmIdentifier, key: CryptoKeyLike, data: CryptoBufferSource): Promise<ArrayBuffer>;
  verify(
    algorithm: HmacSignParams | CryptoAlgorithmIdentifier,
    key: CryptoKeyLike,
    signature: CryptoBufferSource,
    data: CryptoBufferSource
  ): Promise<boolean>;
  deriveBits(algorithm: DeriveBitsAlgorithm, baseKey: CryptoKeyLike, length: number): Promise<ArrayBuffer>;
  encrypt(algorithm: AesGcmParams, key: CryptoKeyLike, data: CryptoBufferSource): Promise<ArrayBuffer>;
  decrypt(algorithm: AesGcmParams, key: CryptoKeyLike, data: CryptoBufferSource): Promise<ArrayBuffer>;
}

export interface CryptoLike {
  getRandomValues<T extends CryptoArrayBufferView>(typedArray: T): T;
  randomUUID(): string;
  subtle: SubtleCryptoLike;
}

export type InstallGlobalCryptoOptions = {
  overrideExisting?: boolean;
};
