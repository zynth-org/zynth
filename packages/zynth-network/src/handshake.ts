import { callNative, isNativeAvailable } from "./native";
import type {
  NetworkAuthenticatePeerOptions,
  NetworkAuthenticatePeerResult,
  NetworkPeerChallenge,
} from "./types";

const DEFAULT_CHALLENGE_BYTES = 32;
const MIN_CHALLENGE_BYTES = 16;
const MAX_CHALLENGE_BYTES = 4096;
const DEFAULT_MAX_SIGNED_AGE_MS = 60 * 1000;
const DEFAULT_ALLOWED_CLOCK_SKEW_MS = 15 * 1000;

function toBase64(bytes: Uint8Array): string {
  let output = "";
  for (let index = 0; index < bytes.length; index += 1) {
    output += String.fromCharCode(bytes[index] as number);
  }
  if (typeof btoa === "function") {
    return btoa(output);
  }
  const bufferCtor = (globalThis as Record<string, unknown>).Buffer as
    | { from(input: Uint8Array): { toString(encoding: string): string } }
    | undefined;
  if (bufferCtor) {
    return bufferCtor.from(bytes).toString("base64");
  }
  throw new Error("No base64 encoder is available in this runtime");
}

function createRandomBytes(length: number): Uint8Array {
  const output = new Uint8Array(length);
  const cryptoValue = (globalThis as Record<string, unknown>).crypto as
    | { getRandomValues(value: Uint8Array): Uint8Array }
    | undefined;
  if (cryptoValue?.getRandomValues) {
    cryptoValue.getRandomValues(output);
    return output;
  }
  for (let index = 0; index < output.length; index += 1) {
    output[index] = Math.floor(Math.random() * 256);
  }
  return output;
}

function normalizeChallengeSize(bytes: number | undefined): number {
  if (typeof bytes !== "number" || !Number.isFinite(bytes)) {
    return DEFAULT_CHALLENGE_BYTES;
  }
  const normalized = Math.round(bytes);
  if (normalized < MIN_CHALLENGE_BYTES) {
    return MIN_CHALLENGE_BYTES;
  }
  if (normalized > MAX_CHALLENGE_BYTES) {
    return MAX_CHALLENGE_BYTES;
  }
  return normalized;
}

function normalizeTimestamp(value: unknown, fallback: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return fallback;
  }
  return Math.round(value);
}

export function createPeerChallenge(
  challengeBytes = DEFAULT_CHALLENGE_BYTES
): NetworkPeerChallenge {
  const bytes = normalizeChallengeSize(challengeBytes);
  return {
    challengeBase64: toBase64(createRandomBytes(bytes)),
    issuedAt: Date.now(),
  };
}

