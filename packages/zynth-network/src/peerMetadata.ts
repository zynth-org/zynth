import { parseCapabilityTxtRecord, NetworkTxtRecordKeys } from "./capabilities";
import type { NetworkService, NormalizedPeerMetadata } from "./types";

function normalizeName(value: string | undefined): string {
  const normalized = (value ?? "").trim();
  return normalized.length > 0 ? normalized : "Unknown Peer";
}

function normalizeDomain(value: string | undefined): string {
  const normalized = (value ?? "").trim().toLowerCase();
  if (normalized.length === 0) {
    return "local.";
  }
  return normalized.endsWith(".") ? normalized : `${normalized}.`;
}

function stripIPv6Scope(address: string): string {
  const separator = address.indexOf("%");
  if (separator === -1) {
    return address;
  }
  return address.slice(0, separator);
}

function normalizeAddresses(addresses: readonly string[]): string[] {
  const deduped = new Set<string>();
  for (const raw of addresses) {
    const candidate = stripIPv6Scope((raw ?? "").trim());
    if (candidate.length > 0) {
      deduped.add(candidate);
    }
  }
  return Array.from(deduped);
}

function sanitizePort(port: number): number {
  const normalized = Math.round(port);
  if (!Number.isFinite(normalized) || normalized <= 0 || normalized > 65535) {
    return 0;
  }
  return normalized;
}

function createPeerId(service: NetworkService, domain: string): string {
  const txtRecord = service.txtRecord ?? {};
  const advertisedDeviceId = txtRecord[NetworkTxtRecordKeys.DeviceId];
  if (typeof advertisedDeviceId === "string" && advertisedDeviceId.trim().length > 0) {
    return advertisedDeviceId.trim();
  }

  const base = [
    (service.name ?? "").trim().toLowerCase(),
    (service.type ?? "").trim().toLowerCase(),
    domain,
    (service.hostName ?? "").trim().toLowerCase(),
    String(sanitizePort(service.port)),
  ];
  return base.join("|");
}

export function normalizePeerMetadata(service: NetworkService): NormalizedPeerMetadata {
  const name = normalizeName(service.name);
  const domain = normalizeDomain(service.domain);
  const hostName = (service.hostName ?? "").trim() || null;
  const addresses = normalizeAddresses(service.addresses ?? []);
  const capabilities =
    service.capabilities ?? parseCapabilityTxtRecord(service.txtRecord ?? {});

  return {
    peerId: createPeerId(service, domain),
    serviceId: (service.id ?? "").trim(),
    name,
    type: (service.type ?? "").trim(),
    domain,
    hostName,
    port: sanitizePort(service.port),
    addresses,
    primaryAddress: addresses[0] ?? null,
    txtRecord: capabilities.raw,
    capabilities,
    isSelf: service.isSelf === true,
    lastSeenAt:
      typeof service.lastSeenAt === "number" && Number.isFinite(service.lastSeenAt)
        ? service.lastSeenAt
        : Date.now(),
  };
}

export function normalizePeerMetadataList(
  services: readonly NetworkService[]
): NormalizedPeerMetadata[] {
  return services.map(normalizePeerMetadata);
}
