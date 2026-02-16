import { createSignal, onCleanup, onMount } from "solid-js";
import { callNative, isNativeAvailable } from "./native";
import { isSensorKind, normalizePermission, normalizeReading } from "./normalize";
import type {
  CreateSensorOptions,
  SensorController,
  SensorKind,
  SensorPermissionResponse,
  SensorReading,
  SensorReadingMap,
  SensorStartOptions,
  SensorSubscription,
} from "./types";

type NativeEventSubscription = { remove(): void };

type NativeEmitter = {
  addListener(
    eventName: string,
    callback: (payload: unknown) => void
  ): NativeEventSubscription;
};

type SensorUpdatePayload = {
  sensor?: unknown;
  data?: unknown;
};

type PermissionEventPayload = {
  requestId?: unknown;
  status?: unknown;
  granted?: unknown;
  canAskAgain?: unknown;
};

type PermissionRequestResult = {
  pending?: unknown;
};

const SENSOR_EVENT = "Sensors.update";
const PERMISSION_EVENT = "Sensors.permission";
const DEFAULT_INTERVAL_MS = 100;

const sensorListeners = new Map<SensorKind, Set<(reading: SensorReading) => void>>();
const sensorOptions = new Map<SensorKind, SensorStartOptions>();
let nativeEventSubscription: NativeEventSubscription | null = null;

function getGlobalObject(): Record<string, unknown> {
  if (typeof globalThis !== "undefined") {
    return globalThis as Record<string, unknown>;
  }
  try {
    const fallback = Function("return this")();
    if (fallback && typeof fallback === "object") {
      return fallback as Record<string, unknown>;
    }
  } catch {
    // ignore
  }
  return {};
}

function getNativeEmitter(): NativeEmitter | null {
  const emitter = (getGlobalObject() as { ZynthNativeEmitter?: unknown }).ZynthNativeEmitter;
  if (!emitter || typeof emitter !== "object") {
    return null;
  }
  const typed = emitter as Partial<NativeEmitter>;
  if (typeof typed.addListener !== "function") {
    return null;
  }
  return typed as NativeEmitter;
}


function getIntervalMs(options?: SensorStartOptions): number {
  const value = options?.sampleIntervalMs;
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    return DEFAULT_INTERVAL_MS;
  }
  return Math.max(10, Math.round(value));
}

function toBoolean(value: unknown): boolean {
  if (value === true) return true;
  if (value === false || value == null) return false;
  if (typeof value === "number") return value !== 0;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    return normalized === "true" || normalized === "1" || normalized === "yes";
  }
  if (typeof value === "object") {
    const maybe = value as { valueOf?: () => unknown };
    if (typeof maybe.valueOf === "function") {
      const resolved = maybe.valueOf();
      if (resolved !== value) {
        return toBoolean(resolved);
      }
    }
  }
  return false;
}

function ensureNativeUpdateListener(): void {
  if (nativeEventSubscription) {
    return;
  }

  const emitter = getNativeEmitter();
  if (!emitter) {
    return;
  }

  nativeEventSubscription = emitter.addListener(SENSOR_EVENT, (payload: unknown) => {
    if (!payload || typeof payload !== "object") {
      return;
    }
    const event = payload as SensorUpdatePayload;
    const sensor = event.sensor;
    if (!isSensorKind(sensor)) {
      return;
    }

    const reading = normalizeReading(sensor, event.data);
    if (!reading) {
      return;
    }

    const listeners = sensorListeners.get(sensor);
    if (!listeners || listeners.size === 0) {
      return;
    }

    for (const listener of listeners) {
      listener(reading);
    }
  });
}

function teardownNativeUpdateListenerIfIdle(): void {
  if (
    nativeEventSubscription &&
    Array.from(sensorListeners.values()).every((set) => set.size === 0)
  ) {
    nativeEventSubscription.remove();
    nativeEventSubscription = null;
  }
}

async function startNativeSensor(sensor: SensorKind, options?: SensorStartOptions): Promise<boolean> {
  if (!isNativeAvailable()) {
    return false;
  }

  const interval = getIntervalMs(options);
  const started = await callNative<unknown>("startUpdates", {
    sensor,
    sampleIntervalMs: interval,
  });
  return toBoolean(started);
}

