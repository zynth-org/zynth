import { callNative, isNativeAvailable } from "./native";
import {
  NetworkServiceDomains,
  NetworkServiceTypes,
} from "./constants";
import {
  createCapabilityTxtRecord,
  NetworkTxtRecordKeys,
  normalizeTxtRecord,
  parseCapabilityTxtRecord,
} from "./capabilities";
import type {
  AdvertisedServiceInfo,
  DiscoveryEvent,
  NetworkChallengeProof,
  NetworkAdvertiseOptions,
  NetworkLocalIdentity,
  NetworkDiscoveryOptions,
  NetworkFilterOptions,
  NetworkService,
  NetworkState,
  NetworkStateType,
  NetworkSubscribeOptions,
  NetworkSubscription,
  NetworkSubscriptionSnapshot,
  NetworkVerifyChallengeOptions,
  WifiInfo,
} from "./types";

type NativeDiscoveryEvent = {
  type: string;
  timestamp: number;
  service: NetworkService;
};

const DEFAULT_DISCOVERY_TIMEOUT_MS = 4000;
const DEFAULT_DISCOVERY_MAX_EVENTS = 100;
const DEFAULT_POLL_INTERVAL_MS = 500;
const GLOBAL_DEVICE_ID_KEY = "__zynth_network_device_id";

const VALID_STATE_TYPES: NetworkStateType[] = [
  "unknown",
  "none",
  "wifi",
  "cellular",
  "ethernet",
  "vpn",
  "other",
];

function getGlobalObject(): Record<string, unknown> {
  if (typeof globalThis !== "undefined") {
    return globalThis as Record<string, unknown>;
  }
  try {
    const fallback = Function("return this")();
    if (fallback && typeof fallback === "object") {
      return fallback as Record<string, unknown>;
    }
  } catch {
    // ignore
  }
  return {};
}

function createDeviceId(): string {
  const random = Math.random().toString(36).slice(2, 10);
  return `zynth-${Date.now().toString(36)}-${random}`;
}

function getLocalDeviceId(): string {
  const globalObject = getGlobalObject();
  const current = globalObject[GLOBAL_DEVICE_ID_KEY];
  if (typeof current === "string" && current.length > 0) {
    return current;
  }
  const next = createDeviceId();
  globalObject[GLOBAL_DEVICE_ID_KEY] = next;
  return next;
}

function normalizeStateType(value: unknown): NetworkStateType {
  if (typeof value !== "string") {
    return "unknown";
  }
  const normalized = value.toLowerCase() as NetworkStateType;
  return VALID_STATE_TYPES.includes(normalized) ? normalized : "unknown";
}

function normalizeNetworkState(value: unknown): NetworkState {
  if (!value || typeof value !== "object") {
    return { type: "unknown", isConnected: false, isInternetReachable: false };
  }
  const record = value as Record<string, unknown>;
  return {
    type: normalizeStateType(record.type),
    isConnected: Boolean(record.isConnected),
    isInternetReachable: Boolean(record.isInternetReachable),
    isExpensive:
      typeof record.isExpensive === "boolean" ? record.isExpensive : undefined,
  };
}

function normalizeDiscoveryOptions(
  options?: NetworkDiscoveryOptions
): Required<NetworkDiscoveryOptions> {
  const serviceType = (options?.serviceType ?? NetworkServiceTypes.Zynth).trim();
  const domain = (options?.domain ?? NetworkServiceDomains.Local).trim();
  const resolveTimeoutMs =
    typeof options?.resolveTimeoutMs === "number" && options.resolveTimeoutMs > 0
      ? Math.round(options.resolveTimeoutMs)
      : DEFAULT_DISCOVERY_TIMEOUT_MS;

  return {
    serviceType:
      serviceType.length > 0 ? serviceType : NetworkServiceTypes.Zynth,
    domain: domain.length > 0 ? domain : NetworkServiceDomains.Local,
    resolveTimeoutMs,
    includeSelf: options?.includeSelf === true,
  };
}

