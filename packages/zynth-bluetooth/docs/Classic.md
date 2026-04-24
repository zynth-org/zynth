# Bluetooth Classic

Legacy Bluetooth Classic functionality for Zynth applications, providing RFCOMM (SPP) socket communication for serial devices.

> [!WARNING]
> **Android Only**: Bluetooth Classic is currently only supported on the Android runtime. Calling these methods on iOS will result in an "Unsupported" result or an error.

The `@zynthjs/bluetooth/Classic` system allows your Zynth application to discover nearby classic devices and establish a raw serial connection using the most commonly used RFCOMM profile (00001101-0000-1000-8000-00805F9B34FB).

## Basic usage

### Discovery and Connection

Discovery in Bluetooth Classic works differently from BLE; it is a full scan for all nearby discoverable devices.

```tsx
import { BluetoothClassic } from "@zynthjs/bluetooth";

const setup = async () => {
  // 1. Listen for results
  BluetoothClassic.addListener((event) => {
    if (event.type === "device_found") {
      console.log("Classic device found:", event.device.name, event.device.id);
    }
  });

  // 2. Start discovery
  await BluetoothClassic.startDiscoveryAsync();
  
  // 3. Connect to a specific device via RFCOMM
  const conn = await BluetoothClassic.connectAsync({ 
    deviceId: "00:11:22:33:44:55",
    uuid: "00001101-0000-1000-8000-00805F9B34FB" // Standard SPP UUID
  });

  console.log("Connected to classic device:", conn.connectionId);
};
```

### Reading and Writing Data

Data is transmitted and received as Base64-encoded strings.

```tsx
const communicate = async (connectionId: string) => {
  // 1. Sending data
  await BluetoothClassic.writeAsync(connectionId, btoa("Hello Device"));

  // 2. Checking for received data (read from queue)
  const incoming = await BluetoothClassic.readAsync(connectionId);
  if (incoming) {
    console.log("Received:", atob(incoming));
  }
};
```

## Special cases

- **Serial Port Profile (SPP)**: The default UUID used by Zynth for connections is the industry-standard SPP UUID. Most serial adapters, printers, and medical devices use this profile.
- **Insecure Sockets**: Some older Bluetooth devices do not support secure pairing. You can specify `insecure: true` in `connectAsync` to attempt an unauthenticated RFCOMM connection.
- **HID Limitation**: Bluetooth Classic on Zynth does **not** support direct RFCOMM interaction with HID devices (keyboard, mouse, gamepads) as they are exclusively managed by the OS window manager.

## API Reference

### `BluetoothClassic` Methods

- `startDiscoveryAsync(options?: ClassicDiscoveryOptions): Promise<boolean>`
- `stopDiscoveryAsync(): Promise<boolean>`
- `getDiscoveredDevicesAsync(): Promise<ReadonlyArray<BluetoothDevice>>`
- `connectAsync(options: ClassicConnectOptions): Promise<ClassicConnectionInfo>`
- `reconnectAsync(options: ClassicReconnectOptions): Promise<ClassicConnectionInfo>`
- `disconnectAsync(connectionId: string): Promise<boolean>`
- `writeAsync(connectionId: string, dataBase64: string): Promise<boolean>`
- `readAsync(connectionId: string): Promise<string | null>`
- `getConnectionsAsync(): Promise<ReadonlyArray<ClassicConnectionInfo>>`