async function stopNativeSensor(sensor: SensorKind): Promise<void> {
  if (!isNativeAvailable()) {
    return;
  }
  await callNative<unknown>("stopUpdates", { sensor });
}

async function subscribeSensor(
  sensor: SensorKind,
  listener: (reading: SensorReading) => void,
  options?: SensorStartOptions
): Promise<SensorSubscription> {
  ensureNativeUpdateListener();

  const listeners = sensorListeners.get(sensor) ?? new Set<(reading: SensorReading) => void>();
  const wasEmpty = listeners.size === 0;
  listeners.add(listener);
  sensorListeners.set(sensor, listeners);

  if (wasEmpty) {
    sensorOptions.set(sensor, options ?? {});
    await startNativeSensor(sensor, options);
  }

  return {
    remove: () => {
      const current = sensorListeners.get(sensor);
      if (!current) {
        return;
      }
      current.delete(listener);
      if (current.size === 0) {
        sensorListeners.delete(sensor);
        sensorOptions.delete(sensor);
        void stopNativeSensor(sensor);
      }
      teardownNativeUpdateListenerIfIdle();
    },
  };
}

function createRequestId(): string {
  return `sensors-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export const Sensors = {
  async isAvailableAsync(sensor: SensorKind): Promise<boolean> {
    if (!isNativeAvailable()) {
      return false;
    }
    const raw = await callNative<unknown>("isAvailable", { sensor });
    const available = toBoolean(raw);
    return available;
  },

  async getPermissionAsync(sensor: SensorKind): Promise<SensorPermissionResponse> {
    if (!isNativeAvailable()) {
      return { status: "unavailable", granted: false, canAskAgain: false };
    }
    const result = await callNative<unknown>("getPermissionStatus", { sensor });
    return normalizePermission(result);
  },

  async requestPermissionAsync(sensor: SensorKind): Promise<SensorPermissionResponse> {
    if (!isNativeAvailable()) {
      return { status: "unavailable", granted: false, canAskAgain: false };
    }

    const emitter = getNativeEmitter();
    const requestId = createRequestId();
    const result = await callNative<unknown>("requestPermission", { sensor, requestId });

    const maybePending = result as PermissionRequestResult;
    if (maybePending?.pending !== true) {
      return normalizePermission(result);
    }

    if (!emitter) {
      return Sensors.getPermissionAsync(sensor);
    }

    return new Promise<SensorPermissionResponse>((resolve) => {
      const subscription = emitter.addListener(PERMISSION_EVENT, (payload: unknown) => {
        if (!payload || typeof payload !== "object") {
          return;
        }
        const event = payload as PermissionEventPayload;
        if (event.requestId !== requestId) {
          return;
        }

        subscription.remove();
        resolve(
          normalizePermission({
            status: event.status,
            granted: event.granted,
            canAskAgain: event.canAskAgain,
          })
        );
      });
    });
  },

  async startAsync(sensor: SensorKind, options?: SensorStartOptions): Promise<boolean> {
    return startNativeSensor(sensor, options);
  },

  async stopAsync(sensor: SensorKind): Promise<void> {
    await stopNativeSensor(sensor);
  },

  async getReadingAsync<TKind extends SensorKind>(
    sensor: TKind
  ): Promise<SensorReadingMap[TKind] | null> {
    if (!isNativeAvailable()) {
      return null;
    }

    const data = await callNative<unknown>("readCurrent", { sensor });
    return normalizeReading(sensor, data);
  },

  async addListener<TKind extends SensorKind>(
    sensor: TKind,
    listener: (reading: SensorReadingMap[TKind]) => void,
    options?: SensorStartOptions
  ): Promise<SensorSubscription> {
    const wrapped = (reading: SensorReading) => {
      listener(reading as SensorReadingMap[TKind]);
    };
    return subscribeSensor(sensor, wrapped, options);
  },
};

function createSensorController<TKind extends SensorKind>(
  sensor: TKind,
  options: CreateSensorOptions = {}
): SensorController<SensorReadingMap[TKind]> {
  const [reading, setReading] = createSignal<SensorReadingMap[TKind] | null>(null);
  const [available, setAvailable] = createSignal(false);
  const [permission, setPermission] = createSignal<SensorPermissionResponse | null>(null);
  const [active, setActive] = createSignal(false);
  const [error, setError] = createSignal<Error | null>(null);
  let subscription: SensorSubscription | null = null;

  const start = async (): Promise<boolean> => {
    try {
      setError(null);

      const isAvailable = await Sensors.isAvailableAsync(sensor);
      setAvailable(isAvailable);
      if (!isAvailable) {
        setActive(false);
        return false;
      }

      const currentPermission = await Sensors.getPermissionAsync(sensor);
      setPermission(currentPermission);

      if (options.requestPermission && currentPermission.granted === false) {
        const requested = await Sensors.requestPermissionAsync(sensor);
        setPermission(requested);
      }

      const latestPermission = permission();
      if (
        latestPermission &&
        (latestPermission.status === "denied" ||
          latestPermission.status === "restricted" ||
          latestPermission.status === "unavailable") &&
        sensor !== "lightSensor"
      ) {
        setActive(false);
        return false;
      }

      subscription = await Sensors.addListener(
        sensor,
        (next) => setReading(() => next),
        { sampleIntervalMs: options.sampleIntervalMs }
      );

      setActive(true);
      const current = await Sensors.getReadingAsync(sensor);
      if (current) {
        setReading(() => current);
      }
      return true;
    } catch (cause) {
      setActive(false);
      setError(cause instanceof Error ? cause : new Error(String(cause)));
      return false;
    }
  };

  const stop = (): void => {
    subscription?.remove();
    subscription = null;
    setActive(false);
  };

  const refreshCurrent = async (): Promise<SensorReadingMap[TKind] | null> => {
    try {
      const current = await Sensors.getReadingAsync(sensor);
      if (current) {
        setReading(() => current);
      }
      return current;
    } catch (cause) {
      setError(cause instanceof Error ? cause : new Error(String(cause)));
      return null;
    }
  };

  const refreshAvailability = async (): Promise<boolean> => {
    try {
      const next = await Sensors.isAvailableAsync(sensor);
      setAvailable(next);
      return next;
    } catch (cause) {
      setError(cause instanceof Error ? cause : new Error(String(cause)));
      setAvailable(false);
      return false;
    }
  };

  const refreshPermission = async (): Promise<SensorPermissionResponse> => {
    try {
      const next = await Sensors.getPermissionAsync(sensor);
      setPermission(next);
      return next;
    } catch (cause) {
      const err = cause instanceof Error ? cause : new Error(String(cause));
      setError(err);
      const unavailable: SensorPermissionResponse = {
        status: "unavailable",
        granted: false,
        canAskAgain: false,
      };
      setPermission(unavailable);
      return unavailable;
    }
  };

  const requestPermission = async (): Promise<SensorPermissionResponse> => {
    try {
      const next = await Sensors.requestPermissionAsync(sensor);
      setPermission(next);
      return next;
    } catch (cause) {
      const err = cause instanceof Error ? cause : new Error(String(cause));
      setError(err);
      const unavailable: SensorPermissionResponse = {
        status: "unavailable",
        granted: false,
        canAskAgain: false,
      };
      setPermission(unavailable);
      return unavailable;
    }
  };

  onMount(() => {
    if (options.autoStart !== false) {
      void start();
    } else {
      void refreshAvailability();
      void refreshPermission();
    }
  });

  onCleanup(() => {
    stop();
  });

  return {
    reading,
    available,
    permission,
    active,
    error,
    start,
    stop,
    refreshCurrent,
    refreshAvailability,
    refreshPermission,
    requestPermission,
  };
}

export function createAccelerometer(options?: CreateSensorOptions) {
  return createSensorController("accelerometer", options);
}

export function createBarometer(options?: CreateSensorOptions) {
  return createSensorController("barometer", options);
}

export function createDeviceMotion(options?: CreateSensorOptions) {
  return createSensorController("deviceMotion", options);
}

export function createGyroscope(options?: CreateSensorOptions) {
  return createSensorController("gyroscope", options);
}

export function createLightSensor(options?: CreateSensorOptions) {
  return createSensorController("lightSensor", options);
}

export function createMagnetometer(options?: CreateSensorOptions) {
  return createSensorController("magnetometer", options);
}

export function createMagnetometerUncalibrated(options?: CreateSensorOptions) {
  return createSensorController("magnetometerUncalibrated", options);
}

export function createPedometer(options?: CreateSensorOptions) {
  return createSensorController("pedometer", options);
}
