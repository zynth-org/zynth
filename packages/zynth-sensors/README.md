# @zynth/sensors

Device sensor APIs for Zynth with Solid-friendly composables and per-sensor permission helpers.

`@zynth/sensors` includes:

- Accelerometer
- Barometer
- Device Motion
- Gyroscope
- Light Sensor
- Magnetometer
- Magnetometer Uncalibrated
- Pedometer

## Basic

### Install

```bash
npm i @zynth/sensors
```

Regenerate native projects after adding the package.

### Basic usage

```ts
import { Sensors, createAccelerometer } from "@zynth/sensors";

const available = await Sensors.isAvailableAsync("accelerometer");
const permission = await Sensors.requestPermissionAsync("accelerometer");

const accelerometer = createAccelerometer({
  autoStart: false,
  requestPermission: true,
  sampleIntervalMs: 80,
});

await accelerometer.start();
console.log(available, permission.status, accelerometer.reading());
```

### Recommended Solid usage

Use `createXxx` composables inside components. They manage native subscription lifecycle (`onMount`/`onCleanup`) and expose stable Solid accessors.

```ts
import { createGyroscope } from "@zynth/sensors";

const gyro = createGyroscope({
  autoStart: true,
  requestPermission: true,
  sampleIntervalMs: 100,
});

const value = gyro.reading();
const active = gyro.active();
```

## Advanced

### Why `createXxx` composables

Each sensor composable returns a `SensorController` with:

- accessors: `reading`, `available`, `permission`, `active`, `error`
- actions: `start`, `stop`, `refreshCurrent`, `refreshAvailability`, `refreshPermission`, `requestPermission`

This is the default DX for Solid apps, while low-level `Sensors.*` methods stay available for custom orchestration.

### Low-level API usage

Use `Sensors` directly when you want full control over start/stop/listen flows:

```ts
import { Sensors } from "@zynth/sensors";

const sub = await Sensors.addListener("deviceMotion", (reading) => {
  console.log(reading.attitude?.pitch, reading.attitude?.roll, reading.attitude?.yaw);
}, { sampleIntervalMs: 120 });

const current = await Sensors.getReadingAsync("deviceMotion");
await Sensors.stopAsync("deviceMotion");
sub.remove();
```

### Sampling interval

- `sampleIntervalMs` defaults to `100`
- Minimum interval is clamped to `10` ms

### Availability vs permission

- `isAvailableAsync(sensor)` checks if the device/platform exposes that sensor.
- `getPermissionAsync(sensor)` checks runtime permission status.
- `requestPermissionAsync(sensor)` only prompts when the platform requires it.

If a sensor is unavailable, permission returns:

- `status: "unavailable"`
- `granted: false`
- `canAskAgain: false`

## Permissions and Platform Notes

### iOS

Add this to app config (`zynth.ios.infoPlist`):

- `NSMotionUsageDescription`

Example:

```json
{
  "zynth": {
    "ios": {
      "infoPlist": {
        "NSMotionUsageDescription": "This app uses motion sensors to provide sensor data."
      }
    }
  }
}
```

Behavior notes:

- `accelerometer`, `gyroscope`, `deviceMotion`: use iOS motion authorization.
- `pedometer`: uses Core Motion pedometer authorization.
- `lightSensor`: unavailable on iOS in current implementation.
- `magnetometerUncalibrated`: unavailable on iOS in current implementation.

### Android

Manifest requirement (already declared by the package):

- `android.permission.ACTIVITY_RECOGNITION` for pedometer on API 29+

Behavior notes:

- Most sensors are granted by default at runtime.
- `pedometer` requires runtime permission request on API 29+.

### Sensor matrix (current implementation)

- `accelerometer`: iOS/Android available by hardware, runtime permission flow supported
- `barometer`: iOS/Android available by hardware, no dedicated runtime prompt
- `deviceMotion`: iOS/Android available by hardware, runtime permission flow supported
- `gyroscope`: iOS/Android available by hardware, runtime permission flow supported
- `lightSensor`: Android only (iOS returns unavailable)
- `magnetometer`: iOS/Android available by hardware
- `magnetometerUncalibrated`: Android only (iOS returns unavailable)
- `pedometer`: iOS/Android available by hardware, explicit runtime permission handling

## API reference

### `Sensors`

- `isAvailableAsync(sensor: SensorKind): Promise<boolean>`
- `getPermissionAsync(sensor: SensorKind): Promise<SensorPermissionResponse>`
- `requestPermissionAsync(sensor: SensorKind): Promise<SensorPermissionResponse>`
- `startAsync(sensor: SensorKind, options?: SensorStartOptions): Promise<boolean>`
- `stopAsync(sensor: SensorKind): Promise<void>`
- `getReadingAsync(sensor: SensorKind): Promise<SensorReading | null>`
- `addListener(sensor, listener, options?): Promise<SensorSubscription>`

### Sensor composables

- `createAccelerometer(options?)`
- `createBarometer(options?)`
- `createDeviceMotion(options?)`
- `createGyroscope(options?)`
- `createLightSensor(options?)`
- `createMagnetometer(options?)`
- `createMagnetometerUncalibrated(options?)`
- `createPedometer(options?)`

Each returns `SensorController<TSample>`.

### Core types

- `SensorKind`
  - `"accelerometer" | "barometer" | "deviceMotion" | "gyroscope" | "lightSensor" | "magnetometer" | "magnetometerUncalibrated" | "pedometer"`
- `SensorPermissionStatus`
  - `"granted" | "denied" | "restricted" | "undetermined" | "unavailable"`
- `SensorPermissionResponse`
  - `status`, `granted`, `canAskAgain`
- `SensorStartOptions`
  - `sampleIntervalMs?`
- `CreateSensorOptions`
  - `autoStart?`, `requestPermission?`, `sampleIntervalMs?`
- `SensorSubscription`
  - `remove()`

Reading types are exported per sensor:

- `AccelerometerSample`
- `BarometerSample`
- `DeviceMotionSample`
- `GyroscopeSample`
- `LightSensorSample`
- `MagnetometerSample`
- `MagnetometerUncalibratedSample`
- `PedometerSample`
