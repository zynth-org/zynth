import {
  callNative,
  callNativeSync,
  isNativeAvailable,
  requestPermissionsWithEvent,
  subscribeClassicEvent,
} from "./native";
import type {
  BluetoothDevice,
  BluetoothClassicEvent,
  BluetoothEventSubscription,
  BluetoothPermissionStatus,
  BluetoothReconnectPolicy,
  ClassicConnectOptions,
  ClassicConnectionInfo,
  ClassicDiscoveryOptions,
  ClassicReconnectOptions,
} from "./types";

function createUnavailablePermissionState(): BluetoothPermissionStatus {
  return {
    bluetoothScan: false,
    bluetoothConnect: false,
    bluetoothAdvertise: false,
    location: false,
    allGranted: false,
  };
}

function createRequestId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function normalizeReconnectPolicy(policy?: BluetoothReconnectPolicy): Required<BluetoothReconnectPolicy> {
  return {
    maxAttempts: Math.max(1, Math.round(policy?.maxAttempts ?? 4)),
    initialDelayMs: Math.max(100, Math.round(policy?.initialDelayMs ?? 500)),
    maxDelayMs: Math.max(100, Math.round(policy?.maxDelayMs ?? 5000)),
    backoffMultiplier: Math.max(1, policy?.backoffMultiplier ?? 1.7),
  };
}

export const BluetoothClassic = {
  isSupported(): boolean {
    if (!isNativeAvailable()) {
      return false;
    }
    return callNativeSync<boolean>("isClassicSupported", {});
  },

  isEnabled(): boolean {
    if (!isNativeAvailable()) {
      return false;
    }
    return callNativeSync<boolean>("isEnabled", {});
  },

  async getPermissionsAsync(): Promise<BluetoothPermissionStatus> {
    if (!isNativeAvailable()) {
      return createUnavailablePermissionState();
    }
    return callNative<BluetoothPermissionStatus>("getPermissions", { transport: "classic" });
  },

  async requestPermissionsAsync(): Promise<BluetoothPermissionStatus> {
    if (!isNativeAvailable()) {
      return createUnavailablePermissionState();
    }

    const requestId = createRequestId("btclassic-perm");
    const result = await requestPermissionsWithEvent(requestId, "classic");
    const status = result.data as BluetoothPermissionStatus | undefined;
    return status ?? createUnavailablePermissionState();
  },

  async startDiscoveryAsync(options?: ClassicDiscoveryOptions): Promise<boolean> {
    if (!isNativeAvailable()) {
      return false;
    }
    return callNative<boolean>("startClassicDiscovery", {
      clearPrevious: options?.clearPrevious !== false,
    });
  },

  async stopDiscoveryAsync(): Promise<boolean> {
    if (!isNativeAvailable()) {
      return false;
    }
    return callNative<boolean>("stopClassicDiscovery", {});
  },

  async getDiscoveredDevicesAsync(): Promise<ReadonlyArray<BluetoothDevice>> {
    if (!isNativeAvailable()) {
      return [];
    }
    return callNative<BluetoothDevice[]>("getClassicDiscoveredDevices", {});
  },

  async connectAsync(options: ClassicConnectOptions): Promise<ClassicConnectionInfo> {
    if (!isNativeAvailable()) {
      throw new Error("Bluetooth Classic is unavailable on this runtime");
    }
    return callNative<ClassicConnectionInfo>("connectClassic", {
      deviceId: options.deviceId,
      uuid: options.uuid,
      insecure: options.insecure === true,
      timeoutMs: Math.max(1000, Math.round(options.timeoutMs ?? 15000)),
    });
  },

  async reconnectAsync(options: ClassicReconnectOptions): Promise<ClassicConnectionInfo> {
    if (!isNativeAvailable()) {
      throw new Error("Bluetooth Classic is unavailable on this runtime");
    }

    const policy = normalizeReconnectPolicy(options.policy);
    return callNative<ClassicConnectionInfo>("reconnectClassic", {
      deviceId: options.deviceId,
      uuid: options.uuid,
      insecure: options.insecure === true,
      timeoutMs: Math.max(1000, Math.round(options.timeoutMs ?? 15000)),
      policy,
    });
  },

  async disconnectAsync(connectionId: string): Promise<boolean> {
    if (!isNativeAvailable()) {
      return false;
    }
    return callNative<boolean>("disconnectClassic", { connectionId });
  },

  async writeAsync(connectionId: string, dataBase64: string): Promise<boolean> {
    if (!isNativeAvailable()) {
      throw new Error("Bluetooth Classic is unavailable on this runtime");
    }
    return callNative<boolean>("writeClassic", { connectionId, dataBase64 });
  },

  async readAsync(connectionId: string): Promise<string | null> {
    if (!isNativeAvailable()) {
      return null;
    }
    return callNative<string | null>("readClassic", { connectionId });
  },

  async getConnectionsAsync(): Promise<ReadonlyArray<ClassicConnectionInfo>> {
    if (!isNativeAvailable()) {
      return [];
    }
    return callNative<ClassicConnectionInfo[]>("getClassicConnections", {});
  },

  addListener(listener: (event: BluetoothClassicEvent) => void): BluetoothEventSubscription {
    const subscription = subscribeClassicEvent(listener);
    return {
      remove() {
        subscription.remove();
      },
    };
  },
};
