# Device

The `Device` API provides comprehensive metadata about the hardware and operating system environment.

It aggregates information from native property managers to provide unique identifiers, model names, and display hardware characteristics (such as notch areas and corner radii).

## Basic usage

Access the frozen `DeviceInfo` object directly. No asynchronous call is required for the initial read as information is synchronized during app bootstrap.

```tsx
import { Device } from "@zynth/apis";

const info = Device.info;

console.log(`Manufacturer: ${info.manufacturer}`);
console.log(`Model: ${info.model}`);
console.log(`Running on Emulator: ${info.isEmulator}`);
```

## Advanced

### Unique Identifiers

Zynth provides a globally unique ID (`uniqueId`) which is persistent for the installation of the application.

```ts
const deviceUid = Device.info.uniqueId;
// Example: "3F2504E0-4F89-41D3-9A0C-0305E82C3301"
```

### Display Characteristics

You can detect if the device has a rounded display and query its hardware corner radius.

```ts
if (Device.info.hasRoundedDisplayCorners) {
    console.log(`Corner radius: ${Device.info.displayCornerRadius}dp`);
}
```

## Special cases

- **SDK Context**: On Android, the `sdkInt` property is available to check the API level (e.g., `33` for Android 13). On other platforms, this remains `null`.
- **Serial Numbers**: Hardware serial numbers are often restricted by modern OS privacy policies. This value may be `null` or a randomized placeholder depending on the platform version.

## API Reference

### `Device.info`: `DeviceInfo`
The current, immutable snapshot of the device metadata.

### `DeviceInfo` Structure
- `platform: "ios" | "android" | "web"`
- `model: string` (e.g., "iPhone 15 Pro")
- `modelId: string` (e.g., "iPhone16,1")
- `brand: string` (e.g., "Apple", "Google")
- `manufacturer: string` (e.g., "Foxconn", "Samsung")
- `deviceName: string` (User defined name)
- `osName: string`
- `osVersion: string` (e.g., "17.4", "14")
- `osBuildId: string`
- `serialNumber: string | null`
- `uniqueId: string`
- `sdkInt: number | null` (Android API level)
- `isEmulator: boolean`
- `hasRoundedDisplayCorners: boolean`
- `displayCornerRadius: number | null`