function normalizeAdvertiseOptions(
  options: NetworkAdvertiseOptions
): NetworkAdvertiseOptions {
  const serviceType = (options.serviceType || "").trim();
  const name = (options.name || "").trim();
  const port = Math.round(options.port);

  if (!serviceType) {
    throw new Error("serviceType is required");
  }
  if (!name) {
    throw new Error("name is required");
  }
  if (!Number.isFinite(port) || port <= 0 || port > 65535) {
    throw new Error("port must be between 1 and 65535");
  }

  const capabilityTxtRecord = createCapabilityTxtRecord(options.capabilities);
  const txtRecord = {
    ...capabilityTxtRecord,
    ...normalizeTxtRecord(options.txtRecord),
  };
  delete txtRecord[NetworkTxtRecordKeys.LegacyDeviceId];
  txtRecord[NetworkTxtRecordKeys.DeviceId] = getLocalDeviceId();

  return {
    serviceType,
    name,
    port,
    domain:
      (options.domain ?? NetworkServiceDomains.Local).trim() ||
      NetworkServiceDomains.Local,
    txtRecord,
    capabilities: options.capabilities,
  };
}

function normalizeDiscoveryEvent(event: NativeDiscoveryEvent): DiscoveryEvent {
  const type =
    event.type === "serviceFound" ||
    event.type === "serviceLost" ||
    event.type === "serviceResolved" ||
    event.type === "serviceUpdated"
      ? event.type
      : "serviceUpdated";

  return {
    type,
    timestamp: typeof event.timestamp === "number" ? event.timestamp : Date.now(),
    service: withSelfFlag(event.service),
  };
}

function normalizeLocalIdentity(value: unknown): NetworkLocalIdentity {
  if (!value || typeof value !== "object") {
    throw new Error("Invalid local identity response from native module");
  }
  const record = value as Record<string, unknown>;
  const algorithm = record.algorithm;
  const keyId = record.keyId;
  const publicKeyBase64 = record.publicKeyBase64;
  const fingerprintSha256 = record.fingerprintSha256;
  if (algorithm !== "ECDSA_P256_SHA256") {
    throw new Error("Unsupported local identity algorithm");
  }
  if (
    typeof keyId !== "string" ||
    typeof publicKeyBase64 !== "string" ||
    typeof fingerprintSha256 !== "string" ||
    !keyId.trim() ||
    !publicKeyBase64.trim() ||
    !fingerprintSha256.trim()
  ) {
    throw new Error("Invalid local identity payload from native module");
  }
  return {
    algorithm,
    keyId,
    publicKeyBase64,
    fingerprintSha256,
  };
}

function normalizeChallengeProof(value: unknown): NetworkChallengeProof {
  if (!value || typeof value !== "object") {
    throw new Error("Invalid challenge proof response from native module");
  }
  const record = value as Record<string, unknown>;
  const identity = normalizeLocalIdentity(record);
  const challengeBase64 = record.challengeBase64;
  const signatureBase64 = record.signatureBase64;
  const signedAt = record.signedAt;
  if (
    typeof challengeBase64 !== "string" ||
    typeof signatureBase64 !== "string" ||
    !challengeBase64.trim() ||
    !signatureBase64.trim()
  ) {
    throw new Error("Invalid challenge proof payload from native module");
  }
  if (typeof signedAt !== "number" || !Number.isFinite(signedAt) || signedAt <= 0) {
    throw new Error("Invalid challenge proof timestamp from native module");
  }
  return {
    ...identity,
    challengeBase64,
    signatureBase64,
    signedAt: Math.round(signedAt),
  };
}

function withSelfFlag(service: NetworkService): NetworkService {
  const txtRecord = normalizeTxtRecord(service.txtRecord);
  const advertisedDeviceId =
    txtRecord[NetworkTxtRecordKeys.DeviceId] ??
    txtRecord[NetworkTxtRecordKeys.LegacyDeviceId];
  const isSelf = advertisedDeviceId === getLocalDeviceId();
  const capabilities = parseCapabilityTxtRecord(txtRecord);
  return {
    ...service,
    txtRecord,
    capabilities,
    isSelf,
  };
}

function withAdvertisedCapabilities(
  service: AdvertisedServiceInfo
): AdvertisedServiceInfo {
  const txtRecord = normalizeTxtRecord(service.txtRecord);
  return {
    ...service,
    txtRecord,
    capabilities: parseCapabilityTxtRecord(txtRecord),
  };
}

