export type SensorKind =
  | "accelerometer"
  | "barometer"
  | "deviceMotion"
  | "gyroscope"
  | "lightSensor"
  | "magnetometer"
  | "magnetometerUncalibrated"
  | "pedometer";

export type SensorPermissionStatus =
  | "granted"
  | "denied"
  | "restricted"
  | "undetermined"
  | "unavailable";

export type SensorPermissionResponse = {
  status: SensorPermissionStatus;
  granted: boolean;
  canAskAgain: boolean;
};

export type SensorSampleBase = {
  timestamp: number;
  accuracy?: number;
};

export type AccelerometerSample = SensorSampleBase & {
  x: number;
  y: number;
  z: number;
};

export type GyroscopeSample = SensorSampleBase & {
  x: number;
  y: number;
  z: number;
};

export type MagnetometerSample = SensorSampleBase & {
  x: number;
  y: number;
  z: number;
};

export type MagnetometerUncalibratedSample = SensorSampleBase & {
  x: number;
  y: number;
  z: number;
  biasX?: number;
  biasY?: number;
  biasZ?: number;
};

export type LightSensorSample = SensorSampleBase & {
  illuminanceLux: number;
};

export type BarometerSample = SensorSampleBase & {
  pressureKPa: number;
  relativeAltitudeMeters?: number;
};

export type DeviceMotionSample = SensorSampleBase & {
  acceleration?: { x: number; y: number; z: number };
  gravity?: { x: number; y: number; z: number };
  rotationRate?: { x: number; y: number; z: number };
  attitude?: {
    pitch: number;
    roll: number;
    yaw: number;
    quaternion?: { x: number; y: number; z: number; w: number };
  };
};

export type PedometerSample = SensorSampleBase & {
  steps: number;
  distanceMeters?: number;
  floorsAscended?: number;
  floorsDescended?: number;
};

export type SensorReadingMap = {
  accelerometer: AccelerometerSample;
  barometer: BarometerSample;
  deviceMotion: DeviceMotionSample;
  gyroscope: GyroscopeSample;
  lightSensor: LightSensorSample;
  magnetometer: MagnetometerSample;
  magnetometerUncalibrated: MagnetometerUncalibratedSample;
  pedometer: PedometerSample;
};

export type SensorReading = SensorReadingMap[SensorKind];

export type SensorSubscription = {
  remove: () => void;
};

export type SensorStartOptions = {
  sampleIntervalMs?: number;
};

export type CreateSensorOptions = SensorStartOptions & {
  autoStart?: boolean;
  requestPermission?: boolean;
};

export type SensorController<TSample extends SensorReading> = {
  reading: () => TSample | null;
  available: () => boolean;
  permission: () => SensorPermissionResponse | null;
  active: () => boolean;
  error: () => Error | null;
  start: () => Promise<boolean>;
  stop: () => void;
  refreshCurrent: () => Promise<TSample | null>;
  refreshAvailability: () => Promise<boolean>;
  refreshPermission: () => Promise<SensorPermissionResponse>;
  requestPermission: () => Promise<SensorPermissionResponse>;
};
