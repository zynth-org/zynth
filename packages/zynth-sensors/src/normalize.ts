import type {
  SensorKind,
  SensorPermissionResponse,
  SensorReadingMap,
} from "./types";

export function isSensorKind(value: unknown): value is SensorKind {
  return (
    value === "accelerometer" ||
    value === "barometer" ||
    value === "deviceMotion" ||
    value === "gyroscope" ||
    value === "lightSensor" ||
    value === "magnetometer" ||
    value === "magnetometerUncalibrated" ||
    value === "pedometer"
  );
}

export function normalizePermission(value: unknown): SensorPermissionResponse {
  if (!value || typeof value !== "object") {
    return { status: "unavailable", granted: false, canAskAgain: false };
  }

  const record = value as Record<string, unknown>;
  const statusValue = record.status;
  const status =
    statusValue === "granted" ||
    statusValue === "denied" ||
    statusValue === "restricted" ||
    statusValue === "undetermined" ||
    statusValue === "unavailable"
      ? statusValue
      : "unavailable";

  return {
    status,
    granted: record.granted === true,
    canAskAgain: record.canAskAgain === true,
  };
}

export function normalizeReading<TKind extends SensorKind>(
  sensor: TKind,
  value: unknown
): SensorReadingMap[TKind] | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  const record = value as Record<string, unknown>;
  if (typeof record.timestamp !== "number") {
    return null;
  }

  const base: Record<string, unknown> = {
    timestamp: record.timestamp,
    accuracy: typeof record.accuracy === "number" ? record.accuracy : undefined,
  };

  switch (sensor) {
    case "accelerometer":
    case "gyroscope":
    case "magnetometer":
      if (
        typeof record.x === "number" &&
        typeof record.y === "number" &&
        typeof record.z === "number"
      ) {
        return {
          ...base,
          x: record.x,
          y: record.y,
          z: record.z,
        } as SensorReadingMap[TKind];
      }
      return null;
    case "magnetometerUncalibrated":
      if (
        typeof record.x === "number" &&
        typeof record.y === "number" &&
        typeof record.z === "number"
      ) {
        return {
          ...base,
          x: record.x,
          y: record.y,
          z: record.z,
          biasX: typeof record.biasX === "number" ? record.biasX : undefined,
          biasY: typeof record.biasY === "number" ? record.biasY : undefined,
          biasZ: typeof record.biasZ === "number" ? record.biasZ : undefined,
        } as SensorReadingMap[TKind];
      }
      return null;
    case "lightSensor":
      if (typeof record.illuminanceLux === "number") {
        return {
          ...base,
          illuminanceLux: record.illuminanceLux,
        } as SensorReadingMap[TKind];
      }
      return null;
    case "barometer":
      if (typeof record.pressureKPa === "number") {
        return {
          ...base,
          pressureKPa: record.pressureKPa,
          relativeAltitudeMeters:
            typeof record.relativeAltitudeMeters === "number"
              ? record.relativeAltitudeMeters
              : undefined,
        } as SensorReadingMap[TKind];
      }
      return null;
    case "pedometer":
      if (typeof record.steps === "number") {
        return {
          ...base,
          steps: record.steps,
          distanceMeters:
            typeof record.distanceMeters === "number" ? record.distanceMeters : undefined,
          floorsAscended:
            typeof record.floorsAscended === "number" ? record.floorsAscended : undefined,
          floorsDescended:
            typeof record.floorsDescended === "number" ? record.floorsDescended : undefined,
        } as SensorReadingMap[TKind];
      }
      return null;
    case "deviceMotion":
      return {
        ...base,
        acceleration: asVector(record.acceleration),
        gravity: asVector(record.gravity),
        rotationRate: asVector(record.rotationRate),
        attitude: asAttitude(record.attitude),
      } as SensorReadingMap[TKind];
    default:
      return null;
  }
}

function asVector(value: unknown): { x: number; y: number; z: number } | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }
  const record = value as Record<string, unknown>;
  if (
    typeof record.x !== "number" ||
    typeof record.y !== "number" ||
    typeof record.z !== "number"
  ) {
    return undefined;
  }
  return { x: record.x, y: record.y, z: record.z };
}

function asAttitude(
  value: unknown
):
  | {
      pitch: number;
      roll: number;
      yaw: number;
      quaternion?: { x: number; y: number; z: number; w: number };
    }
  | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }
  const record = value as Record<string, unknown>;
  if (
    typeof record.pitch !== "number" ||
    typeof record.roll !== "number" ||
    typeof record.yaw !== "number"
  ) {
    return undefined;
  }

  const quaternionValue = record.quaternion;
  let quaternion:
    | { x: number; y: number; z: number; w: number }
    | undefined;
  if (quaternionValue && typeof quaternionValue === "object") {
    const q = quaternionValue as Record<string, unknown>;
    if (
      typeof q.x === "number" &&
      typeof q.y === "number" &&
      typeof q.z === "number" &&
      typeof q.w === "number"
    ) {
      quaternion = { x: q.x, y: q.y, z: q.z, w: q.w };
    }
  }

  return {
    pitch: record.pitch,
    roll: record.roll,
    yaw: record.yaw,
    quaternion,
  };
}
