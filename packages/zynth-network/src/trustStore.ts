import type {
  CreateNetworkTrustStoreOptions,
  NetworkTrustRecord,
  NetworkTrustStore,
} from "./types";

function normalizeFingerprint(value: string): string {
  return value.trim().toLowerCase();
}

function normalizeMetadata(
  metadata: Record<string, string> | undefined
): Record<string, string> | undefined {
  if (!metadata) {
    return undefined;
  }
  const next: Record<string, string> = {};
  for (const [key, rawValue] of Object.entries(metadata)) {
    const normalizedKey = key.trim();
    if (!normalizedKey) {
      continue;
    }
    next[normalizedKey] = String(rawValue);
  }
  return Object.keys(next).length > 0 ? next : undefined;
}

function normalizeRecord(
  input: NetworkTrustRecord,
  now: number
): NetworkTrustRecord {
  const fingerprintSha256 = normalizeFingerprint(input.fingerprintSha256);
  if (!fingerprintSha256) {
    throw new Error("fingerprintSha256 is required");
  }
  const firstSeenAt =
    typeof input.firstSeenAt === "number" && Number.isFinite(input.firstSeenAt)
      ? Math.round(input.firstSeenAt)
      : now;
  const lastSeenAt =
    typeof input.lastSeenAt === "number" && Number.isFinite(input.lastSeenAt)
      ? Math.round(input.lastSeenAt)
      : firstSeenAt;
  const lastVerifiedAt =
    typeof input.lastVerifiedAt === "number" && Number.isFinite(input.lastVerifiedAt)
      ? Math.round(input.lastVerifiedAt)
      : undefined;
  const verificationCount =
    typeof input.verificationCount === "number" &&
    Number.isFinite(input.verificationCount) &&
    input.verificationCount >= 0
      ? Math.round(input.verificationCount)
      : 0;
  return {
    fingerprintSha256,
    publicKeyBase64: input.publicKeyBase64?.trim() || undefined,
    keyId: input.keyId?.trim() || undefined,
    alias: input.alias?.trim() || undefined,
    firstSeenAt,
    lastSeenAt,
    lastVerifiedAt,
    verificationCount,
    metadata: normalizeMetadata(input.metadata),
  };
}

export function createNetworkTrustStore(
  options?: CreateNetworkTrustStoreOptions
): NetworkTrustStore {
  const nowFactory = options?.now ?? (() => Date.now());
  const records = new Map<string, NetworkTrustRecord>();
  let loaded = false;
  let loadPromise: Promise<void> | null = null;

  const saveAsync = async (): Promise<void> => {
    if (!options?.persistence?.save) {
      return;
    }
    await options.persistence.save(Array.from(records.values()));
  };

  const ensureLoadedAsync = async (): Promise<void> => {
    if (loaded) {
      return;
    }
    if (loadPromise) {
      return loadPromise;
    }
    loadPromise = (async () => {
      const now = nowFactory();
      const initial = options?.initialRecords ?? [];
      for (const record of initial) {
        const normalized = normalizeRecord(record, now);
        records.set(normalized.fingerprintSha256, normalized);
      }
      const loadedRecords = await options?.persistence?.load?.();
      if (Array.isArray(loadedRecords)) {
        for (const record of loadedRecords) {
          const normalized = normalizeRecord(record, now);
          records.set(normalized.fingerprintSha256, normalized);
        }
      }
      loaded = true;
      loadPromise = null;
    })();
    await loadPromise;
  };

  return {
    async listAsync(): Promise<NetworkTrustRecord[]> {
      await ensureLoadedAsync();
      return Array.from(records.values());
    },
    async getAsync(fingerprintSha256: string): Promise<NetworkTrustRecord | null> {
      await ensureLoadedAsync();
      const key = normalizeFingerprint(fingerprintSha256);
      if (!key) {
        return null;
      }
      return records.get(key) ?? null;
    },
    async isTrustedAsync(fingerprintSha256: string): Promise<boolean> {
      await ensureLoadedAsync();
      const key = normalizeFingerprint(fingerprintSha256);
      if (!key) {
        return false;
      }
      return records.has(key);
    },
    async upsertAsync(record: NetworkTrustRecord): Promise<NetworkTrustRecord> {
      await ensureLoadedAsync();
      const normalized = normalizeRecord(record, nowFactory());
      records.set(normalized.fingerprintSha256, normalized);
      await saveAsync();
      return normalized;
    },
    async touchVerifiedAsync(
      fingerprintSha256: string,
      details: {
        verifiedAt?: number;
        publicKeyBase64?: string;
        keyId?: string;
        alias?: string;
        metadata?: Record<string, string>;
      }
    ): Promise<NetworkTrustRecord> {
      await ensureLoadedAsync();
      const key = normalizeFingerprint(fingerprintSha256);
      if (!key) {
        throw new Error("fingerprintSha256 is required");
      }
      const now = nowFactory();
      const verifiedAt =
        typeof details.verifiedAt === "number" && Number.isFinite(details.verifiedAt)
          ? Math.round(details.verifiedAt)
          : now;
      const current = records.get(key);
      const next: NetworkTrustRecord = current
        ? {
            ...current,
            publicKeyBase64: details.publicKeyBase64?.trim() || current.publicKeyBase64,
            keyId: details.keyId?.trim() || current.keyId,
            alias: details.alias?.trim() || current.alias,
            lastSeenAt: verifiedAt,
            lastVerifiedAt: verifiedAt,
            verificationCount: current.verificationCount + 1,
            metadata: {
              ...(current.metadata ?? {}),
              ...(normalizeMetadata(details.metadata) ?? {}),
            },
          }
        : {
            fingerprintSha256: key,
            publicKeyBase64: details.publicKeyBase64?.trim() || undefined,
            keyId: details.keyId?.trim() || undefined,
            alias: details.alias?.trim() || undefined,
            firstSeenAt: verifiedAt,
            lastSeenAt: verifiedAt,
            lastVerifiedAt: verifiedAt,
            verificationCount: 1,
            metadata: normalizeMetadata(details.metadata),
          };
      records.set(key, next);
      await saveAsync();
      return next;
    },
    async revokeAsync(fingerprintSha256: string): Promise<boolean> {
      await ensureLoadedAsync();
      const key = normalizeFingerprint(fingerprintSha256);
      if (!key) {
        return false;
      }
      const deleted = records.delete(key);
      if (deleted) {
        await saveAsync();
      }
      return deleted;
    },
    async clearAsync(): Promise<void> {
      await ensureLoadedAsync();
      records.clear();
      await saveAsync();
    },
  };
}
