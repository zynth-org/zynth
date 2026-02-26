export type BluetoothTransport = "classic" | "ble";

export type BluetoothErrorCode =
  | "E_UNAVAILABLE"
  | "E_PERMISSION_DENIED"
  | "E_NOT_ENABLED"
  | "E_INVALID_ARGUMENT"
  | "E_TIMEOUT"
  | "E_NOT_FOUND"
  | "E_NOT_CONNECTED"
  | "E_IO"
  | "E_NATIVE";

export interface BluetoothOperationError extends Error {
  code: BluetoothErrorCode;
  details?: Record<string, unknown>;
}

export interface BluetoothPermissionStatus {
  bluetoothScan: boolean;
  bluetoothConnect: boolean;
  bluetoothAdvertise: boolean;
  location: boolean;
  allGranted: boolean;
}

export interface BluetoothDevice {
  id: string;
  name: string | null;
  address: string;
  rssi?: number;
  bondState?: number;
  type?: number;
}

export interface ClassicConnectionInfo {
  connectionId: string;
  deviceId: string;
  name: string | null;
  connected: boolean;
  lastError: string | null;
}

export interface BleConnectionInfo {
  connectionId: string;
  deviceId: string;
  name: string | null;
  connected: boolean;
  mtu: number;
  lastError: string | null;
}

export interface ClassicDiscoveryOptions {
  clearPrevious?: boolean;
}

export interface ClassicConnectOptions {
  deviceId: string;
  uuid?: string;
  insecure?: boolean;
  timeoutMs?: number;
}

export interface BluetoothReconnectPolicy {
  maxAttempts?: number;
  initialDelayMs?: number;
  maxDelayMs?: number;
  backoffMultiplier?: number;
}

export interface ClassicReconnectOptions extends ClassicConnectOptions {
  policy?: BluetoothReconnectPolicy;
}

export interface BleScanOptions {
  allowDuplicates?: boolean;
  serviceUuids?: string[];
  namePrefix?: string;
  legacy?: boolean;
}

export interface BlePeripheralConfig {
  localName?: string;
  serviceUuid: string;
  characteristicUuid: string;
  initialValueBase64?: string;
  connectable?: boolean;
}

export interface BlePeripheralState {
  running: boolean;
  localName: string | null;
  serviceUuid: string | null;
  characteristicUuid: string | null;
  connectedCentralIds: string[];
}

export interface BleConnectOptions {
  deviceId: string;
  autoConnect?: boolean;
  timeoutMs?: number;
}

export interface BleReconnectOptions extends BleConnectOptions {
  policy?: BluetoothReconnectPolicy;
}

export interface BleCharacteristicTarget {
  connectionId: string;
  serviceUuid: string;
  characteristicUuid: string;
  timeoutMs?: number;
}

export interface BleWriteCharacteristicOptions extends BleCharacteristicTarget {
  dataBase64: string;
  withResponse?: boolean;
}

export interface BleNotificationOptions extends BleCharacteristicTarget {
  enabled: boolean;
}

export interface BluetoothOperationResult<T> {
  ok: boolean;
  code?: BluetoothErrorCode;
  message?: string;
  data?: T;
}

export type BluetoothClassicEvent =
  | {
      type: "discovery_started" | "discovery_finished";
      timestamp: number;
    }
  | {
      type: "device_found";
      timestamp: number;
      device: BluetoothDevice;
    }
  | {
      type: "connection_state";
      timestamp: number;
      connection: ClassicConnectionInfo;
    }
  | {
      type: "data";
      timestamp: number;
      connectionId: string;
      dataBase64: string;
    }
  | {
      type: "error";
      timestamp: number;
      code: BluetoothErrorCode;
      message: string;
    };

export type BluetoothBleEvent =
  | {
      type: "scan_started" | "scan_stopped";
      timestamp: number;
    }
  | {
      type: "scan_result";
      timestamp: number;
      device: BluetoothDevice;
    }
  | {
      type: "connection_state";
      timestamp: number;
      connection: BleConnectionInfo;
    }
  | {
      type: "characteristic_changed";
      timestamp: number;
      connectionId: string;
      serviceUuid: string;
      characteristicUuid: string;
      dataBase64: string;
    }
  | {
      type: "error";
      timestamp: number;
      code: BluetoothErrorCode;
      message: string;
    }
  | {
      type: "peripheral_started" | "peripheral_stopped";
      timestamp: number;
      state: BlePeripheralState;
    }
  | {
      type: "peripheral_central_connection";
      timestamp: number;
      centralId: string;
      connected: boolean;
    }
  | {
      type: "peripheral_characteristic_read" | "peripheral_characteristic_write";
      timestamp: number;
      centralId: string;
      serviceUuid: string;
      characteristicUuid: string;
      dataBase64: string;
    };

export interface NativeEventSubscription {
  remove(): void;
}

export interface BluetoothEventSubscription {
  remove(): void;
}
