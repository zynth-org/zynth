# Bluetooth

Comprehensive Bluetooth integration for Zynth applications, supporting Low Energy (BLE), Classic (Android), and Mesh Networking.

The `@zynth/bluetooth` package provides a unified, reactive API for interacting with Bluetooth hardware. It is divided into three specialized subsystems:

- **[Bluetooth BLE (Low Energy)](./docs/BLE.md)**: Hardware-accelerated scanning, GATT client/server operations, and peripheral mode.
- **[Bluetooth Classic](./docs/Classic.md)**: Support for legacy RFCOMM/SPP serial devices (**Android only**).
- **[Bluetooth Mesh](./docs/Mesh.md)**: Decentralized, multi-hop mesh networking over BLE.

Before using any Bluetooth features, you must declare the required permissions in your `app.json` configuration file.

```json
{
  "zynth": {
    "ios": {
      "infoPlist": {
        "NSBluetoothAlwaysUsageDescription": "This app uses Bluetooth to connect to peripherals."
      }
    },
    "android": {
      "permissions": [
        "android.permission.ACCESS_FINE_LOCATION",
        "android.permission.BLUETOOTH_SCAN",
        "android.permission.BLUETOOTH_CONNECT",
        "android.permission.BLUETOOTH_ADVERTISE"
      ]
    }
  }
}
```

## Quick Start

```tsx
import { BluetoothBLE } from "@zynth/bluetooth";

const checkSupport = async () => {
  if (BluetoothBLE.isSupported()) {
    const status = await BluetoothBLE.requestPermissionsAsync();
    
    if (status.allGranted) {
      console.log("Ready to use Bluetooth!");
    }
  }
};
```

## Platform Support

| Feature | iOS (CoreBluetooth) | Android (Gatt/Socket) |
| :--- | :---: | :---: |
| **BLE Scan/Connect** | [x] | [x] |
| **GATT Operations** | [x] | [x] |
| **BLE Peripheral** | [x] | [x] |
| **Classic Discovery** | [ ] | [x] |
| **RFCOMM (SPP)** | [ ] | [x] |
| **Mesh Networking** | [x] | [x] |

---

## Detailed Documentation

- **[BLE (Scanning, Peripheral, GATT)](./docs/BLE.md)**
- **[Classic (RFCOMM, Discovery)](./docs/Classic.md)**
- **[Mesh (P2P, Relay, Security)](./docs/Mesh.md)**