function shouldIncludeService(
  service: NetworkService,
  options?: NetworkFilterOptions
): boolean {
  if (options?.includeSelf === true) {
    return true;
  }
  return service.isSelf !== true;
}

function filterServices(
  services: NetworkService[],
  options?: NetworkFilterOptions
): NetworkService[] {
  return services.filter((service) => shouldIncludeService(service, options));
}

function filterEvents(
  events: DiscoveryEvent[],
  options?: NetworkFilterOptions
): DiscoveryEvent[] {
  return events.filter((event) => shouldIncludeService(event.service, options));
}

async function ensureAvailable(): Promise<void> {
  if (!isNativeAvailable()) {
    throw new Error("Network module is not available on this platform");
  }
}

async function createSnapshot(
  maxEvents: number,
  options?: NetworkFilterOptions
): Promise<NetworkSubscriptionSnapshot> {
  const [state, discoveryRunning, services, events, advertisedService] =
    await Promise.all([
      Network.getNetworkStateAsync(),
      Network.isDiscoveryRunningAsync(),
      Network.getDiscoveredServicesAsync(options),
      Network.drainDiscoveryEventsAsync(maxEvents, options),
      Network.getAdvertisedServiceAsync(),
    ]);

  return {
    timestamp: Date.now(),
    state,
    discoveryRunning,
    services,
    events,
    advertisedService,
  };
}

