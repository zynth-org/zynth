# Device

The default hardware metadata surface in Zynth is `device`, which provides comprehensive information about the hardware and operating system environment.

It aggregates information from native property managers to provide unique identifiers, model names, and display hardware characteristics (such as notch areas and corner radii).

## Basic usage

Access the frozen `DeviceInfo` object directly through `device.current`. No asynchronous call is required for the initial read because information is synchronized during app bootstrap.

```tsx
import { device } from "@zynthjs/apis";

const info = device.current;

console.log(`Manufacturer: ${info.manufacturer}`);
console.log(`Model: ${info.model}`);
console.log(`Running on Emulator: ${info.isEmulator}`);
```

## Advanced

### Unique Identifiers

Zynth provides a globally unique ID (`uniqueId`) which is persistent for the installation of the application.

```ts
const deviceUid = device.current.uniqueId;
// Example: "3F2504E0-4F89-41D3-9A0C-0305E82C3301"
```

### Display Characteristics

You can detect if the device has a rounded display and query its hardware corner radius.

```ts
if (device.current.hasRoundedDisplayCorners) {
    console.log(`Corner radius: ${device.current.displayCornerRadius}dp`);
}
```

## Special cases

- **SDK Context**: On Android, the `sdkInt` property is available to check the API level (e.g., `33` for Android 13). On other platforms, this remains `null`.
- **Serial Numbers**: Hardware serial numbers are often restricted by modern OS privacy policies. This value may be `null` or a randomized placeholder depending on the platform version.

## API Reference

### `device.current`: `DeviceInfo`
The current, immutable snapshot of the device metadata.

### `device.refresh(): DeviceInfo`
Refreshes the device snapshot from the native source and returns the latest value.

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

### Legacy compatibility

`Device.info`, `Device.getInfo()`, and `Device.refresh()` remain available for compatibility.
