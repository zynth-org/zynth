import { Crypto, installGlobalCrypto, isCryptoAvailable } from "./Crypto";

void installGlobalCrypto({ overrideExisting: false });

export { Crypto, installGlobalCrypto, isCryptoAvailable };
export { Crypto as default };
export type {
  CryptoLike,
  SubtleCryptoLike,
  CryptoDigestAlgorithm,
  CryptoAlgorithmIdentifier,
  CryptoBufferSource,
  CryptoArrayBufferView,
  InstallGlobalCryptoOptions,
} from "./types";
