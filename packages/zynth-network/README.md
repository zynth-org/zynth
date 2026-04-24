# @zynthjs/network

Network state and local-network discovery for Zynth apps.

`@zynthjs/network` combines:

- Connectivity info (`wifi`, `cellular`, `ethernet`, etc.)
- Local peer discovery/advertising over mDNS/Bonjour
- Solid-friendly primitives for lifecycle-safe usage

## Basic

### Install

```bash
npm i @zynthjs/network
```

Regenerate native projects after adding the package.

### Basic usage

```ts
import {
  createCapabilityTxtRecord,
  Network,
  NetworkServiceDomains,
  NetworkServiceTypes,
} from "@zynthjs/network";

const state = await Network.getNetworkStateAsync();
const ip = await Network.getIpAddressAsync();

await Network.startDiscoveryAsync({
  serviceType: NetworkServiceTypes.Zynth,
  domain: NetworkServiceDomains.Local,
});

const peers = await Network.getDiscoveredServicesAsync();

await Network.startServiceAsync({
  serviceType: NetworkServiceTypes.Zynth,
  name: "My Device",
  port: 53317,
  txtRecord: createCapabilityTxtRecord({
    version: "1",
    transfer: ["http", "ws"],
    maxChunk: 262144,
  }),
});

const identity = await Network.getLocalIdentityAsync();
const signed = await Network.signChallengeAsync("BASE64_CHALLENGE_BYTES");
const verified = await Network.verifyChallengeAsync({
  publicKeyBase64: identity.publicKeyBase64,
  challengeBase64: signed.challengeBase64,
  signatureBase64: signed.signatureBase64,
});
console.log(verified);
```

### Handshake + TOFU helper flow

```ts
import {
  Network,
  createNetworkTrustStore,
  createPeerChallenge,
} from "@zynthjs/network";

const trustStore = createNetworkTrustStore();
const challenge = createPeerChallenge();

// Send challenge.challengeBase64 to peer, receive proof from peer.
const result = await Network.authenticatePeerAsync({
  challengeBase64: challenge.challengeBase64,
  issuedAt: challenge.issuedAt,
  proof: peerProof,
  trustStore,
  trustOnFirstUse: true,
  alias: "Alice Phone",
});

if (!result.verified || !result.trusted) {
  throw new Error(result.reason ?? "peer authentication failed");
}
```

### Recommended Solid usage

Use `createNetworkDiscovery` in components. It manages polling/subscription lifecycle and cleanup for you.

```ts
import { createNetworkDiscovery, NetworkServiceTypes } from "@zynthjs/network";

const discovery = createNetworkDiscovery({
  autoStart: true,
  serviceType: NetworkServiceTypes.Zynth,
  includeSelf: false,
});

const peers = discovery.services();
const events = discovery.events();
```

## Advanced

### Secure peer session helpers

`@zynthjs/network` now includes first-class helpers for authenticated local peer sessions:

- `createPeerChallenge()` / `Network.createChallengeBase64(...)` for challenge creation
- `Network.authenticatePeerAsync(...)` for signature + freshness verification
- `createNetworkTrustStore(...)` for optional central trust persistence/TOFU
- `createIdentityTxtRecord(...)` + `parseIdentityTxtRecord(...)` for identity metadata in TXT records

To auto-advertise local identity over mDNS TXT, set `includeIdentity: true` in `startServiceAsync`.

### Why `createNetworkDiscovery`

`createNetworkDiscovery` is the default DX for Solid apps because it:

- scopes work to component lifecycle (`onCleanup` safety)
- avoids duplicated polling/subscription wiring
- exposes reactive accessors (`services()`, `state()`, `events()`)
- provides action methods (`startDiscovery`, `stopDiscovery`, `refresh`, etc.)

Low-level APIs remain available for custom architectures.

### Self-device behavior

By default, self is excluded from peer lists/events.

How it works:

- `startServiceAsync` injects `zdid` into TXT records (`zynthDeviceId` is still read for backward compatibility)
- discovered services are marked with `isSelf`
- `getDiscoveredServicesAsync` and `drainDiscoveryEventsAsync` filter `isSelf` unless `includeSelf: true`

### Low-level subscription

Use this when you want full control over update flow.

```ts
const sub = Network.subscribe(
  (snapshot) => {
    console.log(snapshot.state.type, snapshot.services.length);
  },
  {
    pollIntervalMs: 500,
    maxEvents: 100,
    includeSelf: false,
  },
);

sub.remove();
```

### Service type constants and helper

```ts
import {
  NetworkServiceDomains,
  NetworkServiceTypes,
  toBonjourServiceType,
} from "@zynthjs/network";

const serviceType = NetworkServiceTypes.Zynth; // "_zynth._tcp."
const localSendType = NetworkServiceTypes.LocalSend; // "_localsend._tcp."
const customType = toBonjourServiceType("my-app"); // "_my-app._tcp."
const domain = NetworkServiceDomains.Local; // "local."
```

### TXT capability helpers and peer normalization

Use typed capability helpers to keep TXT records ergonomic without hardcoding string parsing everywhere:

```ts
import {
  createCapabilityTxtRecord,
  normalizePeerMetadataList,
} from "@zynthjs/network";

const txtRecord = createCapabilityTxtRecord({
  version: "1",
  transfer: ["http", "ws"],
  maxChunk: 262144,
});

await Network.startServiceAsync({
  serviceType: "_zynth._tcp.",
  name: "Sender",
  port: 53317,
  txtRecord,
});

const peers = await Network.getDiscoveredServicesAsync();
const normalized = normalizePeerMetadataList(peers);
```

`normalizePeerMetadataList` gives stable `peerId`, normalized addresses, and parsed capabilities from TXT (`version`, `transfer`, `maxChunk`) while preserving custom TXT keys.

