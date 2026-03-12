import type {
  NetworkCapabilityAdvertisement,
  ParsedNetworkCapabilities,
  ServiceTxtRecord,
} from "./types";

const VERSION_KEY = "version";
const TRANSFER_KEY = "transfer";
const MAX_CHUNK_KEY = "maxChunk";
const DEVICE_ID_KEY = "zdid";
const LEGACY_DEVICE_ID_KEY = "zynthDeviceId";

const KNOWN_KEYS: readonly string[] = [
  VERSION_KEY,
  TRANSFER_KEY,
  MAX_CHUNK_KEY,
  DEVICE_ID_KEY,
  LEGACY_DEVICE_ID_KEY,
];
const KNOWN_LOWERCASE_KEYS = new Set(
  KNOWN_KEYS.map((key) => key.toLowerCase())
);

export const NetworkTxtRecordKeys = {
  DeviceId: DEVICE_ID_KEY,
  LegacyDeviceId: LEGACY_DEVICE_ID_KEY,
  Version: VERSION_KEY,
  Transfer: TRANSFER_KEY,
  MaxChunk: MAX_CHUNK_KEY,
} as const;

function normalizeTxtKey(key: string): string {
  return key.trim();
}

function normalizeTxtValue(value: unknown): string {
  return String(value ?? "").trim();
}

function parsePositiveInt(value: string | undefined): number | undefined {
  if (!value) {
    return undefined;
  }
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return undefined;
  }
  return parsed;
}

function parseList(value: string | undefined): string[] {
  if (!value) {
    return [];
  }
  return value
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

export function normalizeTxtRecord(
  txtRecord?: ServiceTxtRecord | null
): ServiceTxtRecord {
  const normalized: ServiceTxtRecord = {};
  if (!txtRecord || typeof txtRecord !== "object") {
    return normalized;
  }

  for (const [rawKey, rawValue] of Object.entries(txtRecord)) {
    const key = normalizeTxtKey(rawKey);
    if (!key) {
      continue;
    }
    normalized[key] = normalizeTxtValue(rawValue);
  }
  return normalized;
}

export function createCapabilityTxtRecord(
  capabilities?: NetworkCapabilityAdvertisement
): ServiceTxtRecord {
  const txtRecord: ServiceTxtRecord = {};
  if (!capabilities) {
    return txtRecord;
  }

  for (const [rawKey, rawValue] of Object.entries(capabilities)) {
    const key = normalizeTxtKey(rawKey);
    if (!key || rawValue === undefined || rawValue === null) {
      continue;
    }

    if (Array.isArray(rawValue)) {
      const items = rawValue
        .map((entry) => entry.trim())
        .filter((entry) => entry.length > 0);
      if (items.length > 0) {
        txtRecord[key] = items.join(",");
      }
      continue;
    }

    if (typeof rawValue === "number") {
      if (Number.isFinite(rawValue)) {
        txtRecord[key] = String(Math.round(rawValue));
      }
      continue;
    }

    if (typeof rawValue === "boolean") {
      txtRecord[key] = rawValue ? "1" : "0";
      continue;
    }

    const value = normalizeTxtValue(rawValue);
    if (value) {
      txtRecord[key] = value;
    }
  }

  return txtRecord;
}

export function parseCapabilityTxtRecord(
  txtRecord?: ServiceTxtRecord | null
): ParsedNetworkCapabilities {
  const raw = normalizeTxtRecord(txtRecord);
  const lowerCaseLookup: Record<string, string> = {};
  for (const [key, value] of Object.entries(raw)) {
    lowerCaseLookup[key.toLowerCase()] = value;
  }

  const custom: ServiceTxtRecord = {};
  for (const [key, value] of Object.entries(raw)) {
    if (!KNOWN_LOWERCASE_KEYS.has(key.toLowerCase())) {
      custom[key] = value;
    }
  }

  return {
    version: lowerCaseLookup[VERSION_KEY],
    transfer: parseList(lowerCaseLookup[TRANSFER_KEY]),
    maxChunk: parsePositiveInt(lowerCaseLookup[MAX_CHUNK_KEY]),
    raw,
    custom,
  };
}