export async function authenticatePeerAsync(
  options: NetworkAuthenticatePeerOptions
): Promise<NetworkAuthenticatePeerResult> {
  if (!options || typeof options !== "object") {
    throw new Error("options are required");
  }
  const challengeBase64 = options.challengeBase64?.trim();
  if (!challengeBase64) {
    throw new Error("challengeBase64 is required");
  }

  if (!isNativeAvailable()) {
    throw new Error("Network module is not available on this platform");
  }
  const verified = await callNative<boolean>("verifyChallenge", {
    publicKeyBase64: options.proof.publicKeyBase64.trim(),
    challengeBase64,
    signatureBase64: options.proof.signatureBase64.trim(),
  });
  if (!verified) {
    return {
      verified: false,
      trusted: false,
      trustReason: "none",
      reason: "signature_mismatch",
      peer: {
        algorithm: options.proof.algorithm,
        keyId: options.proof.keyId,
        publicKeyBase64: options.proof.publicKeyBase64,
        fingerprintSha256: options.proof.fingerprintSha256,
      },
      signedAt: options.proof.signedAt,
    };
  }

  const signedAt = normalizeTimestamp(options.proof.signedAt, Date.now());
  const issuedAt = normalizeTimestamp(options.issuedAt, signedAt);
  const now = Date.now();
  const maxSignedAgeMs =
    typeof options.maxSignedAgeMs === "number" && options.maxSignedAgeMs > 0
      ? Math.round(options.maxSignedAgeMs)
      : DEFAULT_MAX_SIGNED_AGE_MS;
  const allowedClockSkewMs =
    typeof options.allowedClockSkewMs === "number" && options.allowedClockSkewMs >= 0
      ? Math.round(options.allowedClockSkewMs)
      : DEFAULT_ALLOWED_CLOCK_SKEW_MS;

  if (signedAt < issuedAt - allowedClockSkewMs) {
    return {
      verified: false,
      trusted: false,
      trustReason: "none",
      reason: "signed_before_challenge",
      peer: {
        algorithm: options.proof.algorithm,
        keyId: options.proof.keyId,
        publicKeyBase64: options.proof.publicKeyBase64,
        fingerprintSha256: options.proof.fingerprintSha256,
      },
      signedAt,
    };
  }

  if (now - signedAt > maxSignedAgeMs + allowedClockSkewMs) {
    return {
      verified: false,
      trusted: false,
      trustReason: "none",
      reason: "proof_expired",
      peer: {
        algorithm: options.proof.algorithm,
        keyId: options.proof.keyId,
        publicKeyBase64: options.proof.publicKeyBase64,
        fingerprintSha256: options.proof.fingerprintSha256,
      },
      signedAt,
    };
  }

  if (
    options.expectedFingerprintSha256 &&
    options.expectedFingerprintSha256.trim().toLowerCase() !==
      options.proof.fingerprintSha256.trim().toLowerCase()
  ) {
    return {
      verified: false,
      trusted: false,
      trustReason: "none",
      reason: "fingerprint_mismatch",
      peer: {
        algorithm: options.proof.algorithm,
        keyId: options.proof.keyId,
        publicKeyBase64: options.proof.publicKeyBase64,
        fingerprintSha256: options.proof.fingerprintSha256,
      },
      signedAt,
    };
  }

  if (
    options.expectedKeyId &&
    options.expectedKeyId.trim() &&
    options.expectedKeyId.trim() !== options.proof.keyId
  ) {
    return {
      verified: false,
      trusted: false,
      trustReason: "none",
      reason: "key_id_mismatch",
      peer: {
        algorithm: options.proof.algorithm,
        keyId: options.proof.keyId,
        publicKeyBase64: options.proof.publicKeyBase64,
        fingerprintSha256: options.proof.fingerprintSha256,
      },
      signedAt,
    };
  }

  let trusted = false;
  let trustReason: "none" | "known" | "tofu" = "none";
  if (options.trustStore) {
    const known = await options.trustStore.isTrustedAsync(
      options.proof.fingerprintSha256
    );
    if (known) {
      trusted = true;
      trustReason = "known";
    } else if (options.trustOnFirstUse === true) {
      await options.trustStore.touchVerifiedAsync(options.proof.fingerprintSha256, {
        verifiedAt: signedAt,
        alias: options.alias,
        publicKeyBase64: options.proof.publicKeyBase64,
        keyId: options.proof.keyId,
        metadata: options.metadata,
      });
      trusted = true;
      trustReason = "tofu";
    }
    if (trusted && trustReason === "known") {
      await options.trustStore.touchVerifiedAsync(options.proof.fingerprintSha256, {
        verifiedAt: signedAt,
        alias: options.alias,
        publicKeyBase64: options.proof.publicKeyBase64,
        keyId: options.proof.keyId,
        metadata: options.metadata,
      });
    }
  }

  return {
    verified: true,
    trusted,
    trustReason,
    peer: {
      algorithm: options.proof.algorithm,
      keyId: options.proof.keyId,
      publicKeyBase64: options.proof.publicKeyBase64,
      fingerprintSha256: options.proof.fingerprintSha256,
    },
    signedAt,
  };
}
