import {
  callNative,
  callNativeSync,
  isNativeAvailable,
  requestPermissionsWithEvent,
  subscribeBleEvent,
} from "./native";
import type {
  BlePeripheralConfig,
  BlePeripheralState,
  BleCharacteristicTarget,
  BleConnectOptions,
  BleConnectionInfo,
  BleNotificationOptions,
  BleReconnectOptions,
  BleScanOptions,
  BleWriteCharacteristicOptions,
  BluetoothBleEvent,
  BluetoothDevice,
  BluetoothEventSubscription,
  BluetoothPermissionStatus,
  BluetoothReconnectPolicy,
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

export const BluetoothBLE = {
  isSupported(): boolean {
    if (!isNativeAvailable()) {
      return false;
    }
    return callNativeSync<boolean>("isBleSupported", {});
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
    return callNative<BluetoothPermissionStatus>("getPermissions", { transport: "ble" });
  },

  async requestPermissionsAsync(): Promise<BluetoothPermissionStatus> {
    if (!isNativeAvailable()) {
      return createUnavailablePermissionState();
    }

    const requestId = createRequestId("btble-perm");
    const result = await requestPermissionsWithEvent(requestId, "ble");
    const status = result.data as BluetoothPermissionStatus | undefined;
    return status ?? createUnavailablePermissionState();
  },

  async startScanAsync(options?: BleScanOptions): Promise<boolean> {
    if (!isNativeAvailable()) {
      return false;
    }
    return callNative<boolean>("startBleScan", {
      allowDuplicates: options?.allowDuplicates === true,
      serviceUuids: options?.serviceUuids ?? [],
      namePrefix: options?.namePrefix,
      legacy: options?.legacy !== false,
    });
  },

  async stopScanAsync(): Promise<boolean> {
    if (!isNativeAvailable()) {
      return false;
    }
    return callNative<boolean>("stopBleScan", {});
  },

  async getScannedDevicesAsync(): Promise<ReadonlyArray<BluetoothDevice>> {
    if (!isNativeAvailable()) {
      return [];
    }
    return callNative<BluetoothDevice[]>("getBleScannedDevices", {});
  },

  async connectAsync(options: BleConnectOptions): Promise<BleConnectionInfo> {
    if (!isNativeAvailable()) {
      throw new Error("Bluetooth BLE is unavailable on this runtime");
    }
    return callNative<BleConnectionInfo>("connectBle", {
      deviceId: options.deviceId,
      autoConnect: options.autoConnect === true,
      timeoutMs: Math.max(1000, Math.round(options.timeoutMs ?? 15000)),
    });
  },

  async reconnectAsync(options: BleReconnectOptions): Promise<BleConnectionInfo> {
    if (!isNativeAvailable()) {
      throw new Error("Bluetooth BLE is unavailable on this runtime");
    }

    const policy = normalizeReconnectPolicy(options.policy);
    return callNative<BleConnectionInfo>("reconnectBle", {
      deviceId: options.deviceId,
      autoConnect: options.autoConnect === true,
      timeoutMs: Math.max(1000, Math.round(options.timeoutMs ?? 15000)),
      policy,
    });
  },

  async disconnectAsync(connectionId: string): Promise<boolean> {
    if (!isNativeAvailable()) {
      return false;
    }
    return callNative<boolean>("disconnectBle", { connectionId });
  },

  async discoverServicesAsync(connectionId: string, timeoutMs = 10000): Promise<string[]> {
    if (!isNativeAvailable()) {
      return [];
    }
    return callNative<string[]>("discoverBleServices", {
      connectionId,
      timeoutMs: Math.max(1000, Math.round(timeoutMs)),
    });
  },

  async readCharacteristicAsync(target: BleCharacteristicTarget): Promise<string> {
    if (!isNativeAvailable()) {
      throw new Error("Bluetooth BLE is unavailable on this runtime");
    }
    return callNative<string>("readBleCharacteristic", {
      connectionId: target.connectionId,
      serviceUuid: target.serviceUuid,
      characteristicUuid: target.characteristicUuid,
      timeoutMs: Math.max(1000, Math.round(target.timeoutMs ?? 10000)),
    });
  },

  async writeCharacteristicAsync(options: BleWriteCharacteristicOptions): Promise<boolean> {
    if (!isNativeAvailable()) {
      throw new Error("Bluetooth BLE is unavailable on this runtime");
    }
    return callNative<boolean>("writeBleCharacteristic", {
      connectionId: options.connectionId,
      serviceUuid: options.serviceUuid,
      characteristicUuid: options.characteristicUuid,
      dataBase64: options.dataBase64,
      withResponse: options.withResponse !== false,
      timeoutMs: Math.max(1000, Math.round(options.timeoutMs ?? 10000)),
    });
  },

  async setNotificationAsync(options: BleNotificationOptions): Promise<boolean> {
    if (!isNativeAvailable()) {
      return false;
    }
    return callNative<boolean>("setBleNotification", {
      connectionId: options.connectionId,
      serviceUuid: options.serviceUuid,
      characteristicUuid: options.characteristicUuid,
      enabled: options.enabled,
      timeoutMs: Math.max(1000, Math.round(options.timeoutMs ?? 10000)),
    });
  },

  async requestMtuAsync(connectionId: string, mtu: number): Promise<number> {
    if (!isNativeAvailable()) {
      return 23;
    }
    return callNative<number>("requestBleMtu", {
      connectionId,
      mtu: Math.max(23, Math.min(517, Math.round(mtu))),
      timeoutMs: 10000,
    });
  },

  async readRssiAsync(connectionId: string): Promise<number> {
    if (!isNativeAvailable()) {
      throw new Error("Bluetooth BLE is unavailable on this runtime");
    }
    return callNative<number>("readBleRssi", {
      connectionId,
      timeoutMs: 10000,
    });
  },

  async getConnectionsAsync(): Promise<ReadonlyArray<BleConnectionInfo>> {
    if (!isNativeAvailable()) {
      return [];
    }
    return callNative<BleConnectionInfo[]>("getBleConnections", {});
  },

  isPeripheralSupported(): boolean {
    if (!isNativeAvailable()) {
      return false;
    }
    return callNativeSync<boolean>("isBlePeripheralSupported", {});
  },

  async startPeripheralAsync(config: BlePeripheralConfig): Promise<BlePeripheralState> {
    if (!isNativeAvailable()) {
      throw new Error("Bluetooth BLE is unavailable on this runtime");
    }
    return callNative<BlePeripheralState>("startBlePeripheral", {
      localName: config.localName,
      serviceUuid: config.serviceUuid,
      characteristicUuid: config.characteristicUuid,
      initialValueBase64: config.initialValueBase64,
      connectable: config.connectable !== false,
    });
  },

  async stopPeripheralAsync(): Promise<boolean> {
    if (!isNativeAvailable()) {
      return false;
    }
    return callNative<boolean>("stopBlePeripheral", {});
  },

  async getPeripheralStateAsync(): Promise<BlePeripheralState> {
    if (!isNativeAvailable()) {
      return {
        running: false,
        localName: null,
        serviceUuid: null,
        characteristicUuid: null,
        connectedCentralIds: [],
      };
    }
    return callNative<BlePeripheralState>("getBlePeripheralState", {});
  },

  async updatePeripheralCharacteristicAsync(dataBase64: string): Promise<boolean> {
    if (!isNativeAvailable()) {
      return false;
    }
    return callNative<boolean>("updateBlePeripheralCharacteristic", { dataBase64 });
  },

  addListener(listener: (event: BluetoothBleEvent) => void): BluetoothEventSubscription {
    const subscription = subscribeBleEvent(listener);
    return {
      remove() {
        subscription.remove();
      },
    };
  },
};
