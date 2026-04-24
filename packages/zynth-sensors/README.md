# Sensors

The `Sensors` module exposes comprehensive read access to fundamental device capabilities including the accelerometer, gyroscope, device motion algorithms, magnetometers, and pedometer. Built natively using CoreMotion on iOS and SensorManager on Android, the real-world readings are bridged efficiently to JavaScript through direct HostObject references and parsed directly into reactive SolidJS signals while minimizing heavy cross-bridge serialization costs.

Before utilizing health-related or restricted sensors such as the Pedometer or advanced Device Motion, you must declare the necessary permissions and usage descriptions in your `app.json` configuration file.

```json
{
  "zynth": {
    "ios": {
      "infoPlist": {
        "NSMotionUsageDescription": "This app requires access to the device's motion sensors to track steps and physical activity."
      }
    },
    "android": {
      "permissions": [
        "android.permission.ACTIVITY_RECOGNITION"
      ]
    }
  }
}
```

## Basic usage

The most common approach is instantiating a reactive sensor controller using primitives like `createAccelerometer`. The controller provides granular accessors that integrate cleanly into your render tree and automatically disconnect when your component unmounts.

```tsx
import { Text, View } from "@zynthjs/components";
import { createAccelerometer } from "@zynthjs/sensors";

export function TiltDisplay() {
  const accelerometer = createAccelerometer({ autoStart: true, sampleIntervalMs: 100 });

  return (
    <View style={{ flex: 1, padding: 16 }}>
      <Text>Accelerometer Output</Text>
      <Text>X: {accelerometer.reading()?.x.toFixed(3) ?? "-"}</Text>
      <Text>Y: {accelerometer.reading()?.y.toFixed(3) ?? "-"}</Text>
      <Text>Z: {accelerometer.reading()?.z.toFixed(3) ?? "-"}</Text>
    </View>
  );
}
```

## Advanced usage and permissions

Certain sensors like the pedometer require explicit user consent before relaying historical or health-related biometric data. You can leverage the controller's built-in capability to request permissions effectively before allocating active tracking instances.

```tsx
import { Button, Text, View } from "@zynthjs/components";
import { createPedometer } from "@zynthjs/sensors";

export function PedometerView() {
  const pedometer = createPedometer({
    autoStart: false,
    requestPermission: false,
  });

  const handleStartTracking = async () => {
    const perm = await pedometer.requestPermission();
    if (perm.granted) {
      await pedometer.start();
    } else {
      console.log("Pedometer permissions denied.");
    }
  };

  return (
    <View style={{ padding: 24, gap: 16 }}>
      <Text>Steps taken: {pedometer.reading()?.steps ?? 0}</Text>
      <Button 
        onPress={handleStartTracking} 
        disabled={pedometer.active()}
      >
        <Text>Start tracking</Text>
      </Button>
    </View>
  );
}
```

## Special Cases

### Hardware Constraints

It is common for environments such as iOS Simulators, Android Emulators, or Web targets to lack specific physical hardware availability (like accelerometers or light sensors). Always verify that the device physically supports an underlying sensor before attempting to start a subscription by evaluating `controller.available()`.

## API Reference

### Primitives

The framework abstracts the underlying native module via specific SolidJS reactive hooks targeting individual component algorithms:

*   `createAccelerometer(options?: CreateSensorOptions)`
*   `createBarometer(options?: CreateSensorOptions)`
*   `createDeviceMotion(options?: CreateSensorOptions)`
*   `createGyroscope(options?: CreateSensorOptions)`
*   `createLightSensor(options?: CreateSensorOptions)`
*   `createMagnetometer(options?: CreateSensorOptions)`
*   `createMagnetometerUncalibrated(options?: CreateSensorOptions)`
*   `createPedometer(options?: CreateSensorOptions)`

### `SensorController<TSample>`

The unified interface tracking and administrating subscriptions emitted by any of the native hook creations.

**Members**

*   `reading()`: Accessor outputting the current specific `TSample` interval output, or `null`.
*   `available()`: Accessor indicating securely if the explicit sensor hardware was detected correctly.
*   `permission()`: Accessor holding the resolution map of the permissions (`SensorPermissionResponse | null`).
*   `active()`: Accessor determining if polling loops are processing data from the OS.
*   `error()`: Accessor signaling abrupt crash faults on the native thread.
*   `start()`: Executes a `Promise<boolean>` binding native observers and activating the poll interval loop.
*   `stop()`: Drops native binding synchronously enforcing cleanup.
*   `requestPermission()`: Invokes a `Promise<SensorPermissionResponse>` mapping the OS-level modal dialog if applicable.

### `CreateSensorOptions`

Employed when invoking the initialization hooks configuring their lifecycle.

*   `autoStart` (`boolean`, optional): Determines whether to bypass manual start requirements natively once the DOM commits.
*   `requestPermission` (`boolean`, optional): Pushes explicit permission modal requests inherently if `autoStart` engages.
*   `sampleIntervalMs` (`number`, optional): Millisecond delay instructing internal host logic to throttle serialization.

### Readings & Samples

Each sensor extends a base implementation containing `{ timestamp: number; accuracy?: number }`.

#### `AccelerometerSample`, `GyroscopeSample`, `MagnetometerSample`
*   `x` (`number`): Lateral axes mappings.
*   `y` (`number`): Vertical axes mappings.
*   `z` (`number`): Depth mappings.

#### `LightSensorSample`
*   `illuminanceLux` (`number`): Floating lux integer capturing ambient intensities around the core receiver.

#### `BarometerSample`
*   `pressureKPa` (`number`): Floating structural mapping tracking environmental atmospheric properties.
*   `relativeAltitudeMeters` (`number`, optional): Device differential vertical movement relative to sea level defaults.

#### `DeviceMotionSample`
Comprehensive aggregated outputs mapping real-world physical device chassis orientations via fusion techniques natively bridging multiple underlying sensors.
*   `acceleration` (`{ x, y, z }`, optional)
*   `gravity` (`{ x, y, z }`, optional)
*   `rotationRate` (`{ x, y, z }`, optional)
*   `attitude` (`{ pitch, roll, yaw, quaternion }`, optional)

#### `PedometerSample`
*   `steps` (`number`)
*   `distanceMeters` (`number`, optional): Total historical or session length mappings depending on core OS reporting structures.
*   `floorsAscended` (`number`, optional)
*   `floorsDescended` (`number`, optional)