### Special cases / platform constraints

These values are best-effort and may be `null` by design:

- `ssid`, `bssid`
  - iOS: heavily restricted; requires special Apple entitlements/conditions.
  - Android: restricted by permissions/privacy rules (location-related constraints on many versions).

- `mac`
  - iOS: unavailable to third-party apps.
  - Android: real hardware MAC is generally blocked/randomized.

- `airplaneMode`
  - iOS: not exposed to apps (`null` expected).
  - Android: available in this implementation.

### iOS local-network requirements

For discovery/advertising to work on iOS, Info.plist must include:

- `NSLocalNetworkUsageDescription`
- `NSBonjourServices` with each service type used (e.g. `_zynth._tcp.`)

If previously denied, re-enable:

- `Settings > Privacy & Security > Local Network`

## API reference

### `Network`

- `getNetworkStateAsync(): Promise<NetworkState>`
- `getIpAddressAsync(): Promise<string | null>`
- `getMacAddressAsync(): Promise<string | null>`
- `getCurrentWifiAsync(): Promise<WifiInfo | null>`
- `isAirplaneModeEnabledAsync(): Promise<boolean | null>`
- `getLocalIdentityAsync(): Promise<NetworkLocalIdentity>`
- `signChallengeAsync(challengeBase64: string): Promise<NetworkChallengeProof>`
- `verifyChallengeAsync(options: NetworkVerifyChallengeOptions): Promise<boolean>`
- `createChallengeBase64(challengeBytes?: number): string`
- `authenticatePeerAsync(options: NetworkAuthenticatePeerOptions): Promise<NetworkAuthenticatePeerResult>`

- `startDiscoveryAsync(options?: NetworkDiscoveryOptions): Promise<void>`
- `stopDiscoveryAsync(): Promise<void>`
- `isDiscoveryRunningAsync(): Promise<boolean>`
- `getDiscoveredServicesAsync(options?: NetworkFilterOptions): Promise<NetworkService[]>`
- `clearDiscoveredServicesAsync(): Promise<void>`
- `drainDiscoveryEventsAsync(maxEvents?: number, options?: NetworkFilterOptions): Promise<DiscoveryEvent[]>`

- `startServiceAsync(options: NetworkAdvertiseOptions): Promise<AdvertisedServiceInfo>`
- `stopServiceAsync(): Promise<void>`
- `getAdvertisedServiceAsync(): Promise<AdvertisedServiceInfo | null>`

- `subscribe(listener, options?): NetworkSubscription`
- `isAvailable(): boolean`

### `createNetworkDiscovery(options?)`

Returns `NetworkDiscoveryController` with:

- accessors: `state`, `services`, `events`, `discoveryRunning`, `loading`, `error`, `lastSnapshotAt`, `peerCount`
- actions: `startDiscovery`, `stopDiscovery`, `startService`, `stopService`, `refresh`, `clear`

### Core types

- `NetworkState`
  - `type: "unknown" | "none" | "wifi" | "cellular" | "ethernet" | "vpn" | "other"`
  - `isConnected: boolean`
  - `isInternetReachable: boolean`
  - `isExpensive?: boolean`

- `NetworkLocalIdentity`
  - `algorithm: "ECDSA_P256_SHA256"`
  - `keyId: string`
  - `publicKeyBase64: string` (P-256 public key, ANSI X9.63 uncompressed, base64)
  - `fingerprintSha256: string`

- `NetworkChallengeProof`
  - `algorithm: "ECDSA_P256_SHA256"`
  - `keyId: string`
  - `publicKeyBase64: string`
  - `fingerprintSha256: string`
  - `challengeBase64: string`
  - `signatureBase64: string`
  - `signedAt: number`

- `NetworkService`
  - `id`, `name`, `type`, `domain`, `hostName`, `port`, `addresses`, `txtRecord`, `capabilities`, `lastSeenAt`, `isSelf`

- `DiscoveryEvent`
  - `type: "serviceFound" | "serviceLost" | "serviceResolved" | "serviceUpdated"`
  - `timestamp`, `service`

- `NetworkDiscoveryOptions`
  - `serviceType?`, `domain?`, `resolveTimeoutMs?`, `includeSelf?`

- `NetworkSubscribeOptions`
  - discovery options + `pollIntervalMs?`, `maxEvents?`, `emitImmediately?`
- `NetworkServiceTypes`
  - `Zynth`, `LocalSend`
- `NetworkServiceDomains`
  - `Local`
- `toBonjourServiceType(serviceName, transport?)`
  - helper for generating RFC-compatible DNS-SD service types
- `createCapabilityTxtRecord(capabilities)`
  - typed TXT encoder for capability advertisement (`version`, `transfer`, `maxChunk`, custom keys)
- `createIdentityTxtRecord(identity)`
  - encodes identity keys (`zidAlg`, `zidKeyId`, `zidPk`, `zidFp`) for service TXT records
- `parseCapabilityTxtRecord(txtRecord)`
  - parses known capability keys and keeps custom TXT entries
- `parseIdentityTxtRecord(txtRecord)`
  - decodes peer identity from TXT, when present
- `normalizePeerMetadata(service)` / `normalizePeerMetadataList(services)`
  - lightweight peer metadata normalization for cross-platform peer lists
- `createPeerChallenge(challengeBytes?)`
  - creates a random base64 challenge with timestamp
- `createNetworkTrustStore(options?)`
  - optional centralized trust store with pluggable persistence (TOFU/known-peer flows)
- `NetworkAdvertiseOptions.includeIdentity?`
  - when `true`, adds identity TXT keys (`zidAlg`, `zidKeyId`, `zidPk`, `zidFp`) automatically
