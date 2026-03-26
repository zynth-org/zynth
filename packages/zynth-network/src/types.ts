export type NetworkStateType =
  | "unknown"
  | "none"
  | "wifi"
  | "cellular"
  | "ethernet"
  | "vpn"
  | "other";

export type NetworkState = {
  type: NetworkStateType;
  isConnected: boolean;
  isInternetReachable: boolean;
  isExpensive?: boolean;
};

export type WifiInfo = {
  ssid: string | null;
  bssid: string | null;
  ipAddress: string | null;
};

export type LocalNetworkAccessStatus =
  | "granted"
  | "denied"
  | "restricted"
  | "unavailable"
  | "unknown";

export type ServiceTxtRecord = Record<string, string>;

export type NetworkCapabilityValue =
  | string
  | number
  | boolean
  | readonly string[];

export type NetworkCapabilityAdvertisement = {
  version?: string;
  transfer?: string | readonly string[];
  maxChunk?: number;
  [key: string]: NetworkCapabilityValue | undefined;
};

export type ParsedNetworkCapabilities = {
  version?: string;
  transfer: string[];
  maxChunk?: number;
  raw: ServiceTxtRecord;
  custom: ServiceTxtRecord;
};

export type NetworkService = {
  id: string;
  name: string;
  type: string;
  domain: string;
  hostName: string | null;
  port: number;
  addresses: string[];
  txtRecord: ServiceTxtRecord;
  capabilities?: ParsedNetworkCapabilities;
  lastSeenAt: number;
  isSelf: boolean;
};

export type DiscoveryEventType =
  | "serviceFound"
  | "serviceLost"
  | "serviceResolved"
  | "serviceUpdated";

export type DiscoveryEvent = {
  type: DiscoveryEventType;
  timestamp: number;
  service: NetworkService;
};

export type NetworkDiscoveryOptions = {
  serviceType?: string;
  domain?: string;
  resolveTimeoutMs?: number;
  includeSelf?: boolean;
};

export type NetworkFilterOptions = {
  includeSelf?: boolean;
};

export type NetworkAdvertiseOptions = {
  serviceType: string;
  name: string;
  port: number;
  domain?: string;
  txtRecord?: ServiceTxtRecord;
  capabilities?: NetworkCapabilityAdvertisement;
  includeIdentity?: boolean;
};

export type AdvertisedServiceInfo = {
  serviceType: string;
  name: string;
  domain: string;
  port: number;
  txtRecord: ServiceTxtRecord;
  capabilities?: ParsedNetworkCapabilities;
};

export type NormalizedPeerMetadata = {
  peerId: string;
  serviceId: string;
  name: string;
  type: string;
  domain: string;
  hostName: string | null;
  port: number;
  addresses: string[];
  primaryAddress: string | null;
  txtRecord: ServiceTxtRecord;
  capabilities: ParsedNetworkCapabilities;
  isSelf: boolean;
  lastSeenAt: number;
};

export type NetworkSubscriptionSnapshot = {
  timestamp: number;
  state: NetworkState;
  discoveryRunning: boolean;
  services: NetworkService[];
  events: DiscoveryEvent[];
  advertisedService: AdvertisedServiceInfo | null;
};

export type NetworkSubscribeOptions = NetworkDiscoveryOptions &
  NetworkFilterOptions & {
    pollIntervalMs?: number;
    maxEvents?: number;
    emitImmediately?: boolean;
  };

export type NetworkSubscription = {
  remove: () => void;
};

export type CreateNetworkDiscoveryOptions = NetworkSubscribeOptions & {
  autoStart?: boolean;
};

export type NetworkIdentityAlgorithm = "ECDSA_P256_SHA256";

export type NetworkLocalIdentity = {
  algorithm: NetworkIdentityAlgorithm;
  keyId: string;
  publicKeyBase64: string;
  fingerprintSha256: string;
};

export type NetworkChallengeProof = {
  algorithm: NetworkIdentityAlgorithm;
  keyId: string;
  publicKeyBase64: string;
  fingerprintSha256: string;
  challengeBase64: string;
  signatureBase64: string;
  signedAt: number;
};

export type NetworkVerifyChallengeOptions = {
  publicKeyBase64: string;
  challengeBase64: string;
  signatureBase64: string;
};

export type NetworkIdentityTxtRecord = {
  algorithm: NetworkIdentityAlgorithm;
  keyId: string;
  publicKeyBase64: string;
  fingerprintSha256: string;
};

export type NetworkPeerChallenge = {
  challengeBase64: string;
  issuedAt: number;
};

export type NetworkTrustRecord = {
  fingerprintSha256: string;
  publicKeyBase64?: string;
  keyId?: string;
  alias?: string;
  firstSeenAt: number;
  lastSeenAt: number;
  lastVerifiedAt?: number;
  verificationCount: number;
  metadata?: Record<string, string>;
};

export type NetworkTrustStorePersistence = {
  load: () => Promise<NetworkTrustRecord[] | null | undefined>;
  save: (records: readonly NetworkTrustRecord[]) => Promise<void>;
};

export type NetworkTrustStore = {
  listAsync: () => Promise<NetworkTrustRecord[]>;
  getAsync: (fingerprintSha256: string) => Promise<NetworkTrustRecord | null>;
  isTrustedAsync: (fingerprintSha256: string) => Promise<boolean>;
  upsertAsync: (record: NetworkTrustRecord) => Promise<NetworkTrustRecord>;
  touchVerifiedAsync: (
    fingerprintSha256: string,
    details: {
      verifiedAt?: number;
      publicKeyBase64?: string;
      keyId?: string;
      alias?: string;
      metadata?: Record<string, string>;
    }
  ) => Promise<NetworkTrustRecord>;
  revokeAsync: (fingerprintSha256: string) => Promise<boolean>;
  clearAsync: () => Promise<void>;
};

export type CreateNetworkTrustStoreOptions = {
  initialRecords?: readonly NetworkTrustRecord[];
  persistence?: NetworkTrustStorePersistence;
  now?: () => number;
};

export type NetworkAuthenticatePeerOptions = {
  challengeBase64: string;
  proof: NetworkChallengeProof;
  issuedAt?: number;
  maxSignedAgeMs?: number;
  allowedClockSkewMs?: number;
  expectedFingerprintSha256?: string;
  expectedKeyId?: string;
  trustStore?: NetworkTrustStore;
  trustOnFirstUse?: boolean;
  alias?: string;
  metadata?: Record<string, string>;
};

export type NetworkAuthenticatePeerResult = {
  verified: boolean;
  trusted: boolean;
  trustReason: "none" | "known" | "tofu";
  reason?: string;
  peer: NetworkLocalIdentity;
  signedAt: number;
};
