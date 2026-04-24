# Bluetooth Low Energy (BLE)

Hardware-accelerated Bluetooth Low Energy (BLE) functionality for Zynth applications, supporting both Central and Peripheral modes.

The `@zynthjs/bluetooth` package provides a unified API over **CoreBluetooth** (iOS) and **BluetoothGatt** (Android). It handles the complexities of scanning, connection stability, and GATT service/characteristic interactions.

## Central Mode usage

### Scanning for Devices

The `startScanAsync` method initiates a native BLE scan. You must listen for the `device_found` event to receive results.

```tsx
import { BluetoothBLE } from "@zynthjs/bluetooth";

const discover = async () => {
  // 1. Listen for results
  const sub = BluetoothBLE.addListener((event) => {
    if (event.type === "device_found") {
      console.log("Device found:", event.device.name, event.device.id);
    }
  });

  // 2. Start scanning (supports filtering by service UUIDs)
  await BluetoothBLE.startScanAsync({
    serviceUuids: ["180D"] // Pulse Ox
  });

  // 3. Stop after 10s
  setTimeout(() => {
    BluetoothBLE.stopScanAsync();
    sub.remove();
  }, 10000);
};
```

### Connecting and GATT Operations

Once you have a `deviceId`, you can connect and interact with its services.

```tsx
const interact = async (deviceId: string) => {
  // 1. Establish connection
  const conn = await BluetoothBLE.connectAsync({ deviceId });
  const { connectionId } = conn;

  // 2. Discover services
  const services = await BluetoothBLE.discoverServicesAsync(connectionId);

  // 3. Read a characteristic
  const dataBase64 = await BluetoothBLE.readCharacteristicAsync({
    connectionId,
    serviceUuid: "180D",
    characteristicUuid: "2A37"
  });

  // 4. Register for notifications
  await BluetoothBLE.setNotificationAsync({
    connectionId,
    serviceUuid: "180D",
    characteristicUuid: "2A37",
    enabled: true
  });
};
```

## Peripheral Mode usage

Zynth allows your app to act as a BLE Peripheral (GATT Server), advertising services to other devices.

```tsx
const startServer = async () => {
  const state = await BluetoothBLE.startPeripheralAsync({
    localName: "ZynthSensor",
    serviceUuid: "FFF0",
    characteristicUuid: "FFF1",
    initialValueBase64: "SGVsbG8=" // "Hello"
  });

  console.log("Peripheral running:", state.running);
};

// Update the value later to notify connected centrals
const notify = async (data: string) => {
  await BluetoothBLE.updatePeripheralCharacteristicAsync(btoa(data));
};
```

## Special cases

- **Reconnection Policy**: Zynth includes a built-in exponential backoff reconnection system. If a connection is lost, you can use `reconnectAsync` with a custom `policy` (max attempts, delays, etc.) to restore the session.
- **MTU Negotiation**: Android devices often start with a small MTU (23 bytes). Use `requestMtuAsync` to negotiate a larger packet size (up to 517 bytes) for higher throughput.
- **Permissions**: Bluetooth permissions are handled natively. Use `requestPermissionsAsync()` to trigger the system dialogs. On Android 12+, this includes `BLUETOOTH_SCAN`, `BLUETOOTH_CONNECT`, and `ACCESS_FINE_LOCATION`.

## API Reference

### `BluetoothBLE` Methods

- `startScanAsync(options?: BleScanOptions): Promise<boolean>`
- `connectAsync(options: BleConnectOptions): Promise<BleConnectionInfo>`
- `discoverServicesAsync(connectionId: string): Promise<string[]>`
- `readCharacteristicAsync(target: BleCharacteristicTarget): Promise<string>`
- `writeCharacteristicAsync(options: BleWriteCharacteristicOptions): Promise<boolean>`
- `setNotificationAsync(options: BleNotificationOptions): Promise<boolean>`
- `startPeripheralAsync(config: BlePeripheralConfig): Promise<BlePeripheralState>`
- `updatePeripheralCharacteristicAsync(dataBase64: string): Promise<boolean>`
