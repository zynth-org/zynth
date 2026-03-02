# @zynth/bluetooth

Secure Bluetooth package for Zynth with separate APIs for:

- Bluetooth Classic (`BluetoothClassic`)
- Bluetooth Low Energy (`BluetoothBLE`)

This package is optimized for Android native execution through Zynth modules + JSI bridge calls.

## Platform Support

- Android: Bluetooth Classic + BLE supported.
- iOS:
  - BLE supported (scan/connect/services/read/write/notifications/RSSI, with structured errors).
  - Classic Bluetooth methods return `E_UNAVAILABLE`.
  - Classic Bluetooth on iOS requires MFi-compliant accessories and Apple-approved protocols.

## Design Goals

- Predictable, typed Promise-based API (Web Bluetooth-style ergonomics).
- Security through `exportedMethods` + `protectedMethods` runtime validation.
- Native-speed operations with synchronous fast-path checks where safe.
- Clear, structured errors from native operations.

## API Surface

```ts
import { BluetoothClassic, BluetoothBLE } from "@zynth/bluetooth";
```

### Mesh Chat Runtime

```ts
import { BluetoothMesh } from "@zynth/bluetooth";

await BluetoothMesh.startNodeAsync({
  nodeId: "node-a",
  serviceUuid: "180F",
  characteristicUuid: "2A19",
  ttl: 3,
});

await BluetoothMesh.sendMessageAsync({
  roomId: "demo-room",
  payloadBase64: "SGVsbG8gbWVzaA==",
});
```

`BluetoothMesh` adds BitChat-like building blocks on top of BLE:

- peer discovery and session lifecycle events
- relay with TTL + hop count + dedupe
- bounded store-and-forward queue
- Noise-style PSK session key derivation + AES-GCM payload protection

Security is optional at runtime: if `globalThis.crypto` (with `subtle`) is unavailable, mesh security operations are skipped and a warning is emitted once.

### Permissions

```ts
await BluetoothClassic.requestPermissionsAsync();
await BluetoothBLE.requestPermissionsAsync();
```

### Classic Discovery + Connect

```ts
await BluetoothClassic.startDiscoveryAsync();
const devices = await BluetoothClassic.getDiscoveredDevicesAsync();
const connection = await BluetoothClassic.connectAsync({ deviceId: devices[0].id });
await BluetoothClassic.writeAsync(connection.connectionId, "SGVsbG8=");
```

### BLE Scan + Connect + MTU

```ts
await BluetoothBLE.startScanAsync({ serviceUuids: ["180F"] });
const devices = await BluetoothBLE.getScannedDevicesAsync();
const connection = await BluetoothBLE.connectAsync({ deviceId: devices[0].id });
await BluetoothBLE.requestMtuAsync(connection.connectionId, 247);
```

## Events

- `BluetoothClassic.addListener((event) => ...)`
- `BluetoothBLE.addListener((event) => ...)`

Each API emits discovery/scan results, connection updates, data/notification events, and structured errors.
