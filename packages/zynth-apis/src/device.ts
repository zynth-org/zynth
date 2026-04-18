import { callNativeSync, getGlobalObject, Platform } from "@zynth/core";
import { createSignal } from "solid-js";

const MODULE_NAME = "Device";

export type DevicePlatform = "ios" | "android" | "web";

export type DeviceInfo = Readonly<{
  platform: DevicePlatform;
  model: string | null;
  modelId: string | null;
  brand: string | null;
  manufacturer: string | null;
  deviceName: string | null;
  osName: string | null;
  osVersion: string | null;
  osBuildId: string | null;
  serialNumber: string | null;
  uniqueId: string | null;
  sdkInt: number | null;
  isEmulator: boolean;
  hasRoundedDisplayCorners: boolean;
  displayCornerRadius: number | null;
}>;

type DevicePayload = {
  platform?: unknown;
  model?: unknown;
  modelId?: unknown;
  brand?: unknown;
  manufacturer?: unknown;
  deviceName?: unknown;
  osName?: unknown;
  osVersion?: unknown;
  osBuildId?: unknown;
  serialNumber?: unknown;
  uniqueId?: unknown;
  sdkInt?: unknown;
  isEmulator?: unknown;
  hasRoundedDisplayCorners?: unknown;
  displayCornerRadius?: unknown;
};

function asStringOrNull(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function asNumberOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function normalizePlatform(value: unknown): DevicePlatform {
  if (value === "ios" || value === "android" || value === "web") {
    return value;
  }
  const platformOS = Platform.OS;
  if (platformOS === "ios") return "ios";
  if (platformOS === "android") return "android";
  return "web";
}

function normalizeDeviceInfo(value: unknown): DeviceInfo | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  const payload = value as DevicePayload;
  return Object.freeze({
    platform: normalizePlatform(payload.platform),
    model: asStringOrNull(payload.model),
    modelId: asStringOrNull(payload.modelId),
    brand: asStringOrNull(payload.brand),
    manufacturer: asStringOrNull(payload.manufacturer),
    deviceName: asStringOrNull(payload.deviceName),
    osName: asStringOrNull(payload.osName),
    osVersion: asStringOrNull(payload.osVersion),
    osBuildId: asStringOrNull(payload.osBuildId),
    serialNumber: asStringOrNull(payload.serialNumber),
    uniqueId: asStringOrNull(payload.uniqueId),
    sdkInt: asNumberOrNull(payload.sdkInt),
    isEmulator: Boolean(payload.isEmulator),
    hasRoundedDisplayCorners: Boolean(payload.hasRoundedDisplayCorners),
    displayCornerRadius: asNumberOrNull(payload.displayCornerRadius),
  });
}

function readNativeConstants(): DeviceInfo | null {
  const constants = getGlobalObject().NativeConstants as
    | Record<string, unknown>
    | undefined;
  if (!constants) return null;
  return normalizeDeviceInfo(constants[MODULE_NAME]);
}

function readFromBridge(): DeviceInfo | null {
  try {
    const result = callNativeSync<unknown>(MODULE_NAME, "getInfo");
    return normalizeDeviceInfo(result);
  } catch {
    return null;
  }
}

function readWebDeviceInfo(): DeviceInfo {
  const navigatorValue =
    typeof navigator === "undefined"
      ? null
      : (navigator as Navigator & { userAgentData?: { platform?: string } });
  const uaPlatform = navigatorValue?.userAgentData?.platform ?? navigatorValue?.platform ?? null;
  const model = navigatorValue?.userAgent ?? null;

  return Object.freeze({
    platform: "web",
    model,
    modelId: null,
    brand: asStringOrNull(uaPlatform),
    manufacturer: null,
    deviceName: null,
    osName: asStringOrNull(uaPlatform),
    osVersion: null,
    osBuildId: null,
    serialNumber: null,
    uniqueId: null,
    sdkInt: null,
    isEmulator: false,
    hasRoundedDisplayCorners: false,
    displayCornerRadius: null,
  });
}

let currentInfo: DeviceInfo =
  readNativeConstants() ?? readFromBridge() ?? readWebDeviceInfo();
const [deviceRevision, setDeviceRevision] = createSignal(0);

type DeviceBinding = Readonly<{
  readonly current: DeviceInfo;
  refresh(): DeviceInfo;
}>;

function createDeviceBinding(): DeviceBinding {
  return Object.freeze({
    get current(): DeviceInfo {
      deviceRevision();
      return currentInfo;
    },
    refresh(): DeviceInfo {
      return Device.refresh();
    },
  });
}

/**
 * Creates a reactive device binding for current hardware metadata.
 */
export function createDevice(): DeviceBinding {
  return createDeviceBinding();
}

/**
 * Shared device binding exposing the latest device metadata snapshot.
 */
export const device = createDeviceBinding();

export const Device = Object.freeze({
  get info(): DeviceInfo {
    return currentInfo;
  },
  getInfo(): DeviceInfo {
    return currentInfo;
  },
  refresh(): DeviceInfo {
    currentInfo = readFromBridge() ?? readNativeConstants() ?? readWebDeviceInfo();
    setDeviceRevision((value) => value + 1);
    return currentInfo;
  },
});
