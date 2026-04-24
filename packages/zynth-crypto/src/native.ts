import {
  callNative as coreCallNative,
  callNativeSync as coreCallNativeSync,
  getGlobalObject,
  getModulesBridge,
} from "@zynthjs/core";

type RandomArgs = { size: number };
type DigestArgs = { algorithm: string; dataBase64: string };
type HmacArgs = { algorithm: string; keyBase64: string; dataBase64: string };
type HkdfArgs = {
  algorithm: string;
  keyBase64: string;
  saltBase64: string;
  infoBase64: string;
  lengthBytes: number;
};
type Pbkdf2Args = {
  algorithm: string;
  keyBase64: string;
  saltBase64: string;
  iterations: number;
  lengthBytes: number;
};
type AesGcmArgs = {
  keyBase64: string;
  ivBase64: string;
  additionalDataBase64: string;
  dataBase64: string;
  tagLengthBits: number;
};

export type NativeCryptoJSI = {
  getRandomBase64(size: number): string;
  randomUUID(): string;
  digestBase64(algorithm: string, dataBase64: string): string;
  hmacBase64(algorithm: string, keyBase64: string, dataBase64: string): string;
  hkdfDeriveBitsBase64(
    algorithm: string,
    keyBase64: string,
    saltBase64: string,
    infoBase64: string,
    lengthBytes: number
  ): string;
  pbkdf2DeriveBitsBase64(
    algorithm: string,
    keyBase64: string,
    saltBase64: string,
    iterations: number,
    lengthBytes: number
  ): string;
  aesGcmEncryptBase64(
    keyBase64: string,
    ivBase64: string,
    additionalDataBase64: string,
    dataBase64: string,
    tagLengthBits: number
  ): string;
  aesGcmDecryptBase64(
    keyBase64: string,
    ivBase64: string,
    additionalDataBase64: string,
    dataBase64: string,
    tagLengthBits: number
  ): string;
};

const MODULE_NAME = "ZynthCrypto";
const PLATFORM_GLOBAL_KEY = "__ZYNTH_PLATFORM";
const JSI_GLOBAL_KEY = "__zynth_crypto";

function getPlatform(): string | null {
  const globalObject = getGlobalObject() as Record<string, unknown>;
  const value = globalObject[PLATFORM_GLOBAL_KEY];
  return typeof value === "string" ? value.toLowerCase() : null;
}

function getNativeJSI(): NativeCryptoJSI | null {
  const globalObject = getGlobalObject() as Record<string, unknown>;
  const value = globalObject[JSI_GLOBAL_KEY];
  if (!value || typeof value !== "object") {
    return null;
  }
  return value as NativeCryptoJSI;
}

function createMissingModuleError(): Error {
  return new Error(
    `[${MODULE_NAME}] Native module not found. Ensure @zynthjs/crypto is installed and native projects are regenerated.`
  );
}

function callJsiMethod<T>(native: NativeCryptoJSI, method: string, args?: unknown): T {
  switch (method) {
    case "getRandomBase64":
      return native.getRandomBase64((args as RandomArgs).size) as T;
    case "randomUUID":
      return native.randomUUID() as T;
    case "digestBase64": {
      const payload = args as DigestArgs;
      return native.digestBase64(payload.algorithm, payload.dataBase64) as T;
    }
    case "hmacBase64": {
      const payload = args as HmacArgs;
      return native.hmacBase64(payload.algorithm, payload.keyBase64, payload.dataBase64) as T;
    }
    case "hkdfDeriveBitsBase64": {
      const payload = args as HkdfArgs;
      return native.hkdfDeriveBitsBase64(
        payload.algorithm,
        payload.keyBase64,
        payload.saltBase64,
        payload.infoBase64,
        payload.lengthBytes
      ) as T;
    }
    case "pbkdf2DeriveBitsBase64": {
      const payload = args as Pbkdf2Args;
      return native.pbkdf2DeriveBitsBase64(
        payload.algorithm,
        payload.keyBase64,
        payload.saltBase64,
        payload.iterations,
        payload.lengthBytes
      ) as T;
    }
    case "aesGcmEncryptBase64": {
      const payload = args as AesGcmArgs;
      return native.aesGcmEncryptBase64(
        payload.keyBase64,
        payload.ivBase64,
        payload.additionalDataBase64,
        payload.dataBase64,
        payload.tagLengthBits
      ) as T;
    }
    case "aesGcmDecryptBase64": {
      const payload = args as AesGcmArgs;
      return native.aesGcmDecryptBase64(
        payload.keyBase64,
        payload.ivBase64,
        payload.additionalDataBase64,
        payload.dataBase64,
        payload.tagLengthBits
      ) as T;
    }
    default:
      throw new Error(`Unsupported method ${method}`);
  }
}

export async function callNative<T>(method: string, args?: unknown): Promise<T> {
  const native = getNativeJSI();
  if (native) {
    return callJsiMethod<T>(native, method, args);
  }

  try {
    return await coreCallNative<T>(MODULE_NAME, method, args);
  } catch (error: unknown) {
    if (error instanceof Error && (error.message.includes("module_not_found") || error.message.includes("not found"))) {
      throw createMissingModuleError();
    }
    throw error;
  }
}

export function callNativeSync<T>(method: string, args?: unknown): T {
  const native = getNativeJSI();
  if (native) {
    return callJsiMethod<T>(native, method, args);
  }

  try {
    return coreCallNativeSync<T>(MODULE_NAME, method, args);
  } catch (error: unknown) {
    if (error instanceof Error && (error.message.includes("module_not_found") || error.message.includes("not found"))) {
      throw createMissingModuleError();
    }
    throw error;
  }
}

export function isNativeAvailable(): boolean {
  const platform = getPlatform();
  if (platform !== "ios" && platform !== "android") {
    return false;
  }
  const bridge = getModulesBridge();
  return Boolean(getNativeJSI() || bridge?.callSync || bridge?.call);
}