export const Network = {
  async getNetworkStateAsync(): Promise<NetworkState> {
    if (!isNativeAvailable()) {
      return { type: "unknown", isConnected: false, isInternetReachable: false };
    }
    const result = await callNative<unknown>("getNetworkState", {});
    return normalizeNetworkState(result);
  },

  async getIpAddressAsync(): Promise<string | null> {
    if (!isNativeAvailable()) {
      return null;
    }
    return callNative<string | null>("getIpAddress", {});
  },

  async getMacAddressAsync(): Promise<string | null> {
    if (!isNativeAvailable()) {
      return null;
    }
    return callNative<string | null>("getMacAddress", {});
  },

  async getCurrentWifiAsync(): Promise<WifiInfo | null> {
    if (!isNativeAvailable()) {
      return null;
    }
    return callNative<WifiInfo | null>("getCurrentWifi", {});
  },

  async getLocalIdentityAsync(): Promise<NetworkLocalIdentity> {
    await ensureAvailable();
    const identity = await callNative<unknown>("getLocalIdentity", {});
    return normalizeLocalIdentity(identity);
  },

  async signChallengeAsync(challengeBase64: string): Promise<NetworkChallengeProof> {
    await ensureAvailable();
    if (typeof challengeBase64 !== "string" || challengeBase64.trim().length === 0) {
      throw new Error("challengeBase64 must be a non-empty base64 string");
    }
    const proof = await callNative<unknown>("signChallenge", {
      challengeBase64: challengeBase64.trim(),
    });
    return normalizeChallengeProof(proof);
  },

  async verifyChallengeAsync(
    options: NetworkVerifyChallengeOptions
  ): Promise<boolean> {
    await ensureAvailable();
    if (!options || typeof options !== "object") {
      throw new Error("options are required");
    }
    const publicKeyBase64 = options.publicKeyBase64?.trim();
    const challengeBase64 = options.challengeBase64?.trim();
    const signatureBase64 = options.signatureBase64?.trim();
    if (!publicKeyBase64 || !challengeBase64 || !signatureBase64) {
      throw new Error(
        "publicKeyBase64, challengeBase64, and signatureBase64 are required"
      );
    }
    return callNative<boolean>("verifyChallenge", {
      publicKeyBase64,
      challengeBase64,
      signatureBase64,
    });
  },

  async isAirplaneModeEnabledAsync(): Promise<boolean | null> {
    if (!isNativeAvailable()) {
      return null;
    }
    return callNative<boolean | null>("isAirplaneModeEnabled", {});
  },

  async startDiscoveryAsync(options?: NetworkDiscoveryOptions): Promise<void> {
    await ensureAvailable();
    const normalized = normalizeDiscoveryOptions(options);
    await callNative<void>("startDiscovery", {
      serviceType: normalized.serviceType,
      domain: normalized.domain,
      resolveTimeoutMs: normalized.resolveTimeoutMs,
    });
  },

  async stopDiscoveryAsync(): Promise<void> {
    if (!isNativeAvailable()) {
      return;
    }
    await callNative<void>("stopDiscovery", {});
  },

  async isDiscoveryRunningAsync(): Promise<boolean> {
    if (!isNativeAvailable()) {
      return false;
    }
    return callNative<boolean>("isDiscoveryRunning", {});
  },

  async getDiscoveredServicesAsync(
    options?: NetworkFilterOptions
  ): Promise<NetworkService[]> {
    if (!isNativeAvailable()) {
      return [];
    }
    const services = await callNative<NetworkService[] | null>(
      "getDiscoveredServices",
      {}
    );
    if (!Array.isArray(services)) {
      return [];
    }
    const normalized = services.map(withSelfFlag);
    return filterServices(normalized, options);
  },

  async clearDiscoveredServicesAsync(): Promise<void> {
    if (!isNativeAvailable()) {
      return;
    }
    await callNative<void>("clearDiscoveredServices", {});
  },

  async drainDiscoveryEventsAsync(
    maxEvents = DEFAULT_DISCOVERY_MAX_EVENTS,
    options?: NetworkFilterOptions
  ): Promise<DiscoveryEvent[]> {
    if (!isNativeAvailable()) {
      return [];
    }

    const normalizedMaxEvents =
      typeof maxEvents === "number" && maxEvents > 0 ? Math.round(maxEvents) : 1;

    const events = await callNative<NativeDiscoveryEvent[] | null>(
      "drainDiscoveryEvents",
      { maxEvents: normalizedMaxEvents }
    );

    if (!Array.isArray(events)) {
      return [];
    }

    const normalized = events.map(normalizeDiscoveryEvent);
    return filterEvents(normalized, options);
  },

  async startServiceAsync(
    options: NetworkAdvertiseOptions
  ): Promise<AdvertisedServiceInfo> {
    await ensureAvailable();
    const service = await callNative<AdvertisedServiceInfo>(
      "startService",
      normalizeAdvertiseOptions(options)
    );
    return withAdvertisedCapabilities(service);
  },

  async stopServiceAsync(): Promise<void> {
    if (!isNativeAvailable()) {
      return;
    }
    await callNative<void>("stopService", {});
  },

  async getAdvertisedServiceAsync(): Promise<AdvertisedServiceInfo | null> {
    if (!isNativeAvailable()) {
      return null;
    }
    const service = await callNative<AdvertisedServiceInfo | null>(
      "getAdvertisedService",
      {}
    );
    return service ? withAdvertisedCapabilities(service) : null;
  },

  subscribe(
    listener: (snapshot: NetworkSubscriptionSnapshot) => void,
    options?: NetworkSubscribeOptions
  ): NetworkSubscription {
    const pollIntervalMs =
      typeof options?.pollIntervalMs === "number" && options.pollIntervalMs > 0
        ? Math.round(options.pollIntervalMs)
        : DEFAULT_POLL_INTERVAL_MS;
    const maxEvents =
      typeof options?.maxEvents === "number" && options.maxEvents > 0
        ? Math.round(options.maxEvents)
        : DEFAULT_DISCOVERY_MAX_EVENTS;

    let disposed = false;
    let inflight = false;

    const run = async () => {
      if (disposed || inflight) {
        return;
      }
      inflight = true;
      try {
        const snapshot = await createSnapshot(maxEvents, {
          includeSelf: options?.includeSelf,
        });
        if (!disposed) {
          listener(snapshot);
        }
      } catch {
        // no-op by design for subscription polling
      } finally {
        inflight = false;
      }
    };

    const timer = setInterval(() => {
      void run();
    }, pollIntervalMs);

    if (options?.emitImmediately !== false) {
      void run();
    }

    return {
      remove() {
        if (disposed) {
          return;
        }
        disposed = true;
        clearInterval(timer);
      },
    };
  },

  isAvailable(): boolean {
    return isNativeAvailable();
  },
};
